// Changing a booked session: a move (the client from their booking page, until
// the move window closes) and a cancel (an admin, or a full refund). Each one
// carries the change to Zoom, to Jacob's calendar and to the client.

import { logEventSafe } from '../registrations/db';
import { resolveGoogleConfig } from '../workshops/google-config';
import { formatInTz } from '../workshops/time';
import { deleteSessionEvent, patchSessionEvent } from './calendar';
import { loadSessionSettings } from './config';
import {
  getBooking,
  markCancelled,
  moveBooking,
  setCalendarResult,
  setMeeting,
  type SessionBooking,
} from './db';
import {
  bookingName,
  brusselsWhen,
  calendarEventFor,
  clientTz,
  emailCtxFor,
  ensureCalendarEvent,
  ensureMeeting,
  sendClientEmail,
  sendInternal,
  type SessionEnv,
} from './confirm';
import { sessionCancelledEmail, sessionMovedEmail } from './emails';
import type { Slot, Window } from './slots';
import { deleteZoomMeeting, updateZoomMeeting, zoomConfigured } from './zoom';

export type MoveResult =
  | { ok: true; booking: SessionBooking }
  | { ok: false; reason: 'not-booked' | 'too-late' | 'taken'; message: string };

export function canClientMove(b: SessionBooking, rescheduleHours: number, now = Date.now()): boolean {
  if (b.status !== 'booked' || rescheduleHours <= 0) return false;
  return Date.parse(b.starts_at_utc) - rescheduleHours * 3_600_000 > now;
}

export async function moveSession(
  env: SessionEnv,
  b: SessionBooking,
  slot: Slot,
  window: Window | null,
  by: string,
  opts?: { ignoreWindow?: boolean },
): Promise<MoveResult> {
  const settings = await loadSessionSettings(env.DB);
  if (b.status !== 'booked') return { ok: false, reason: 'not-booked', message: 'This session can no longer be moved.' };
  if (!opts?.ignoreWindow && !canClientMove(b, settings.rescheduleHours)) {
    return { ok: false, reason: 'too-late', message: 'This session is too close to move here — just reply to your confirmation email.' };
  }
  const previous = b.starts_at_utc;
  const moved = await moveBooking(env.DB, b.id, {
    startsAtUtc: slot.startUtc,
    endsAtUtc: slot.endUtc,
    durationMin: b.duration_min,
    bufferMin: settings.bufferMin,
    sourceEventId: slot.eventId,
  });
  if (!moved) return { ok: false, reason: 'taken', message: 'That moment was just taken — please choose another.' };
  let nb = (await getBooking(env.DB, b.id))!;

  // The meeting follows the new time: the Zoom API meeting is moved; a link
  // taken from the old "Boekingen" event becomes the new event's (or the
  // standard one); a link set by hand stays.
  if (nb.zoom_meeting_id && zoomConfigured(env)) {
    try {
      await updateZoomMeeting(env, nb.zoom_meeting_id, { startUtc: nb.starts_at_utc, durationMin: nb.duration_min });
    } catch (err) {
      await logEventSafe(env.DB, { registration_id: null, kind: 'session.zoom.update_error', source: 'system', payload: { booking_id: nb.id, error: String(err) } });
    }
  } else if (nb.join_source === 'calendar' || nb.join_source === 'standard' || !nb.join_url) {
    if (window?.joinUrl) {
      await setMeeting(env.DB, nb.id, { zoomMeetingId: null, joinUrl: window.joinUrl, passcode: window.passcode, source: 'calendar' });
    } else {
      await setMeeting(env.DB, nb.id, { zoomMeetingId: null, joinUrl: null, passcode: null, source: null });
    }
    nb = (await getBooking(env.DB, nb.id))!;
    nb = await ensureMeeting(env, nb, settings);
  }
  nb = (await getBooking(env.DB, nb.id))!;

  // Jacob's calendar.
  const cfg = await resolveGoogleConfig(env.DB, env as never).catch(() => null);
  if (cfg && nb.calendar_event_id) {
    const r = await patchSessionEvent(cfg, nb.calendar_event_id, calendarEventFor(env, nb));
    await setCalendarResult(env.DB, nb.id, r.ok ? { error: null } : { error: r.error });
  } else {
    nb = await ensureCalendarEvent(env, nb);
  }
  nb = (await getBooking(env.DB, nb.id))!;

  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'session.booking.moved',
    source: by.startsWith('admin:') ? 'admin' : 'system',
    payload: { booking_id: nb.id, from: previous, to: nb.starts_at_utc, by },
  });

  const ctx = await emailCtxFor(env, nb, settings);
  await sendClientEmail(
    env,
    nb,
    sessionMovedEmail({ ...ctx, previousLocal: formatInTz(previous, clientTz(nb)) }),
    { kind: 'session.moved.sent', track: 'session_moved' },
  );
  await sendInternal(env, `SD-SESSION: ${bookingName(nb)} moved their session to ${brusselsWhen(nb.starts_at_utc)}`, [
    `${bookingName(nb)} (${nb.email}) moved their individual session.`,
    `From: ${brusselsWhen(previous)}`,
    `To: ${brusselsWhen(nb.starts_at_utc)}`,
    nb.calendar_event_id && !nb.calendar_error ? 'Your calendar has been updated.' : `Your calendar was not updated${nb.calendar_error ? `: ${nb.calendar_error}` : ''}.`,
    by.startsWith('admin:') ? `Moved by ${by.slice(6)}.` : 'Moved by the client from their booking page.',
  ]);
  return { ok: true, booking: nb };
}

