import type { APIRoute } from 'astro';
import {
  getProductBySlug,
  getSpecialRoomAvailability,
} from '../../../lib/registrations/db';
import {
  availabilityForVisitor,
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
// `?claim=<token>` is a waiting-list claim link: the room being kept for that
// person reads as open, for them only — their own hold is excluded and the
// offered tier is granted its one place (availabilityForVisitor). The response
// echoes the offer back as `claim`, so a page can tell "this visitor holds a
// live offer" from the same request rather than asking a second time.
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

  const [availability, special] = await Promise.all([
    availabilityForVisitor(env.DB, product.id, claim),
    getSpecialRoomAvailability(env.DB, product.id),
  ]);
  const tiers = availability.map(({ tier, remaining, capacity }) => ({
    slug: tier.slug,
    name: tier.name,
    price_cents: tier.price_cents,
    remaining,
    capacity,
  }));
  const claimedTier = claim
    ? (availability.find((a) => a.tier.id === claim.offered_tier_id)?.tier ?? null)
    : null;

  return new Response(JSON.stringify({
    tiers,
    ...special,
    claim: claimedTier ? { tier_slug: claimedTier.slug, tier_name: claimedTier.name } : null,
  }), {
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
