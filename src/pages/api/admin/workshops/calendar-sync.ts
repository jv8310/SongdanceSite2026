import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { resolveGoogleConfig } from '../../../../lib/workshops/google-config';
import { syncMappedEvents } from '../../../../lib/workshops/calendar-sync';
import { logEvent } from '../../../../lib/registrations/db';

export const prerender = false;

// POST → finds the hard-coded calendar event types (SVH Workshop / SVH
// Masterclass) on the connected Google Calendar and publishes any new ones as
// workshops. Events already synced are skipped.
//
// Two callers, distinguished by content-type:
//   - A browser form post (the "Calendar sync" header button) → run the sync,
//     then 303-redirect back with a one-line flash summary.
//   - A fetch() from the settings page's "Sync now" → return JSON details.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const ct = request.headers.get('content-type') || '';
  const isForm = ct.includes('form-urlencoded') || ct.includes('multipart/form-data');
  let back = '/admin';
  if (isForm) {
    const form = await request.formData();
    const wanted = String(form.get('return') ?? '');
    if (wanted.startsWith('/admin')) back = wanted;
  }

  const cfg = await resolveGoogleConfig(env.DB, env);
  if (!cfg) {
    return isForm
      ? redirect(`${back}?flash=cal_notconnected`)
      : json({ error: 'Google Calendar isn’t connected yet. Configure it in Calendar sync settings.' }, 400);
  }

  try {
    const result = await syncMappedEvents(env.DB, cfg, 'published');
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'workshop.calendar.sync',
      payload: { created: result.created.length, skipped: result.skipped.length },
    });
    return isForm
      ? redirect(`${back}?flash=cal_synced&created=${result.created.length}&skipped=${result.skipped.length}`)
      : json(result);
  } catch (err) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.calendar.error', payload: { error: String(err) } });
    return isForm
      ? redirect(`${back}?flash=cal_error`)
      : json({ error: `Calendar sync failed: ${String(err)}` }, 502);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to } });
}
