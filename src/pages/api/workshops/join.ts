import type { APIRoute } from 'astro';
import {
  getRegistrationById,
  getWorkshopById,
  markJoined,
  resolveZoomUrl,
} from '../../../lib/workshops/db';
import { JOIN_THRESHOLD_SECONDS } from '../../../lib/workshops/time';
import { logEvent } from '../../../lib/registrations/db';

export const prerender = false;

// GET /api/workshops/join?rid=<registration_id>
//
// Marks attendance and 303-redirects to the resolved Zoom link, but only
// within 15 minutes of start (or any time for a replay). Earlier than that we
// bounce back to the countdown page with ?early=1.
export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const rid = parseInt(url.searchParams.get('rid') ?? '', 10);
  if (!Number.isFinite(rid)) return new Response('Bad request', { status: 400 });

  const reg = await getRegistrationById(env.DB, rid);
  if (!reg) return new Response('Not found', { status: 404 });
  if (reg.payment_status !== 'paid' && reg.payment_status !== 'coupon') {
    return redirect(`${base}/workshop/success?rid=${rid}`);
  }

  const workshop = await getWorkshopById(env.DB, reg.workshop_id);
  if (!workshop) return new Response('Not found', { status: 404 });

  const now = Date.now();
  const startMs = new Date(workshop.starts_at_utc).getTime();
  const open = workshop.is_replay === 1 || now >= startMs - JOIN_THRESHOLD_SECONDS * 1000;
  if (!open) {
    return redirect(`${base}/workshop/success?rid=${rid}&early=1`);
  }

  const zoom = await resolveZoomUrl(env.DB, workshop);
  if (!zoom) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.zoom.missing', payload: { workshop_id: workshop.id } });
    return redirect(`${base}/workshop/success?rid=${rid}&nozoom=1`);
  }

  await markJoined(env.DB, rid);
  await logEvent(env.DB, {
    registration_id: null,
    kind: 'workshop.joined',
    external_id: `workshop-join-${rid}`,
    payload: { workshop_id: workshop.id, registration_id: rid },
  });

  return redirect(zoom);
};

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to } });
}
