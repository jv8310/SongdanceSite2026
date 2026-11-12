// What happens when a session is paid — and the helpers every later step
// (reminders, a move, a cancel) shares.
//
// confirmSessionBooking runs from notifyCourseOrder, so every payment path
// reaches it (Stripe webhook, PayPal return and webhook, admin mark-paid, the
// hourly order reconcile) — and from the 5-minute sessions cron as a safety
// net for a paid order whose booking is still only held. Each step is
// idempotent, so running it twice changes nothing:
//   1. the moment becomes 'booked' (or 'conflict' when someone else took it
//      after a hold lapsed — then the buyer and Jacob are told, nothing else);
//   2. the meeting: a Zoom meeting of its own (Zoom API), else the link on the
//      "Boekingen" event, else the standard link from /admin/sessions;
//   3. the session is written into Jacob's calendar (needs write access;
//      a failure is recorded on the booking, never blocks the rest);
//   4. the client's confirmation email (claimed once in `events`).
// Never throws into the caller: a mail or Zoom hiccup must not roll back a
// paid order.

import { getCourseRegistrationById, type CourseRegistration } from '../courses/db';
import { logEventSafe } from '../registrations/db';
import { resolveGoogleConfig } from '../workshops/google-config';
import { googleCalendarUrl } from '../workshops/ics';
import { formatInTz } from '../workshops/time';
import { sendEmail } from '../workshops/resend';
import { insertSessionEvent, type SessionCalendarEvent } from './calendar';
import { isSessionProductSlug, loadSessionSettings, type SessionSettings } from './config';
import {
  claimBooked,
  getBooking,
  getBookingByRegistration,
  setCalendarResult,
  setMeeting,
  type SessionBooking,
} from './db';
import {
  sessionConfirmedEmail,
  sessionConflictEmail,
  sessionInternalEmail,
  type SessionEmailCtx,
} from './emails';
import { bookingIcsUrl, bookingUrl } from './link';
import { createZoomMeeting, zoomConfigured, type ZoomEnv } from './zoom';

export type SessionEnv = ZoomEnv & {
  DB: D1Database;
  PUBLIC_BASE_URL?: string;
  ADMIN_SESSION_SECRET?: string;
  RESEND_API_KEY?: string;
  ORDER_NOTIFICATIONS_TO?: string;
  GOOGLE_SA_JSON?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REFRESH_TOKEN?: string;
  GOOGLE_CALENDAR_ID?: string;
};

export const SESSION_EMAIL_TITLE = 'Individual session with Jacob';
export const baseUrlOf = (env: { PUBLIC_BASE_URL?: string }) =>
  (env.PUBLIC_BASE_URL ?? 'https://songdance.co').replace(/\/+$/, '');
export const adminSessionsUrl = (env: { PUBLIC_BASE_URL?: string }) => `${baseUrlOf(env)}/admin/sessions`;

export const bookingName = (b: Pick<SessionBooking, 'first_name' | 'last_name' | 'email'>) =>
  [b.first_name, b.last_name].filter(Boolean).join(' ').trim() || b.email;

// The client's clock (their browser's zone at booking), else Brussels.
export const clientTz = (b: Pick<SessionBooking, 'timezone'>) => b.timezone || 'Europe/Brussels';

export const brusselsWhen = (iso: string) => formatInTz(iso, 'Europe/Brussels');

// ── Recipients for the internal notes ───────────────────────────────────────
const DEFAULT_INTERNAL = ['jacob@songdance.co', 'support@songdance.co'];
export function internalRecipients(env: { ORDER_NOTIFICATIONS_TO?: string }): string[] {
  const list = (env.ORDER_NOTIFICATIONS_TO ?? '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_INTERNAL;
}

export async function sendInternal(env: SessionEnv, subject: string, lines: string[]): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  try {
    const c = sessionInternalEmail({ subject, lines, adminUrl: adminSessionsUrl(env) });
    await sendEmail({ apiKey: env.RESEND_API_KEY, to: internalRecipients(env), subject: c.subject, html: c.html, text: c.text });
  } catch (err) {
    await logEventSafe(env.DB, { registration_id: null, kind: 'session.internal_email.error', source: 'system', payload: { subject, error: String(err) } });
  }
}

