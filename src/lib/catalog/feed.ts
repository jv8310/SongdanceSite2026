// CSV builders for the Meta (Facebook) catalog feeds. The main feed carries
// every product field in one currency; the country-override feed carries only
// `id` + the overridden `price` (Meta merges it onto the main feed by id, so
// US viewers see USD while the catalog default stays EUR).

import { CATALOG, type FeedCurrency } from './products';

// Required + recommended Meta product-feed columns (main feed).
const MAIN_COLUMNS = [
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

function priceCell(major: number, currency: FeedCurrency): string {
  return `${major.toFixed(2)} ${currency}`;
}

// The full single-currency product feed.
export function buildMainFeed(base: string, currency: FeedCurrency): string {
  const header = MAIN_COLUMNS.join(',');
  const rows = CATALOG.map((item) => {
    const cells: Record<(typeof MAIN_COLUMNS)[number], string> = {
      id: item.id,
      title: item.title,
      description: item.description,
      availability: item.availability,
      condition: item.condition,
      price: priceCell(item.prices[currency], currency),
      link: `${base}${item.link}`,
      image_link: item.imageUrl ?? `${base}/media/${item.imageKey}`,
      brand: item.brand,
    };
    return MAIN_COLUMNS.map((c) => csvCell(cells[c])).join(',');
  });
  return [header, ...rows].join('\r\n') + '\r\n';
}

// The country-override feed: only id + price (the field that differs by market).
export function buildOverrideFeed(currency: FeedCurrency): string {
  const rows = CATALOG.map(
    (item) => `${csvCell(item.id)},${csvCell(priceCell(item.prices[currency], currency))}`,
  );
  return ['id,price', ...rows].join('\r\n') + '\r\n';
}
