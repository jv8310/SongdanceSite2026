// Broadcast sender, run from the same 5-minute cron as the workshop engine
// (see src/worker-entrypoint.ts). Each tick, for every broadcast in 'sending':
//
//   1. Circuit breaker — if a meaningful sample has gone out and the complaint
//      or bounce rate is over threshold, auto-pause it (protecting the sending
//      domain's reputation, which a dormant 55k list can quietly wreck).
//   2. Drain — claim up to a capped number of pending recipients whose LOCAL
//      time is inside the 08:00–21:00 window, skip any now-suppressed address,
//      send (paced under Resend's rate limit), and mark them sent. Tracking
//      rides email_sends so open/click rates appear in the admin.
//   3. When nothing is left pending, mark it done.
//
// The per-run cap + local-window gating is exactly what spreads a big list over
// several days instead of blasting it in one reputation-shredding burst.

import { sendEmail } from '../workshops/resend';
import { MARKETING_FROM_DEFAULT, MARKETING_REPLY_TO_DEFAULT } from '../workshops/emails';
import { DEFAULT_SEND_TZ, localHour } from '../workshops/time';
import {
  isEmailSuppressed,
  oneClickUnsubscribeUrl,
  unsubscribePageUrl,
  unsubscribeSecret,
} from '../email/unsubscribe';
import { renderBroadcast } from './email';
import {
  broadcastEmailType,
  broadcastStats,
  claimRecipient,
  fetchDrainCandidates,
  fetchDrainCandidatesForTz,
  listActiveBroadcasts,
  markBroadcastDone,
  markRecipientRetryOrFail,
  markRecipientSent,
  markRecipientSuppressed,
  pauseBroadcast,
  pendingCount,
  pendingTimezones,
  reclaimStaleClaims,
  type Broadcast,
  type DrainCandidate,
} from './db';

type BroadcastCronEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  MARKETING_FROM?: string;
  MARKETING_REPLY_TO?: string;
  UNSUBSCRIBE_SECRET?: string;
  ADMIN_SESSION_SECRET?: string;
  PUBLIC_BASE_URL: string;
};

// Pacing. ~350 sends per 5-minute tick → ~100k/day at full availability — an
// aggressive rate a freshly cleaned, validated list has earned, so a big one-off
// broadcast clears in well under a day. Recipients who are asleep right now
// aren't rushed: the drain only mails inside each one's local window (see
// drainBroadcast), so the night-side of the list naturally rolls to its own
// morning instead of being blasted at 3am.
//
// At SEND_GAP_MS=550ms that's ~195s of paced sending per tick, plus per-send
// Resend/D1 overhead — deliberately kept under the 5-minute (300s) cron interval
// so a tick finishes before the next one fires. Two drains overlapping would
// each pace under Resend's 2 req/s but together breach it; that 300s ceiling
// (not the Worker's wall-clock budget) is why MAX_PER_RUN tops out around here.
// Going meaningfully faster than this means raising Resend's account rate limit,
// not this number.
//
// SEND_GAP_MS is the safety rail that keeps a single drain under Resend's default
// 2 req/s — leave it put. MAX_PER_RUN is the throughput lever (widening a
// broadcast's send window only helps at the edges). Mind your Resend plan's daily
// cap before pushing higher.
const MAX_PER_RUN = 350;
const SEND_GAP_MS = 550;

// Circuit breaker. Once a real sample has gone out, pause if complaints or
// HARD (permanent) bounces cross these lines — a dormant list that's gone sour
// should stop, not keep burning the domain. The bounce rate counts permanent
// bounces only (hard_bounced_at): a transient/greylist bounce clears on its own,
// isn't removed by list cleaning, and would otherwise re-trip the breaker on
// every resume. Rates are over tracked sends.
const CB_MIN_SAMPLE = 250;
const CB_MAX_COMPLAINT_RATE = 0.002; // 0.2%
const CB_MAX_BOUNCE_RATE = 0.06; // 6% (permanent bounces)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type BroadcastRunResult = { sent: number; paused: number; done: number };

