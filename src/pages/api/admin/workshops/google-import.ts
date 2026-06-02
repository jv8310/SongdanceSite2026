import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { findEventsByTitle } from '../../../../lib/workshops/google-calendar';
import { resolveGoogleConfig } from '../../../../lib/workshops/google-config';
import { upsertWorkshopFromGoogle } from '../../../../lib/workshops/db';
import { logEvent } from '../../../../lib/registrations/db';

export const prerender = false;

// POST { title } → finds matching upcoming Google Calendar events and upserts
// each as a draft workshop (keyed on google_event_id, so re-running updates).
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  let title = '';
  try {
    title = String(((await request.json()) as { title?: string }).title ?? '').trim();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  if (!title) return json({ error: 'Enter an event title to search for.' }, 400);

  const cfg = await resolveGoogleConfig(env.DB, env);
  if (!cfg) {
    return json({ error: 'Google Calendar isn’t connected yet. Connect it in the settings above.' }, 400);
  }

  let events;
  try {
    events = await findEventsByTitle(cfg, title);
  } catch (err) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.google.error', payload: { title, error: String(err) } });
    return json({ error: `Google Calendar lookup failed: ${String(err)}` }, 502);
  }

  const results: Array<{ id: number; title: string; startsAtUtc: string; created: boolean }> = [];
  const skipped: Array<{ summary: string; reason: string }> = [];
  for (const ev of events) {
    if (ev.isAllDay || !ev.startUtc) {
      skipped.push({ summary: ev.summary, reason: 'all-day / no time' });
      continue;
    }
    const { id, created } = await upsertWorkshopFromGoogle(env.DB, {
      googleEventId: ev.id,
      title: ev.summary,
      startsAtUtc: ev.startUtc,
      endsAtUtc: ev.endUtc,
      displayTz: ev.timeZone ?? 'Europe/Brussels',
    });
    results.push({ id, title: ev.summary, startsAtUtc: ev.startUtc, created });
  }

  return json({ imported: results, skipped });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
