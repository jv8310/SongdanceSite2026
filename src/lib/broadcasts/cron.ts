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

// Pacing. ~80 sends per 5-minute tick → ~23k/day at full availability, so a 55k
// list lands in ~2.5 days (longer in practice, since recipients only send inside
// their local window). SEND_GAP_MS keeps us under Resend's default 2 req/s.
// Raise MAX_PER_RUN (and/or widen a broadcast's send window) to go faster — the
// batch cap is the real throughput lever, not the window. Mind Resend's account
// rate limit if you push it much higher.
const MAX_PER_RUN = 80;
const SEND_GAP_MS = 550;

// Circuit breaker. Once a real sample has gone out, pause if complaints or
// bounces cross these lines — a dormant list that's gone sour should stop, not
// keep burning the domain. Rates are over tracked sends.
const CB_MIN_SAMPLE = 250;
const CB_MAX_COMPLAINT_RATE = 0.002; // 0.2%
const CB_MAX_BOUNCE_RATE = 0.06; // 6%

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
    const emailType = broadcastEmailType(b.id);

    // 1. Circuit breaker — over sends made SINCE the last launch/resume, so a
    // cleaned-and-resumed queue is judged on its own fresh sample rather than a
    // sour historical rate it can never live down. Needs CB_MIN_SAMPLE *new*
    // sends before it can trip again.
    const stats = await broadcastStats(env.DB, emailType, b.breaker_baseline_at);
    if (stats.sent >= CB_MIN_SAMPLE) {
      const complaintRate = stats.complained / stats.sent;
      const bounceRate = stats.bounced / stats.sent;
      if (complaintRate > CB_MAX_COMPLAINT_RATE || bounceRate > CB_MAX_BOUNCE_RATE) {
        await pauseBroadcast(
          env.DB,
          b.id,
          `Auto-paused after ${stats.sent} sent since resuming — complaints ${(complaintRate * 100).toFixed(2)}%, ` +
            `bounces ${(bounceRate * 100).toFixed(2)}%. Clean the queue (dead domains / bad tags) before resuming.`,
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

  // Work out which still-pending timezones are inside the window right now, then
  // fetch only recipients in those zones. This avoids a head-of-line stall where
  // a big block of one (out-of-window) timezone at the front of the queue would
  // otherwise starve everyone else.
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

  // D1 caps bound params ~100; if nearly every zone is in-window, the IN list is
  // pointless anyway — fall back to "everyone pending" (head-of-line is moot then).
  const candidates =
    inWindowTzs.length > 90
      ? await fetchDrainCandidates(env.DB, b.id, MAX_PER_RUN * 2)
      : await fetchDrainCandidatesForTz(env.DB, b.id, inWindowTzs, nullInWindow, MAX_PER_RUN * 2);
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

    const firstName = (c.name ?? '').trim().split(/\s+/)[0] ?? '';
    const footerUnsub = secret ? await unsubscribePageUrl(base, secret, c.email) : undefined;
    const oneClickUnsub = secret ? await oneClickUnsubscribeUrl(base, secret, c.email) : undefined;
    const content = renderBroadcast(b, { firstName, unsubscribeUrl: footerUnsub });

    try {
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
