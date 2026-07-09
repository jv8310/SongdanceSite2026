import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getWorkshopById } from '../../../../lib/workshops/db';
import { sendLiveNowReminders } from '../../../../lib/workshops/cron';

export const prerender = false;

// Admin action: send the "We're live now" reminder (the terminal reminder_5m
// touch, with the join link) to a workshop's whole paid/coupon roster right now.
// The manual override for when a session has gone live but the automatic 5-minute
// reminder didn't land. Sends unconditionally, then claims each reminder_5m slot
// so the cron won't double up (see sendLiveNowReminders).
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const id = parseInt(String(form.get('workshop_id') ?? ''), 10);
  if (!Number.isFinite(id)) return new Response('Bad request', { status: 400 });

  const workshop = await getWorkshopById(env.DB, id);
  if (!workshop) return new Response('Not found', { status: 404 });

  const result = await sendLiveNowReminders(env, id);
  const flash = result.ok ? `live_sent_${result.sent}` : 'live_error';
  return new Response(null, {
    status: 302,
    headers: { Location: `/admin/workshops/${id}?flash=${flash}` },
  });
};
