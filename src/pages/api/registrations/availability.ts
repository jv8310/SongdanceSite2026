import type { APIRoute } from 'astro';
import {
  getProductBySlug,
  computeTierAvailability,
} from '../../../lib/registrations/db';

export const prerender = false;

// GET /api/registrations/availability?product=ritual-of-belonging-2026
// → { tiers: [{ slug, name, price_cents, remaining, capacity }, ...] }
//
// Per-tier remaining counts are computed from the room model so the
// cross-tier coupling on multi-mode rooms is reflected live: e.g. a
// Private En-suite booking on Room 1.2 removes its 3 beds from
// Shared Bedroom availability automatically.
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

  const availability = await computeTierAvailability(env.DB, product.id);
  const tiers = availability.map(({ tier, remaining, capacity }) => ({
    slug: tier.slug,
    name: tier.name,
    price_cents: tier.price_cents,
    remaining,
    capacity,
  }));

  return new Response(JSON.stringify({ tiers }), {
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
