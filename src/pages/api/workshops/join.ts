import type { APIRoute } from 'astro';
import {
  getRegistrationByAccessToken,
  getWorkshopById,
  markJoined,
  resolveZoomDetails,
} from '../../../lib/workshops/db';
import { joinWindowFor } from '../../../lib/workshops/time';
import { logEventSafe } from '../../../lib/registrations/db';

export const prerender = false;

// GET /api/workshops/join?t=<access_token>[&reveal=1]
//
// The only way into the Zoom room. Attendance is marked here, then we either
// 303-redirect to the resolved Zoom link, or — with reveal=1 — return the raw
// Zoom details as JSON (the "the button doesn't work for me" fallback for
// older clients that need the meeting id + passcode typed in by hand).
//
// The room is reachable inside the join window: 5 minutes before start until
// 20 minutes after for a first join — but someone who already joined once can
// REJOIN for the whole session (until its real end + a short grace), so a
// connectivity drop mid-workshop never locks them out (replays are always
// open). Too early bounces back to the countdown (?early=1); too late is
// treated as missed (?missed=1).
export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const token = (url.searchParams.get('t') ?? '').trim();
  const reveal = url.searchParams.get('reveal') === '1';
  if (!token) return bad(reveal, 'Bad request', 400);

  const reg = await getRegistrationByAccessToken(env.DB, token);
  if (!reg) return bad(reveal, 'Not found', 404);
  if (reg.payment_status !== 'paid' && reg.payment_status !== 'coupon') {
    return reveal
      ? json({ error: 'not_paid' }, 402)
      : redirect(`${base}/workshop/success?t=${token}`);
  }

  const workshop = await getWorkshopById(env.DB, reg.workshop_id);
  if (!workshop) return bad(reveal, 'Not found', 404);

  if (workshop.is_replay !== 1) {
    const win = joinWindowFor(
      workshop.starts_at_utc,
      workshop.ends_at_utc,
      !!reg.joined_at_utc,
    );
    if (win === 'early') {
      return reveal
        ? json({ error: 'early' }, 409)
        : redirect(`${base}/workshop/success?t=${token}&early=1`);
    }
    if (win === 'closed') {
      return reveal
        ? json({ error: 'missed' }, 410)
        : redirect(`${base}/workshop/success?t=${token}&missed=1`);
    }
  }

  const zoom = await resolveZoomDetails(env.DB, workshop);
  if (!zoom.url) {
    await logEventSafe(env.DB, { registration_id: null, kind: 'workshop.zoom.missing', payload: { workshop_id: workshop.id } });
    return reveal
      ? json({ error: 'no_zoom' }, 503)
      : redirect(`${base}/workshop/success?t=${token}&nozoom=1`);
  }

  await markJoined(env.DB, reg.id);
  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'workshop.joined',
    external_id: `workshop-join-${reg.id}`,
    payload: { workshop_id: workshop.id, registration_id: reg.id, reveal },
  });

  if (reveal) {
    return json({ zoom_url: zoom.url, meeting_id: zoom.meetingId, passcode: zoom.passcode }, 200);
  }
  return redirect(zoom.url);
};

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to } });
}
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function bad(reveal: boolean, message: string, status: number): Response {
  return reveal ? json({ error: message }, status) : new Response(message, { status });
}
