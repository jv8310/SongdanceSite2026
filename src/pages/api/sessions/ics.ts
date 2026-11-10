import type { APIRoute } from 'astro';
import { buildICS } from '../../../lib/workshops/ics';
import { getBooking } from '../../../lib/sessions/db';
import { bookingUrl, verifyBookingToken } from '../../../lib/sessions/link';
import { SESSION_EMAIL_TITLE } from '../../../lib/sessions/confirm';

export const prerender = false;

// GET /api/sessions/ics?t=<booking token> → the session as an .ics file
// (Apple Calendar / Outlook), at its current time — a moved session's file
// carries the new time and the same UID, so calendars update the entry.
export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;
  const id = await verifyBookingToken(env.ADMIN_SESSION_SECRET, url.searchParams.get('t'));
  const b = id ? await getBooking(env.DB, id) : null;
  if (!b || (b.status !== 'booked' && b.status !== 'held')) return new Response('Not found', { status: 404 });
  const manage = await bookingUrl(env.ADMIN_SESSION_SECRET, env.PUBLIC_BASE_URL, b.id);
  const ics = buildICS({
    title: SESSION_EMAIL_TITLE,
    startsAtUtc: b.starts_at_utc,
    endsAtUtc: b.ends_at_utc,
    description: b.join_url
      ? `Zoom: ${b.join_url}${b.join_passcode ? ` (passcode ${b.join_passcode})` : ''}\n\nYour booking page:`
      : 'Your booking page has the Zoom link:',
    location: b.join_url ?? 'Zoom',
    url: manage,
    uid: `session-${b.id}@songdance.co`,
  });
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="songdance-session.ics"',
      'Cache-Control': 'no-store',
    },
  });
};
