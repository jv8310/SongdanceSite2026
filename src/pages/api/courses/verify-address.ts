// POST { line1, line2?, city, region?, postal_code?, country } → runs the
// shipping address through Google's Address Validation API and returns a
// standardised suggestion when Google corrected / completed anything.
//
// Called by the course checkout (CCRegister / TWRegister) while the Song Deck
// gift window is live, just before submitting the order, so the buyer can accept
// a "did you mean …" correction. The API key stays server-side.
//
// Fail-open: unconfigured or an API error returns { configured:false } /
// { needsConfirmation:false }, and the checkout ships the typed address as-is —
// a free gift is never allowed to block a paid course sale.

import type { APIRoute } from 'astro';
import { validateAddress } from '../../../lib/address/google-validate';

export const prerender = false;

type Body = {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const line1 = (payload.line1 ?? '').trim();
  const city = (payload.city ?? '').trim();
  const country = (payload.country ?? '').trim().toUpperCase();

  // Not enough to check yet — tell the client to just proceed (it validates the
  // required fields itself before allowing submit).
  if (!line1 || !city || !country) {
    return json({ configured: false, ok: false, needsConfirmation: false, suggestion: null });
  }

  try {
    const check = await validateAddress(env, {
      line1,
      line2: (payload.line2 ?? '').trim(),
      city,
      region: (payload.region ?? '').trim(),
      postal_code: (payload.postal_code ?? '').trim(),
      country,
    });

    return json({
      configured: check.configured,
      ok: check.ok,
      needsConfirmation: check.needsConfirmation,
      issue: check.issue ?? null,
      suggestion: check.standardized
        ? { ...check.standardized, formatted: check.formatted }
        : null,
    });
  } catch (err) {
    // Fail open — never block the checkout on an address check.
    return json({
      configured: false,
      ok: false,
      needsConfirmation: false,
      suggestion: null,
      error: String(err),
    });
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
