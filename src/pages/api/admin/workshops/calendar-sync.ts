import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { resolveGoogleConfig } from '../../../../lib/workshops/google-config';
import { syncMappedEvents } from '../../../../lib/workshops/calendar-sync';
import { logEvent } from '../../../../lib/registrations/db';

export const prerender = false;

// POST → finds the hard-coded calendar event types (SVH Workshop / SVH
// Masterclass) on the connected Google Calendar and publishes any new ones as
// workshops. Events already synced are skipped.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const cfg = await resolveGoogleConfig(env.DB, env);
  if (!cfg) {
    return json({ error: 'Google Calendar isn’t connected yet. Configure it in Calendar sync settings.' }, 400);
  }

  try {
    const result = await syncMappedEvents(env.DB, cfg, 'published');
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'workshop.calendar.sync',
      payload: { created: result.created.length, skipped: result.skipped.length },
    });
    return json(result);
  } catch (err) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.calendar.error', payload: { error: String(err) } });
    return json({ error: `Calendar sync failed: ${String(err)}` }, 502);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
