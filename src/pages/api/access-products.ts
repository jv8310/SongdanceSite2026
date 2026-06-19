// POST { email, hp } → { ok: true }
//
// "Activate all my products" from /access. Applies the `prod_access` tag to the
// subscriber in Drip; a Drip automation listening for that tag sends the email
// that walks people through activating their products in the Songdance CiRCLE.
// Drip creates the subscriber if the address is new, so this is safe for anyone
// who reaches the page. The only side effect is on Drip (+ an audit event).

import type { APIRoute } from 'astro';
import { applyTag } from '../../lib/registrations/drip';
import { logEvent } from '../../lib/registrations/db';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCESS_TAG = 'prod_access';

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  let body: { email?: string; hp?: string };
  try {
    body = (await request.json()) as { email?: string; hp?: string };
  } catch {
    return json(400, { ok: false, error: 'bad-json' });
  }

  // Honeypot: bots fill the hidden field. Accept silently so they move on.
  if (typeof body.hp === 'string' && body.hp.trim() !== '') {
    return json(200, { ok: true });
  }

  const email = (body.email ?? '').toString().trim().slice(0, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return json(400, { ok: false, error: 'bad-email' });
  }

  const apiToken = env.DRIP_API_TOKEN;
  const accountId = env.DRIP_ACCOUNT_ID;
  if (!apiToken || !accountId) {
    console.warn('[access-products] missing Drip config');
    return json(500, { ok: false, error: 'no-config' });
  }

  try {
    await applyTag({ apiToken, accountId }, email, ACCESS_TAG);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[access-products] drip applyTag failed: ${msg}`);
    return json(502, { ok: false, error: 'upstream' });
  }

  // Best-effort audit trail; never let a logging hiccup fail the request.
  try {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'access.products.requested',
      source: 'system',
      payload: { email },
    });
  } catch (err) {
    console.warn(`[access-products] logEvent failed: ${String(err)}`);
  }

  return json(200, { ok: true });
};
