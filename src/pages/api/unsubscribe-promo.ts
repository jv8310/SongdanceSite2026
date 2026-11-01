// POST { e: email } → the launch-campaign opt-out: the contact gets the
// `nopromo_june26` tag on the site's own list (so a site broadcast can exclude
// it) and `nopromo_June26` in Drip (best-effort, its segments still read it).
// They stay on the general list — this is a campaign opt-out, not a full
// unsubscribe (that lives at /unsubscribe + /api/unsubscribe).
//
// Called by a small script on /unsubscribe-promo when the page loads, rather
// than on GET, so link-prefetchers and email security scanners (which don't
// run JavaScript) can't opt anyone out by accident. The link is unsigned, so
// the endpoint answers same-site requests only and never creates a contact
// (src/lib/contacts/promo-optout.ts).

import type { APIRoute } from 'astro';
import { recordPromoOptOut } from '../../lib/contacts/promo-optout';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, url }) => {
  const env = locals.runtime.env;

  // Same-site only: a page elsewhere must not be able to tag addresses by
  // posting at us. (A request with no Origin is let through, as on
  // /api/newsletter — it still only tags an existing contact.)
  const origin = request.headers.get('origin');
  if (origin) {
    let sameSite = false;
    try {
      sameSite = new URL(origin).host === url.host;
    } catch {
      sameSite = false;
    }
    if (!sameSite) return json({ error: 'origin' }, 403);
  }

  let email = '';
  try {
    const body = (await request.json()) as { e?: string };
    email = (body.e ?? '').trim().toLowerCase();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'A valid email is required.' }, 400);
  }

  // The local write is authoritative; a Drip failure still answers ok.
  await recordPromoOptOut(env, email);
  return json({ ok: true });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