// ── The email context for a booking ─────────────────────────────────────────
export async function emailCtxFor(
  env: SessionEnv,
  b: SessionBooking,
  settings: SessionSettings,
): Promise<SessionEmailCtx> {
  const secret = env.ADMIN_SESSION_SECRET ?? '';
  const base = baseUrlOf(env);
  const tz = clientTz(b);
  const manageUrl = await bookingUrl(secret, base, b.id);
  const moveUntil = Date.parse(b.starts_at_utc) - settings.rescheduleHours * 3_600_000;
  return {
    name: b.first_name,
    whenLocal: formatInTz(b.starts_at_utc, tz),
    durationMin: b.duration_min,
    joinUrl: b.join_url,
    passcode: b.join_passcode,
    manageUrl,
    icsUrl: await bookingIcsUrl(secret, base, b.id),
    googleCalUrl: googleCalendarUrl({
      title: SESSION_EMAIL_TITLE,
      startsAtUtc: b.starts_at_utc,
      endsAtUtc: b.ends_at_utc,
      description: b.join_url ? `Zoom: ${b.join_url}${b.join_passcode ? ` (passcode ${b.join_passcode})` : ''}` : 'Your booking page has the Zoom link.',
      location: b.join_url ?? 'Zoom',
      url: manageUrl,
    }),
    moveUntilLabel: settings.rescheduleHours > 0 && moveUntil > Date.now() ? formatInTz(new Date(moveUntil).toISOString(), tz) : null,
  };
}

// ── The meeting ─────────────────────────────────────────────────────────────
// A Zoom meeting of its own when the API is connected; otherwise whatever the
// booking already carries (the link on its "Boekingen" event, saved at
// checkout), else the standard link. Writes the result onto the booking.
export async function ensureMeeting(env: SessionEnv, b: SessionBooking, settings: SessionSettings): Promise<SessionBooking> {
  if (b.zoom_meeting_id || b.join_source === 'admin') return b;
  if (zoomConfigured(env)) {
    try {
      const m = await createZoomMeeting(env, {
        topic: `Songdance session — ${bookingName(b)}`,
        agenda: b.note ? `What brings them: ${b.note}` : '',
        startUtc: b.starts_at_utc,
        durationMin: b.duration_min,
      });
      await setMeeting(env.DB, b.id, { zoomMeetingId: m.id, joinUrl: m.joinUrl, passcode: m.passcode, source: 'zoom-api' });
      return (await getBooking(env.DB, b.id)) ?? b;
    } catch (err) {
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'session.zoom.error',
        source: 'system',
        payload: { booking_id: b.id, error: String(err) },
      });
    }
  }
  if (b.join_url) return b;
  if (settings.standardJoinUrl) {
    await setMeeting(env.DB, b.id, {
      zoomMeetingId: null,
      joinUrl: settings.standardJoinUrl,
      passcode: settings.standardPasscode || null,
      source: 'standard',
    });
    return (await getBooking(env.DB, b.id)) ?? b;
  }
  return b;
}

// ── The calendar entry ──────────────────────────────────────────────────────
export function calendarEventFor(env: SessionEnv, b: SessionBooking): SessionCalendarEvent {
  const lines = [
    `Individual session (Songdance) with ${bookingName(b)}`,
    `Email: ${b.email}`,
    b.timezone ? `Their clock: ${formatInTz(b.starts_at_utc, b.timezone)}` : '',
    b.note ? `\nWhat brings them:\n${b.note}` : '',
    b.join_url ? `\nZoom: ${b.join_url}${b.join_passcode ? `\nPasscode: ${b.join_passcode}` : ''}` : '\nNo Zoom link yet — add one on /admin/sessions.',
    `\n${adminSessionsUrl(env)}`,
  ].filter(Boolean);
  return {
    bookingId: b.id,
    summary: `Sessie — ${bookingName(b)}`,
    description: lines.join('\n'),
    startUtc: b.starts_at_utc,
    endUtc: b.ends_at_utc,
    joinUrl: b.join_url,
  };
}

export async function ensureCalendarEvent(env: SessionEnv, b: SessionBooking): Promise<SessionBooking> {
  if (b.calendar_event_id) return b;
  const cfg = await resolveGoogleConfig(env.DB, env as never).catch(() => null);
  if (!cfg) {
    await setCalendarResult(env.DB, b.id, { error: 'Google Calendar is not connected.' });
    return (await getBooking(env.DB, b.id)) ?? b;
  }
  const r = await insertSessionEvent(cfg, calendarEventFor(env, b));
  await setCalendarResult(env.DB, b.id, r.ok ? { eventId: r.id, error: null } : { error: r.error });
  return (await getBooking(env.DB, b.id)) ?? b;
}

