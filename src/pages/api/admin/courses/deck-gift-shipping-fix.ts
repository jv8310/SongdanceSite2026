// Repair the shipping method on Songdeck gift orders already placed in Shopify.
//
//   GET                  → report only: each gift order, its shipping line now
//                          and the method the shop offers for its address.
//   POST { apply: true } → also swap every wrong line for that method at €0
//                          (an order edit, no customer notification).
//
// Admin-gated. See fixDeckGiftShipping in src/lib/orders/shopify.ts.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { fixDeckGiftShipping } from '../../../../lib/orders/shopify';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const r = await fixDeckGiftShipping(env, { apply: false });
  return json(r, r.error ? 400 : 200);
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  let body: { apply?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* empty body → report only */
  }
  const r = await fixDeckGiftShipping(env, { apply: body?.apply === true });
  return json(r, r.error ? 400 : 200);
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
