// Scheduled work for the workshop engine: reminder cadence + post-workshop
// (attended / no-show) emails. Runs from the companion cron trigger
// (every 5 minutes — see wrangler.jsonc + worker-entrypoint.ts).
//
// Idempotency is the whole game: every send is guarded by an atomic
// claimNotification() on (registration_id, type), which replaces the legacy
// per-offset boolean flags (min7d…gotime).

import { claimNotification, type Workshop, type WorkshopRegistration } from './db';
import { sendEmail } from './resend';
import {
  confirmationEmail,
  postAttendedEmail,
  postNoShowEmail,
  reminderEmail,
  type WorkshopEmailCtx,
} from './emails';
import { googleCalendarUrl } from './ics';
import { endsAtOrDefault, formatInTz, minutesUntil } from './time';
import { icsUrl, successUrl } from './paid-handler';

type CronEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
  PUBLIC_BASE_URL: string;
};

// Reminder cadence: lead time before start, in minutes. Ordered loosest →
// tightest. `at_time` (0) fires right at start.
const CADENCE: Array<{ type: string; lead: number }> = [
  { type: 'reminder_7d', lead: 7 * 24 * 60 },
  { type: 'reminder_2d', lead: 2 * 24 * 60 },
  { type: 'reminder_1d', lead: 24 * 60 },
  { type: 'reminder_6h', lead: 6 * 60 },
  { type: 'reminder_1h', lead: 60 },
  { type: 'reminder_15m', lead: 15 },
  { type: 'at_time', lead: 0 },
];

export type CronResult = {
  remindersSent: number;
  postSent: number;
  noShowsMarked: number;
};

export async function runWorkshopCron(env: CronEnv, now = Date.now()): Promise<CronResult> {
  const result: CronResult = { remindersSent: 0, postSent: 0, noShowsMarked: 0 };
  if (!env.RESEND_API_KEY) return result;

  await runReminders(env, now, result);
  await runPostWorkshop(env, now, result);
  return result;
}

function emailCtx(env: CronEnv, reg: WorkshopRegistration, w: Workshop): WorkshopEmailCtx {
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const tz = reg.timezone || w.display_tz;
  const join = successUrl(base, reg.id);
  return {
    name: reg.name,
    workshopTitle: w.title,
    whenLocal: formatInTz(w.starts_at_utc, tz),
    joinUrl: join,
    googleCalUrl: googleCalendarUrl({
      title: w.title,
      startsAtUtc: w.starts_at_utc,
      endsAtUtc: w.ends_at_utc,
      url: join,
    }),
    icsUrl: icsUrl(base, reg.id),
  };
}

// ── Reminders ──────────────────────────────────────────────────────────────
async function runReminders(env: CronEnv, now: number, result: CronResult) {
  // Live workshops starting within the next 7 days (plus a 30-minute grace
  // after start so `at_time` still fires). Replays have no live time.
  const horizon = new Date(now + 7 * 24 * 60 * 60 * 1000 + 60000).toISOString();
  const floor = new Date(now - 30 * 60000).toISOString();
  const wRes = await env.DB
    .prepare(
      `SELECT * FROM workshops
        WHERE status = 'published' AND deleted = 0 AND is_replay = 0
          AND starts_at_utc >= ? AND starts_at_utc <= ?`,
    )
    .bind(floor, horizon)
    .all<Workshop>();

  for (const w of wRes.results ?? []) {
    const regs = await env.DB
      .prepare(
        `SELECT * FROM workshop_registrations
          WHERE workshop_id = ? AND payment_status IN ('paid','coupon')`,
      )
      .bind(w.id)
      .all<WorkshopRegistration>();

    for (const reg of regs.results ?? []) {
      const mins = minutesUntil(w.starts_at_utc, now);
      // Tightest cadence bucket already crossed (smallest lead with lead >= mins).
      let idx = -1;
      for (let i = 0; i < CADENCE.length; i++) {
        if (CADENCE[i].lead >= mins) idx = i; // keep advancing → ends on the tightest crossed
      }
      if (idx < 0) continue; // nothing due yet (more than 7d out)

      const due = CADENCE[idx];
      // Claim every looser bucket too so we never backfill them with a late
      // burst — but only actually email the single tightest due reminder.
      for (let i = 0; i < idx; i++) {
        await claimNotification(env.DB, reg.id, CADENCE[i].type);
      }
      const shouldSend = await claimNotification(env.DB, reg.id, due.type);
      if (!shouldSend) continue;

      const content = reminderEmail(due.type, emailCtx(env, reg, w));
      try {
        await sendEmail({
          apiKey: env.RESEND_API_KEY!,
          replyTo: env.RESEND_REPLY_TO,
          to: reg.email,
          subject: content.subject,
          html: content.html,
          text: content.text,
          entityRefId: `workshop-${due.type}-${reg.id}`,
        });
        result.remindersSent += 1;
      } catch {
        // Already claimed; a transient failure means this cadence is skipped
        // rather than retried. The next tighter bucket will still reach them.
      }
    }
  }
}

