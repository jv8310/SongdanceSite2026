import type { APIRoute } from 'astro';
import {
  getProductBySlug,
  getTiersForProduct,
  getTierAvailability,
} from '../../../lib/registrations/db';

export const prerender = false;

// GET /api/registrations/availability?product=ritual-of-belonging-2026
// → { tiers: [{ slug, name, price_cents, remaining, capacity }, ...] }
//
// Returns the remaining-bed count per active tier so the on-page
// registration form can show a "X spots left" nudge when a room
// type drops to a low remaining count.
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

  const tiers = await getTiersForProduct(env.DB, product.id);
  const out = await Promise.all(
    tiers.map(async (t) => {
      const av = await getTierAvailability(env.DB, t.id);
      return {
        slug: t.slug,
        name: t.name,
        price_cents: t.price_cents,
        remaining: av.remaining,
        capacity: av.capacity,
      };
    }),
  );

  return new Response(JSON.stringify({ tiers: out }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Always fresh — capacity changes with each registration.
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
