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

import { sendEmailBatch, type BatchEmailInput } from '../workshops/resend';
import { MARKETING_FROM_DEFAULT, MARKETING_REPLY_TO_DEFAULT } from '../workshops/emails';
import { recordEmailSendStmt } from '../email/sends';
import { logEmailDrop } from '../email/drops';
import { DEFAULT_SEND_TZ, localHour } from '../workshops/time';
import {
  oneClickUnsubscribeUrl,
  unsubscribePageUrl,
  unsubscribeSecret,
} from '../email/unsubscribe';
import { renderBroadcast } from './email';
import {
  broadcastEmailType,
  broadcastStats,
  claimRecipientStmt,
  fetchDrainCandidates,
  fetchDrainCandidatesForTz,
  listActiveBroadcasts,
  markBroadcastDone,
  markRecipientRetryOrFailStmt,
  markRecipientSentStmt,
  markRecipientSuppressedStmt,
  pauseBroadcast,
  pendingCount,
  pendingTimezones,
  reclaimStaleClaims,
  suppressedEmailsIn,
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

// Pacing. The drain sends in BATCH_SIZE chunks through Resend's batch endpoint
// (one HTTP request per chunk, not one per recipient), so MAX_PER_RUN sends cost
// ~MAX_PER_RUN/BATCH_SIZE requests instead of MAX_PER_RUN of them. That's the
// whole reason this is fast and reliable: a tick clears in a few seconds and
// finishes well inside the 5-minute (300s) cron interval, so two drains can't
// overlap and pile onto Resend's request-rate limit (the old one-send-every-550ms
// loop ran a single tick ~300-400s, overlapped the next tick, and the doubled
// request rate tripped Resend's 2 req/s into 429s — which is what made it crawl).
//
// Recipients who are asleep right now still aren't rushed: the drain only mails
// inside each one's local window (see drainBroadcast), so the night-side of the
// list rolls to its own morning instead of being blasted at 3am.
//
// Throughput levers:
//   • MAX_PER_RUN — emails per tick. 1000/tick ≈ up to ~288k/day at full
//     availability; a one-off blast to a ~55k list clears in a few hours of
//     in-window time. The real ceiling now is Resend's account rate limit + daily
//     cap, not Worker wall-clock — raise those to go higher.
//   • BATCH_SIZE — emails per Resend request (max 100). Kept at 90 so the chunk's
//     suppression re-check IN-list stays under D1's 100-bound-param cap.
//   • BATCH_GAP_MS — pause between chunks, the safety rail that keeps the request
//     rate (1 request per chunk) under Resend's default 2 req/s. Leave it put.
const MAX_PER_RUN = 1000;
const BATCH_SIZE = 90;
const BATCH_GAP_MS = 600;

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
  for (let i = 0; i < candidates.length && sent < MAX_PER_RUN; i += BATCH_SIZE) {
    const chunk = candidates.slice(i, i + BATCH_SIZE).slice(0, MAX_PER_RUN - sent);
    const justSent = await sendChunk(env, b, emailType, base, from, replyTo, secret, chunk);
    sent += justSent;
    // Pace between chunks (one Resend request each) to stay under the rate limit;
    // skip the wait when there's nothing left to do this tick.
    if (sent < MAX_PER_RUN && i + BATCH_SIZE < candidates.length) await sleep(BATCH_GAP_MS);
  }

  return sent;
}

// Send one chunk (≤ BATCH_SIZE) via Resend's batch endpoint. Claims the rows,
// re-checks suppression, sends them all in a single request, and folds every
// status write into one db.batch(). Returns how many were actually emailed.
async function sendChunk(
  env: BroadcastCronEnv,
  b: Broadcast,
  emailType: string,
  base: string,
  from: string,
  replyTo: string,
  secret: string | null,
  chunk: DrainCandidate[],
): Promise<number> {
  if (chunk.length === 0) return 0;

  // 1. Atomically claim the whole chunk in one round-trip. A per-statement
  //    changes of 1 means this run won that row (pending → sending); 0 means a
  //    concurrent run already owns it (skip it).
  const claimResults = await env.DB.batch(chunk.map((c) => claimRecipientStmt(env.DB, c.id)));
  const claimed = chunk.filter((_, idx) => (claimResults[idx]?.meta?.changes ?? 0) === 1);
  if (claimed.length === 0) return 0;

  // 2. One suppression re-check for the chunk (someone may have unsubscribed
  //    since launch). Split the claimed rows into send vs. skip.
  const suppressed = await suppressedEmailsIn(
    env.DB,
    claimed.map((c) => c.email),
  );
  const toSend = claimed.filter((c) => !suppressed.has(c.email.trim().toLowerCase()));
  const toSkip = claimed.filter((c) => suppressed.has(c.email.trim().toLowerCase()));
  const skipStmts = toSkip.map((c) => markRecipientSuppressedStmt(env.DB, c.id));

  if (toSend.length === 0) {
    if (skipStmts.length) await env.DB.batch(skipStmts);
    return 0;
  }

  // 3. Render each recipient (per-recipient first name + one-click unsubscribe).
  const payload: BatchEmailInput[] = [];
  for (const c of toSend) {
    const firstName = (c.name ?? '').trim().split(/\s+/)[0] ?? '';
    const footerUnsub = secret ? await unsubscribePageUrl(base, secret, c.email) : undefined;
    const oneClickUnsub = secret ? await oneClickUnsubscribeUrl(base, secret, c.email) : undefined;
    const content = renderBroadcast(b, { firstName, unsubscribeUrl: footerUnsub, email: c.email });
    payload.push({
      from,
      replyTo,
      to: c.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      listUnsubscribeUrl: oneClickUnsub,
    });
  }

  // 4. Send the batch. A whole-batch failure (after the internal retries) parks
  //    every row in the chunk for a later tick — never thrown out where it would
  //    abort the drain with rows left claimed. Suppressed rows are still recorded.
  let ids: (string | null)[];
  try {
    ids = await sendEmailBatch(env.RESEND_API_KEY!, payload);
  } catch (err) {
    await env.DB.batch([
      ...skipStmts,
      ...toSend.map((c) => markRecipientRetryOrFailStmt(env.DB, c.id, String(err))),
    ]);
    // Surface the parked chunk on /admin/emails/failures. The rows are retried,
    // so this is informational — but a run of these is the early warning that
    // Resend is throttling (raise the account rate limit / daily cap).
    await logEmailDrop(env.DB, {
      stream: 'broadcast',
      emailType: emailType,
      count: toSend.length,
      detail: String(err),
    });
    return 0;
  }

  // 5. Mark the chunk sent in one round-trip (status writes are critical — they
  //    prevent a resend on the next tick). Engagement recording (email_sends) is
  //    a separate best-effort batch so a stats-write hiccup can never roll back
  //    the sent-status and cause a duplicate send.
  await env.DB.batch([...skipStmts, ...toSend.map((c, idx) => markRecipientSentStmt(env.DB, c.id, ids[idx] ?? null))]);

  const sendRecords = toSend
    .map((c, idx) =>
      recordEmailSendStmt(env.DB, {
        resendId: ids[idx] ?? null,
        type: emailType,
        to: c.email,
        subject: payload[idx].subject,
      }),
    )
    .filter((s): s is D1PreparedStatement => s !== null);
  if (sendRecords.length) {
    try {
      await env.DB.batch(sendRecords);
    } catch {
      // Stats are best-effort; the mail already went out and the rows are 'sent'.
    }
  }

  return toSend.length;
}
