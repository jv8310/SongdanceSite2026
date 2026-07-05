import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getWorkshopById } from '../../../../lib/workshops/db';
import { sendWorkshopBriefing } from '../../../../lib/workshops/cron';

export const prerender = false;

// Admin action: send the internal "SD-BRIEFING" ops email for a workshop right
// now, on demand. Normally the 5-minute cron fires it ~5 min before the start;
// this is the manual override — to re-send one, or to send it by hand if a tick
// was missed. `force` sends even when the once-per-workshop claim is already
// taken, then stamps the claim so the cron won't double up.
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

  let flash = 'briefing_sent';
  try {
    await sendWorkshopBriefing(env, workshop, { force: true });
  } catch (err) {
    console.error('[admin] send-briefing failed', err);
    flash = 'briefing_error';
  }

  return new Response(null, {
    status: 302,
    headers: { Location: `/admin/workshops/${id}?flash=${flash}` },
  });
};
