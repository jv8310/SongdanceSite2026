import type { APIRoute } from 'astro';
import {
  getRegistrationById,
  getWorkshopById,
  markJoined,
  resolveZoomDetails,
} from '../../../lib/workshops/db';
import { joinWindow } from '../../../lib/workshops/time';
import { logEvent } from '../../../lib/registrations/db';

export const prerender = false;

// GET /api/workshops/join?rid=<registration_id>[&reveal=1]
//
// The only way into the Zoom room. Attendance is marked here, then we either
// 303-redirect to the resolved Zoom link, or — with reveal=1 — return the raw
// Zoom details as JSON (the "the button doesn't work for me" fallback for
// older clients that need the meeting id + passcode typed in by hand).
//
// The room is reachable only inside the join window: 5 minutes before start
// until 15 minutes after (replays are always open). Too early bounces back to
// the countdown (?early=1); too late is treated as missed (?missed=1).
export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const rid = parseInt(url.searchParams.get('rid') ?? '', 10);
  const reveal = url.searchParams.get('reveal') === '1';
  if (!Number.isFinite(rid)) return bad(reveal, 'Bad request', 400);

  const reg = await getRegistrationById(env.DB, rid);
  if (!reg) return bad(reveal, 'Not found', 404);
  if (reg.payment_status !== 'paid' && reg.payment_status !== 'coupon') {
    return reveal
      ? json({ error: 'not_paid' }, 402)
      : redirect(`${base}/workshop/success?rid=${rid}`);
  }

  const workshop = await getWorkshopById(env.DB, reg.workshop_id);
  if (!workshop) return bad(reveal, 'Not found', 404);

  if (workshop.is_replay !== 1) {
    const win = joinWindow(workshop.starts_at_utc);
    if (win === 'early') {
      return reveal
        ? json({ error: 'early' }, 409)
        : redirect(`${base}/workshop/success?rid=${rid}&early=1`);
    }
    if (win === 'closed') {
      return reveal
        ? json({ error: 'missed' }, 410)
        : redirect(`${base}/workshop/success?rid=${rid}&missed=1`);
    }
  }

  const zoom = await resolveZoomDetails(env.DB, workshop);
  if (!zoom.url) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.zoom.missing', payload: { workshop_id: workshop.id } });
    return reveal
      ? json({ error: 'no_zoom' }, 503)
      : redirect(`${base}/workshop/success?rid=${rid}&nozoom=1`);
  }

  await markJoined(env.DB, rid);
  await logEvent(env.DB, {
    registration_id: null,
    kind: 'workshop.joined',
    external_id: `workshop-join-${rid}`,
    payload: { workshop_id: workshop.id, registration_id: rid, reveal },
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
