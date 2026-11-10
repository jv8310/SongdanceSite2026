// The individual sessions' 5-minute tick (src/worker-entrypoint.ts):
//   1. a paid order whose booking is still only held → confirm it (the safety
//      net behind notifyCourseOrder);
//   2. a booked session whose confirmation never went out → send it;
//   3. an order refunded in full → cancel its session (Zoom + calendar; no
//      email — the refund is Jacob's conversation with them);
//   4. reminders: the day before (only when booked more than a day ahead) and
//      an hour before, each claimed once on the booking row;
//   5. holds that ran out without payment → 'expired'.
// No-ops while nothing is booked; every step is idempotent.

import { logEventSafe } from '../registrations/db';
import { loadSessionSettings } from './config';
import { cancelSession } from './actions';
import {
  confirmSessionBooking,
  emailCtxFor,
  ensureMeeting,
  sendClientEmail,
  type SessionEnv,
} from './confirm';
import { bookedBetween, claimReminder, releaseReminder, type SessionBooking } from './db';
import { sessionReminderEmail } from './emails';

const HOUR = 3_600_000;

export type SessionCronResult = { confirmed: number; reminders: number; cancelled: number; expired: number };

const sqliteToMs = (s: string | null) => (s ? Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`) : NaN);

export async function runSessionCron(env: SessionEnv): Promise<SessionCronResult> {
  const out: SessionCronResult = { confirmed: 0, reminders: 0, cancelled: 0, expired: 0 };
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Cheap exit: nothing on the books at all (the table is empty until the
  // first checkout) — or the migration has not run yet on this database.
  try {
    const any = await env.DB.prepare(`SELECT id FROM session_bookings LIMIT 1`).first();
    if (!any) return out;
  } catch {
    return out;
  }

  // 1. Paid but still held / lapsed.
  const paidHeld = await env.DB
    .prepare(
      `SELECT b.course_registration_id AS reg_id
         FROM session_bookings b JOIN course_registrations c ON c.id = b.course_registration_id
        WHERE b.status IN ('held','expired') AND c.status = 'paid'
          AND b.created_at > datetime('now', '-14 days')
        LIMIT 10`,
    )
    .all<{ reg_id: number }>();
  for (const r of paidHeld.results ?? []) {
    await confirmSessionBooking(env, { id: r.reg_id, product_slug: 'individual-session' });
    out.confirmed++;
  }

  // 2. Booked, still ahead, no confirmation on record.
  const unconfirmed = await env.DB
    .prepare(
      `SELECT b.course_registration_id AS reg_id FROM session_bookings b
        WHERE b.status = 'booked' AND b.starts_at_utc > ? AND b.course_registration_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM events e WHERE e.external_id = 'session-confirmed-' || b.id)
        LIMIT 10`,
    )
    .bind(nowIso)
    .all<{ reg_id: number }>();
  for (const r of unconfirmed.results ?? []) {
    await confirmSessionBooking(env, { id: r.reg_id, product_slug: 'individual-session' });
  }

  // 3. Refunded in full → the session goes.
  const refunded = await env.DB
    .prepare(
      `SELECT b.id FROM session_bookings b JOIN course_registrations c ON c.id = b.course_registration_id
        WHERE b.status IN ('booked','conflict') AND c.status = 'refunded' AND b.ends_at_utc > ?
        LIMIT 10`,
    )
    .bind(nowIso)
    .all<{ id: number }>();
  for (const r of refunded.results ?? []) {
    const res = await cancelSession(env, r.id, { reason: 'order refunded', emailClient: false, by: 'system:refund' });
    if (res.ok) out.cancelled++;
  }

  // 4. Reminders.
  const settings = await loadSessionSettings(env.DB);
  const soon = await bookedBetween(env.DB, nowIso, new Date(now + 24 * HOUR).toISOString());
  for (const b of soon) {
    const start = Date.parse(b.starts_at_utc);
    const left = start - now;
    if (left <= HOUR) {
      if (!b.reminder_1h_sent_at && (await remind(env, b, '1h', settings))) out.reminders++;
      continue;
    }
    if (b.reminder_24h_sent_at || left <= 2 * HOUR) continue;
    // Booked (or confirmed) less than a day ahead: the confirmation is fresh,
    // a "tomorrow" note on top would be noise. Mark it done without sending.
    const confirmed = sqliteToMs(b.confirmed_at);
    if (Number.isFinite(confirmed) && confirmed > start - 24 * HOUR - 30 * 60_000) {
      await claimReminder(env.DB, b.id, '24h');
      continue;
    }
    if (await remind(env, b, '24h', settings)) out.reminders++;
  }

  // 5. Holds that ran out without a payment.
  const exp = await env.DB
    .prepare(
      `UPDATE session_bookings SET status = 'expired', updated_at = datetime('now')
        WHERE status = 'held' AND hold_expires_at < ?
          AND (course_registration_id IS NULL OR NOT EXISTS (
                SELECT 1 FROM course_registrations c WHERE c.id = session_bookings.course_registration_id AND c.status = 'paid'))`,
    )
    .bind(nowIso)
    .run();
  out.expired = exp.meta?.changes ?? 0;

  return out;
}

async function remind(
  env: SessionEnv,
  b: SessionBooking,
  which: '24h' | '1h',
  settings: Awaited<ReturnType<typeof loadSessionSettings>>,
): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  if (!(await claimReminder(env.DB, b.id, which))) return false;
  try {
    // A link set since the booking (the standard link, say) is picked up now.
    const nb = b.join_url ? b : await ensureMeeting(env, b, settings);
    const sent = await sendClientEmail(env, nb, sessionReminderEmail(which, await emailCtxFor(env, nb, settings)), {
      kind: `session.reminder_${which}.sent`,
      track: `session_reminder_${which}`,
    });
    if (!sent) await releaseReminder(env.DB, b.id, which);
    return sent;
  } catch (err) {
    await releaseReminder(env.DB, b.id, which);
    await logEventSafe(env.DB, { registration_id: null, kind: 'session.reminder.error', source: 'system', payload: { booking_id: b.id, which, error: String(err) } });
    return false;
  }
}
