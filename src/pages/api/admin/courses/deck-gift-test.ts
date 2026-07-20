// Admin self-test for the Songdeck gift → Shopify wiring.
//
//   GET  → READ-ONLY connection check: mints a token and resolves the deck
//          variant, so you can confirm the domain / auth / scopes / product id
//          are right without creating anything. Just open it in the browser
//          while signed into /admin.
//   POST { place: true, email?, address? } → places a REAL €0 test order
//          (tagged TEST) so the full path can be confirmed end to end. Cancel
//          the order in Shopify afterwards.
//
// Both are admin-gated. No-ops with a clear message until the Shopify secrets
// are set.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { testDeckGiftShopify } from '../../../../lib/orders/shopify';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const r = await testDeckGiftShopify(env, { place: false });
  return json(r, r.ok ? 200 : 400);
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  let body: {
    place?: boolean;
    email?: string;
    address?: Record<string, unknown>;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* empty body → connection check only */
  }
  const r = await testDeckGiftShopify(env, {
    place: body?.place === true,
    email: typeof body?.email === 'string' ? body.email : undefined,
    address:
      body?.address && typeof body.address === 'object'
        ? (body.address as any)
        : undefined,
  });
  return json(r, r.ok ? 200 : 400);
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
