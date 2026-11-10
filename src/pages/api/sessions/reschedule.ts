import type { APIRoute } from 'astro';
import { loadSessionSettings } from '../../../lib/sessions/config';
import { findOfferedSlot, loadAvailability } from '../../../lib/sessions/availability';
import { getBooking } from '../../../lib/sessions/db';
import { verifyBookingToken } from '../../../lib/sessions/link';
import { canClientMove, moveSession } from '../../../lib/sessions/actions';

export const prerender = false;

// The client moves their own session from their booking page — until the move
// window closes (rescheduleHours before the start, /admin/sessions). The new
// moment is checked against the calendar and the bookings right now, and taken
// in one statement (src/lib/sessions/db.ts moveBooking).
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  let body: { t?: string; start?: string };
  try {
    body = (await request.json()) as { t?: string; start?: string };
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const id = await verifyBookingToken(env.ADMIN_SESSION_SECRET, body.t);
  const b = id ? await getBooking(env.DB, id) : null;
  if (!b) return json({ error: 'Booking not found.' }, 404);

  const settings = await loadSessionSettings(env.DB);
  if (!canClientMove(b, settings.rescheduleHours)) {
    return json({ error: 'This session can no longer be moved here — just reply to your confirmation email.' }, 409);
  }
  const av = await loadAvailability(env, settings, { excludeBookingId: b.id });
  if (!av.ok) return json({ error: 'The calendar could not be read just now — please try again in a minute.' }, 503);
  const offered = findOfferedSlot(av, body.start ?? '');
  if (!offered) return json({ error: 'That moment is no longer free — please choose another.', taken: true }, 409);
  if (offered.slot.startUtc === b.starts_at_utc) return json({ ok: true, unchanged: true });

  const r = await moveSession(env, b, offered.slot, offered.window, `client:${b.email}`);
  if (!r.ok) return json({ error: r.message, taken: r.reason === 'taken' }, 409);
  return json({ ok: true, starts_at_utc: r.booking.starts_at_utc });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
