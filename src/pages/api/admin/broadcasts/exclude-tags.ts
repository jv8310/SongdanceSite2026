// POST { id, tags } → remove still-pending recipients carrying any of the
// (comma-separated) tags from a launched broadcast's queue, e.g. addresses Drip
// flagged undeliverable. Returns how many were removed. Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getBroadcast, suppressPendingByTags } from '../../../../lib/broadcasts/db';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: { id?: number; tags?: string };
  try {
    payload = (await request.json()) as { id?: number; tags?: string };
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const id = Number(payload.id);
  const b = id ? await getBroadcast(env.DB, id) : null;
  if (!b) return json({ error: 'Broadcast not found.' }, 404);

  const tags = (payload.tags ?? '').trim();
  if (!tags) return json({ error: 'Enter one or more tags.' }, 400);

  try {
    const removed = await suppressPendingByTags(env.DB, id, tags);
    return json({ ok: true, removed });
  } catch (err) {
    return json({ error: `Failed: ${String(err)}` }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