// ── Post-workshop (attended / no-show) ──────────────────────────────────────
async function runPostWorkshop(env: CronEnv, now: number, result: CronResult) {
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  // Workshops that have ended within the last 7 days. Use ends_at, defaulting
  // to start + 1h. Compare on starts_at for the index, then filter on end.
  const since = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const wRes = await env.DB
    .prepare(
      `SELECT * FROM workshops
        WHERE deleted = 0 AND is_replay = 0 AND status IN ('published','cancelled')
          AND starts_at_utc >= ? AND starts_at_utc <= ?`,
    )
    .bind(since, new Date(now).toISOString())
    .all<Workshop>();

  for (const w of wRes.results ?? []) {
    const endsAt = new Date(endsAtOrDefault(w.starts_at_utc, w.ends_at_utc)).getTime();
    if (endsAt > now) continue; // not finished yet

    // Anyone still 'registered' becomes 'no_show'.
    const flipped = await env.DB
      .prepare(
        `UPDATE workshop_registrations
            SET attendance_status = 'no_show', updated_at = datetime('now')
          WHERE workshop_id = ? AND payment_status IN ('paid','coupon')
            AND attendance_status = 'registered'`,
      )
      .bind(w.id)
      .run();
    result.noShowsMarked += flipped.meta?.changes ?? 0;

    const regs = await env.DB
      .prepare(
        `SELECT * FROM workshop_registrations
          WHERE workshop_id = ? AND payment_status IN ('paid','coupon')`,
      )
      .bind(w.id)
      .all<WorkshopRegistration>();

    for (const reg of regs.results ?? []) {
      if (reg.attendance_status === 'attended') {
        if (!(await claimNotification(env.DB, reg.id, 'post_attended'))) continue;
        const content = postAttendedEmail({
          name: reg.name,
          workshopTitle: w.title,
          courseUrl: `${base}/courses/12-week`,
          certUrl: `${base}/courses/certification`,
        });
        await safeSend(env, reg.email, content, `workshop-post-attended-${reg.id}`, result);
      } else if (reg.attendance_status === 'no_show') {
        if (!(await claimNotification(env.DB, reg.id, 'post_no_show'))) continue;
        const content = postNoShowEmail({
          name: reg.name,
          workshopTitle: w.title,
          // Their personal hub: the replay + free re-booking onto a new date.
          replayUrl: successUrl(base, reg.id),
        });
        await safeSend(env, reg.email, content, `workshop-post-no-show-${reg.id}`, result);
      }
    }
  }
}

async function safeSend(
  env: CronEnv,
  to: string,
  content: ReturnType<typeof confirmationEmail>,
  refId: string,
  result: CronResult,
) {
  try {
    await sendEmail({
      apiKey: env.RESEND_API_KEY!,
      replyTo: env.RESEND_REPLY_TO,
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
      entityRefId: refId,
    });
    result.postSent += 1;
  } catch {
    // Swallow — already claimed; a transient Resend error won't be retried.
  }
}
