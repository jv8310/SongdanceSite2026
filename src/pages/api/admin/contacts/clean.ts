// POST {} → resolve one batch of the contact list's unchecked domains (MX/A via
// DNS-over-HTTPS) and, once every domain is resolved, add all addresses at dead
// domains to the global suppression list (and scrub live broadcast queues). The
// admin page calls this repeatedly until `remaining` is 0. Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { cleanContactDomains } from '../../../../lib/broadcasts/clean';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const result = await cleanContactDomains(env.DB, 20);
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