// ── Claims in `events` (once per booking) ───────────────────────────────────
async function claim(db: D1Database, externalId: string, kind: string): Promise<boolean> {
  const r = await db
    .prepare(`INSERT OR IGNORE INTO events (registration_id, kind, source, external_id) VALUES (NULL, ?, 'system', ?)`)
    .bind(kind, externalId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}
async function unclaim(db: D1Database, externalId: string): Promise<void> {
  await db.prepare(`DELETE FROM events WHERE external_id = ?`).bind(externalId).run();
}

export async function sendClientEmail(
  env: SessionEnv,
  b: SessionBooking,
  content: { subject: string; html: string; text: string },
  opts: { claimId?: string; kind: string; track: string },
): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  let claimed = false;
  if (opts.claimId) {
    claimed = await claim(env.DB, opts.claimId, opts.kind);
    if (!claimed) return false;
  }
  try {
    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      to: b.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      entityRefId: `session-${b.id}-${opts.track}`,
      track: { db: env.DB, type: opts.track, registrationId: b.course_registration_id },
    });
    return true;
  } catch (err) {
    if (claimed && opts.claimId) await unclaim(env.DB, opts.claimId).catch(() => {});
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'session.email.error',
      source: 'system',
      payload: { booking_id: b.id, email: opts.track, error: String(err) },
    });
    return false;
  }
}

// ── On payment ──────────────────────────────────────────────────────────────
export async function confirmSessionBooking(
  env: SessionEnv,
  passed: Pick<CourseRegistration, 'id' | 'product_slug'>,
): Promise<SessionBooking | null> {
  if (!isSessionProductSlug(passed.product_slug)) return null;
  try {
    const reg = await getCourseRegistrationById(env.DB, passed.id);
    if (!reg || reg.status !== 'paid') return null;
    let b = await getBookingByRegistration(env.DB, reg.id);
    if (!b) {
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'session.booking.missing',
        source: 'system',
        external_id: `session-missing-${reg.id}`,
        payload: { course_registration_id: reg.id, email: reg.email },
      });
      return null;
    }
    if (b.status === 'cancelled') return b;
    const settings = await loadSessionSettings(env.DB);

    if (b.status === 'held' || b.status === 'expired') {
      const outcome = await claimBooked(env.DB, b, settings.bufferMin);
      b = (await getBooking(env.DB, b.id)) ?? b;
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: `session.booking.${outcome === 'conflict' ? 'conflict' : 'booked'}`,
        source: 'system',
        external_id: `session-paid-${b.id}`,
        payload: { booking_id: b.id, course_registration_id: reg.id, starts_at_utc: b.starts_at_utc },
      });
    }

    if (b.status === 'conflict') {
      const whenLocal = formatInTz(b.starts_at_utc, clientTz(b));
      const sent = await sendClientEmail(env, b, sessionConflictEmail({ name: b.first_name, whenLocal }), {
        claimId: `session-conflict-${b.id}`,
        kind: 'session.conflict.sent',
        track: 'session_conflict',
      });
      if (sent) {
        await sendInternal(env, `SD-SESSION: moment taken — ${bookingName(b)} paid for ${brusselsWhen(b.starts_at_utc)}`, [
          `${bookingName(b)} (${b.email}) paid for an individual session at ${brusselsWhen(b.starts_at_utc)}, but that moment was taken by someone else while they were paying (their hold had lapsed).`,
          'They were told we would write within a day to find another time, or refund in full.',
          `Order C-${reg.id}.`,
        ]);
      }
      return b;
    }
    if (b.status !== 'booked') return b;

    b = await ensureMeeting(env, b, settings);
    b = await ensureCalendarEvent(env, b);
    await sendClientEmail(env, b, sessionConfirmedEmail(await emailCtxFor(env, b, settings)), {
      claimId: `session-confirmed-${b.id}`,
      kind: 'session.confirmation.sent',
      track: 'session_confirmed',
    });
    return b;
  } catch (err) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'session.confirm.error',
      source: 'system',
      payload: { course_registration_id: passed.id, error: String(err) },
    });
    return null;
  }
}

// Rows for the SD-ORDER email (src/lib/orders/notification.ts).
export function sessionOrderRows(b: SessionBooking | null): Array<[string, string]> {
  if (!b) return [['Session', 'No booking found for this order — see /admin/sessions']];
  const rows: Array<[string, string]> = [
    ['Session', `${brusselsWhen(b.starts_at_utc)} · ${b.duration_min} min`],
  ];
  if (b.timezone && b.timezone !== 'Europe/Brussels') rows.push(['Their clock', formatInTz(b.starts_at_utc, b.timezone)]);
  if (b.status === 'conflict') rows.push(['⚠ Status', 'Paid after the moment was taken — find another time with them']);
  const src: Record<string, string> = {
    'zoom-api': 'its own Zoom meeting',
    calendar: 'the link on the Boekingen event',
    standard: 'the standard link',
    admin: 'set by hand',
  };
  rows.push(['Zoom', b.join_url ? `${b.join_url} (${src[b.join_source ?? ''] ?? 'link'})` : '⚠ no link yet — add one on /admin/sessions']);
  rows.push(['Calendar', b.calendar_event_id ? 'written into your calendar' : `⚠ not written${b.calendar_error ? `: ${b.calendar_error}` : ''}`]);
  return rows;
}
