// POST { e: email } → tags the subscriber `nopromo_June26` in Drip so a
// segment can exclude them from the June 2026 launch campaign. They stay on
// the general monthly list — this is a campaign opt-out, not a full
// unsubscribe (that lives at /unsubscribe + /api/unsubscribe).
//
// Called by a small script on /unsubscribe-promo when the page loads, rather
// than on GET, so link-prefetchers and email security scanners (which don't
// run JavaScript) can't opt anyone out by accident.

import type { APIRoute } from 'astro';
import { applyTag } from '../../lib/registrations/drip';

export const prerender = false;

// The promo campaign tag. Bump this string if a future launch window reuses
// this page so each campaign gets its own opt-out segment.
const PROMO_TAG = 'nopromo_June26';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  let email = '';
  try {
    const body = (await request.json()) as { e?: string };
    email = (body.e ?? '').trim().toLowerCase();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'A valid email is required.' }, 400);
  }

  try {
    await applyTag(
      { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID },
      email,
      PROMO_TAG,
    );
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) }, 502);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