export async function runBroadcasts(
  env: BroadcastCronEnv,
  now = Date.now(),
): Promise<BroadcastRunResult> {
  const result: BroadcastRunResult = { sent: 0, paused: 0, done: 0 };
  if (!env.RESEND_API_KEY) return result;

  const active = await listActiveBroadcasts(env.DB);
  for (const b of active) {
    // Isolate each broadcast: a thrown error (a transient D1 hiccup, a bad row)
    // must not abort the whole run and silently wedge every broadcast tick after
    // tick. Log it and carry on to the next.
    try {
      const emailType = broadcastEmailType(b.id);

      // 1. Circuit breaker — over sends made SINCE the last launch/resume, so a
      // cleaned-and-resumed queue is judged on its own fresh sample rather than a
      // sour historical rate it can never live down. Needs CB_MIN_SAMPLE *new*
      // sends before it can trip again. Bounce side weighs permanent bounces only.
      const stats = await broadcastStats(env.DB, emailType, b.breaker_baseline_at);
      if (stats.sent >= CB_MIN_SAMPLE) {
        const complaintRate = stats.complained / stats.sent;
        const bounceRate = stats.hardBounced / stats.sent;
        if (complaintRate > CB_MAX_COMPLAINT_RATE || bounceRate > CB_MAX_BOUNCE_RATE) {
          await pauseBroadcast(
            env.DB,
            b.id,
            `Auto-paused after ${stats.sent} sent since resuming — complaints ${(complaintRate * 100).toFixed(2)}%, ` +
              `hard bounces ${(bounceRate * 100).toFixed(2)}%. Clean the queue (dead domains / bad tags) before resuming.`,
          );
          result.paused += 1;
          continue;
        }
      }

      // 2. Drain a paced, in-window batch
      result.sent += await drainBroadcast(env, b, emailType, now);

      // 3. Finished?
      if ((await pendingCount(env.DB, b.id)) === 0) {
        await markBroadcastDone(env.DB, b.id);
        result.done += 1;
      }
    } catch (err) {
      console.error(`[broadcasts/cron] broadcast ${b.id} failed this tick`, err);
    }
  }

  return result;
}

async function drainBroadcast(
  env: BroadcastCronEnv,
  b: Broadcast,
  emailType: string,
  now: number,
): Promise<number> {
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const from = env.MARKETING_FROM || MARKETING_FROM_DEFAULT;
  const replyTo = env.MARKETING_REPLY_TO || MARKETING_REPLY_TO_DEFAULT;
  const secret = unsubscribeSecret(env);

  // Recover any rows orphaned in 'sending' by an earlier interrupted run.
  await reclaimStaleClaims(env.DB, b.id);

  let candidates: DrainCandidate[];
  if (b.urgent) {
    // Urgent (deadline) send: ignore the per-recipient local-time window
    // entirely and drain the queue as fast as the per-run cap allows. This is
    // the difference between "clears today" and "trickles for days" when the
    // list is concentrated in timezones that are mostly asleep right now.
    candidates = await fetchDrainCandidates(env.DB, b.id, MAX_PER_RUN * 2);
  } else {
    // Work out which still-pending timezones are inside the window right now,
    // then fetch only recipients in those zones. This avoids a head-of-line
    // stall where a big block of one (out-of-window) timezone at the front of
    // the queue would otherwise starve everyone else.
    const distinct = await pendingTimezones(env.DB, b.id);
    const inWindowTzs: string[] = [];
    let nullInWindow = false;
    for (const tz of distinct) {
      const h = localHour(tz || DEFAULT_SEND_TZ, now);
      if (h < b.window_start_hour || h >= b.window_end_hour) continue;
      if (tz == null) nullInWindow = true;
      else inWindowTzs.push(tz);
    }
    if (inWindowTzs.length === 0 && !nullInWindow) return 0; // nobody is in-window yet

    // D1 caps bound params ~100; if nearly every zone is in-window, the IN list
    // is pointless anyway — fall back to "everyone pending" (head-of-line moot).
    candidates =
      inWindowTzs.length > 90
        ? await fetchDrainCandidates(env.DB, b.id, MAX_PER_RUN * 2)
        : await fetchDrainCandidatesForTz(env.DB, b.id, inWindowTzs, nullInWindow, MAX_PER_RUN * 2);
  }
  let sent = 0;

  for (const c of candidates) {
    if (sent >= MAX_PER_RUN) break;

    // Atomic claim — only one run can own this row.
    if (!(await claimRecipient(env.DB, c.id))) continue;

    // Re-check suppression at send time (someone may have unsubscribed from an
    // earlier send while this drip was in flight).
    if (await isEmailSuppressed(env.DB, c.email)) {
      await markRecipientSuppressed(env.DB, c.id);
      continue;
    }

    try {
      // Build + send inside the try so a bad row (render/unsub-URL/Resend
      // failure) is parked as retry/fail for THIS recipient, never thrown out of
      // the loop where it would abort the whole drain with the row left claimed.
      const firstName = (c.name ?? '').trim().split(/\s+/)[0] ?? '';
      const footerUnsub = secret ? await unsubscribePageUrl(base, secret, c.email) : undefined;
      const oneClickUnsub = secret ? await oneClickUnsubscribeUrl(base, secret, c.email) : undefined;
      const content = renderBroadcast(b, { firstName, unsubscribeUrl: footerUnsub, email: c.email });

      if (sent > 0) await sleep(SEND_GAP_MS);
      const { id } = await sendEmail({
        apiKey: env.RESEND_API_KEY!,
        from,
        replyTo,
        to: c.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        listUnsubscribeUrl: oneClickUnsub,
        track: { db: env.DB, type: emailType, registrationId: null, variant: null },
      });
      await markRecipientSent(env.DB, c.id, id);
      sent += 1;
    } catch (err) {
      await markRecipientRetryOrFail(env.DB, c.id, String(err));
    }
  }

  return sent;
}
