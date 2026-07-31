import type { APIRoute } from 'astro';
import {
  getProductBySlug,
  computeTierAvailability,
  getSpecialRoomAvailability,
} from '../../../lib/registrations/db';
import {
  applyHolds,
  countActiveOffersByTier,
  getLiveOfferByToken,
} from '../../../lib/registrations/waitlist';

export const prerender = false;

// GET /api/registrations/availability?product=ritual-of-belonging-2026
// → { tiers: [{ slug, name, price_cents, remaining, capacity }, ...] }
//
// Per-tier remaining counts are computed from the room model so the
// cross-tier coupling on multi-mode rooms is reflected live: e.g. a
// Private En-suite booking on Room 1.2 removes its 3 beds from
// Shared Bedroom availability automatically. Places currently promised to
// someone on the waiting list are then subtracted — they aren't on sale.
//
// `?claim=<token>` is a waiting-list claim link: it excludes that person's own
// hold, so the room being kept for them reads as open, for them only.
export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;
  const productSlug = url.searchParams.get('product');
  if (!productSlug) {
    return json({ error: 'Missing product parameter' }, 400);
  }

  const product = await getProductBySlug(env.DB, productSlug);
  if (!product) {
    return json({ error: 'Unknown product' }, 404);
  }

  const claimToken = (url.searchParams.get('claim') ?? '').trim();
  const found = claimToken ? await getLiveOfferByToken(env.DB, claimToken) : null;
  const claim = found && found.product_id === product.id ? found : null;

  const [rawAvailability, special, holds] = await Promise.all([
    computeTierAvailability(env.DB, product.id),
    getSpecialRoomAvailability(env.DB, product.id),
    countActiveOffersByTier(env.DB, product.id, { exceptEntryId: claim?.id ?? null }),
  ]);
  const availability = applyHolds(rawAvailability, holds);
  const tiers = availability.map(({ tier, remaining, capacity }) => ({
    slug: tier.slug,
    name: tier.name,
    price_cents: tier.price_cents,
    remaining,
    capacity,
  }));

  return new Response(JSON.stringify({ tiers, ...special }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