export async function cancelSession(
  env: SessionEnv,
  id: number,
  opts: { reason: string; emailClient: boolean; message?: string | null; by: string },
): Promise<{ ok: boolean; message: string }> {
  const b = await getBooking(env.DB, id);
  if (!b) return { ok: false, message: 'Booking not found.' };
  if (!(await markCancelled(env.DB, id, opts.reason))) {
    return { ok: false, message: 'This booking was already cancelled or never confirmed.' };
  }
  const notes: string[] = [];
  if (b.zoom_meeting_id && zoomConfigured(env)) {
    try {
      await deleteZoomMeeting(env, b.zoom_meeting_id);
      notes.push('Zoom meeting deleted');
    } catch (err) {
      notes.push('the Zoom meeting could not be deleted');
      await logEventSafe(env.DB, { registration_id: null, kind: 'session.zoom.delete_error', source: 'system', payload: { booking_id: id, error: String(err) } });
    }
  }
  if (b.calendar_event_id) {
    const cfg = await resolveGoogleConfig(env.DB, env as never).catch(() => null);
    const r = cfg ? await deleteSessionEvent(cfg, b.calendar_event_id) : { ok: false as const, error: 'not connected' };
    notes.push(r.ok ? 'calendar entry removed' : 'the calendar entry could not be removed — delete it by hand');
  }
  if (opts.emailClient && b.status === 'booked') {
    const sent = await sendClientEmail(
      env,
      b,
      sessionCancelledEmail({ name: b.first_name, whenLocal: formatInTz(b.starts_at_utc, clientTz(b)), message: opts.message }),
      { kind: 'session.cancelled.sent', track: 'session_cancelled' },
    );
    notes.push(sent ? 'the client was emailed' : 'the email to the client failed');
  }
  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'session.booking.cancelled',
    source: opts.by.startsWith('admin:') ? 'admin' : 'system',
    payload: { booking_id: id, reason: opts.reason, by: opts.by, notes },
  });
  return { ok: true, message: `Cancelled${notes.length ? ` — ${notes.join(', ')}` : ''}.` };
}

// "Write to the calendar again" on the admin page (after Connect was pressed
// again with write access, say).
export async function rewriteCalendar(env: SessionEnv, id: number): Promise<{ ok: boolean; message: string }> {
  const b = await getBooking(env.DB, id);
  if (!b || b.status !== 'booked') return { ok: false, message: 'Only a booked session can be written to the calendar.' };
  const cfg = await resolveGoogleConfig(env.DB, env as never).catch(() => null);
  if (!cfg) return { ok: false, message: 'Google Calendar is not connected.' };
  if (b.calendar_event_id) {
    const r = await patchSessionEvent(cfg, b.calendar_event_id, calendarEventFor(env, b));
    await setCalendarResult(env.DB, id, r.ok ? { error: null } : { error: r.error });
    return r.ok ? { ok: true, message: 'Calendar entry updated.' } : { ok: false, message: r.error };
  }
  const nb = await ensureCalendarEvent(env, b);
  return nb.calendar_event_id ? { ok: true, message: 'Written into your calendar.' } : { ok: false, message: nb.calendar_error ?? 'Could not write it.' };
}
