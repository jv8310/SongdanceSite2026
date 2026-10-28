// POST { email, country? } → { currency, bumps } — the course order bumps (ASJ /
// Grief, src/lib/courses/bumps.ts) this buyer doesn't already own, priced in
// the currency of their country. For a checkout that has no status call of its
// own (the Forgiveness Course); the 12-week and certification checkouts get the
// same list from their own status endpoints.
//
// Ownership is read from the buyer's Drip tags, as everywhere else: Drip
// unreachable or an unknown address offers every bump (eligibleBumpOffers fails
// open). Display only — the checkout prices whatever is ticked itself.

import type { APIRoute } from 'astro';
import { getSubscriber } from '../../../lib/registrations/drip';
import { eligibleBumpOffers } from '../../../lib/courses/bumps';
import { currencyForCountry, isSupportedCurrency, type SupportedCurrency } from '../../../lib/workshops/currency';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  let payload: { email?: string; country?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const email = (payload.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400);
  }
  const c = currencyForCountry((payload.country ?? '').trim().toUpperCase());
  const currency: SupportedCurrency = isSupportedCurrency(c) ? c : 'EUR';
  const sub = await getSubscriber({ apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID }, email).catch(
    () => null,
  );
  return json({ currency, bumps: eligibleBumpOffers(currency, sub ? sub.tags : null) });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
