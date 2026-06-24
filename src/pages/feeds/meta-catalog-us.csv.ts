import type { APIRoute } from 'astro';
import { buildOverrideFeed } from '../../lib/catalog/feed';

export const prerender = false;

// USD country-override feed for the Meta catalog. Upload this in Commerce
// Manager as a country/language override (country = US) on top of the EUR main
// feed (./meta-catalog.csv). It carries only id + price, so US viewers see USD
// pricing while every other field (and every other market) comes from the main
// feed. Meta requires one currency per feed, so USD lives here rather than in
// the main file.

export const GET: APIRoute = () => {
  const csv = buildOverrideFeed('USD');

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
