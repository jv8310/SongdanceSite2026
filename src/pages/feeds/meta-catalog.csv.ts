import type { APIRoute } from 'astro';
import { SITE_URL } from '../../lib/seo';
import { buildMainFeed } from '../../lib/catalog/feed';

export const prerender = false;

// Meta (Facebook) product catalog data feed — the EUR main feed. Meta polls
// this URL on a schedule and ingests each row as a catalog product; catalog ads
// then retarget visitors with the product they viewed, matched by `id` ⇄ the
// Pixel's `content_id` (both come from src/lib/catalog/products.ts, so they
// can't drift). USD is published as a separate country-override feed
// (./meta-catalog-us.csv) — Meta requires one currency per feed.
//
// CSV (not XML/RSS) because the set is tiny and static — column headers map 1:1
// to Meta's field names with no namespace ceremony. House style mirrors the
// hand-rolled sitemap (../sitemap.xml.ts) and the contacts CSV export
// (../api/admin/contacts/export.ts, where csvCell came from).

export const GET: APIRoute = ({ locals }) => {
  const base = (locals.runtime?.env?.PUBLIC_BASE_URL ?? SITE_URL).replace(/\/$/, '');
  const csv = buildMainFeed(base, 'EUR');

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
