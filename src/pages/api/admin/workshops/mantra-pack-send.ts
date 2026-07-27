import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  pendingMantraPackCount,
  resolveMantraPackTarget,
  runMantraPackBackfill,
} from '../../../../lib/workshops/mantra-pack';

export const prerender = false;

// Manual "deliver the mantra pack now" trigger for /admin/emails — the same
// catch-up sweep the 5-minute cron runs, forced with a wider cap so a backlog
// of past bump buyers clears in one click instead of over several ticks.
// Idempotent (each buyer is claimed once), so pressing it twice is harmless.
//
// GET  → how many paid bump buyers are still waiting (drives the panel's line)
// POST → send the next batch
export const GET: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const target = await resolveMantraPackTarget(env.DB);
    if (!target) return json({ configured: false, pending: 0 });
    return json({
      configured: true,
      album: { id: target.album.id, title: target.album.title },
      pending: await pendingMantraPackCount(env.DB, target.productId),
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const r = await runMantraPackBackfill(env, { limit: 150 });
    if (r.skipped) {
      const message =
        r.reason === 'no_resend_key'
          ? 'Email is not configured (RESEND_API_KEY is unset).'
          : r.reason === 'no_album'
            ? `No published music album carries the mantra bump's Drip tag, so there'd be nothing to link to. Publish the album on /admin/music with that tag first.`
            : 'The mantra-pack bump product is not set up yet.';
      return json({ error: message }, 400);
    }
    return json(r);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
