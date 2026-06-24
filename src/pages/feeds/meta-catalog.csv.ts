import type { APIRoute } from 'astro';
import { SITE_URL } from '../../lib/seo';
import { CATALOG } from '../../lib/catalog/products';

export const prerender = false;

// Meta (Facebook) product catalog data feed. Meta polls this URL on a schedule
// and ingests each row as a catalog product; catalog ads then retarget visitors
// with the product they viewed, matched by `id` ⇄ the Pixel's `content_id`
// (both come from src/lib/catalog/products.ts, so they can't drift).
//
// CSV (not XML/RSS) because the set is tiny and static — column headers map 1:1
// to Meta's field names with no namespace ceremony. House style mirrors the
// hand-rolled sitemap (../sitemap.xml.ts) and the contacts CSV export
// (../api/admin/contacts/export.ts, where csvCell came from).

// Required + recommended Meta product-feed columns.
const COLUMNS = [
  'id',
  'title',
  'description',
  'availability',
  'condition',
  'price',
  'link',
  'image_link',
  'brand',
] as const;

// Quote a cell only when it contains a comma, quote, or newline (RFC 4180).
function csvCell(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const GET: APIRoute = ({ locals }) => {
  const base = (locals.runtime?.env?.PUBLIC_BASE_URL ?? SITE_URL).replace(/\/$/, '');

  const header = COLUMNS.join(',');
  const rows = CATALOG.map((item) => {
    const cells: Record<(typeof COLUMNS)[number], string> = {
      id: item.id,
      title: item.title,
      description: item.description,
      availability: item.availability,
      condition: item.condition,
      price: `${item.priceEur.toFixed(2)} EUR`,
      link: `${base}${item.link}`,
      image_link: `${base}/media/${item.imageKey}`,
      brand: item.brand,
    };
    return COLUMNS.map((c) => csvCell(cells[c])).join(',');
  });

  // RFC 4180 line endings.
  const csv = [header, ...rows].join('\r\n') + '\r\n';

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
