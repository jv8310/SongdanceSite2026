// POST { id } → resolve one batch of the broadcast's unchecked pending domains
// (MX/A via DNS-over-HTTPS) and suppress recipients at dead domains. The admin
// page calls this repeatedly until `remaining` is 0. Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getBroadcast } from '../../../../lib/broadcasts/db';
import { cleanPendingDomains } from '../../../../lib/broadcasts/clean';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: { id?: number };
  try {
    payload = (await request.json()) as { id?: number };
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const id = Number(payload.id);
  const b = id ? await getBroadcast(env.DB, id) : null;
  if (!b) return json({ error: 'Broadcast not found.' }, 404);

  try {
    const result = await cleanPendingDomains(env.DB, id, 20);
    return json({ ok: true, ...result });
  } catch (err) {
    return json({ error: `Clean failed: ${String(err)}` }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
