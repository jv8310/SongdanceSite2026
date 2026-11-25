// POST { start? } → move the Drip → contact list sync on by a few pages and
// answer where it stands; the page calls it until `done`. Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { dripConfig } from '../../../../lib/orders/drip-order';
import { stepDripContactSync } from '../../../../lib/contacts/drip-sync';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }
  let p: { start?: unknown } = {};
  try {
    p = (await request.json()) as { start?: unknown };
  } catch {
    /* an empty body carries the run on */
  }
  const step = await stepDripContactSync(env.DB, dripConfig(env), { maxPages: 3, start: p.start === true });
  if (!step.ok) return json({ error: step.message, state: step.state }, 502);
  return json({ done: step.done, state: step.state });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
