// CSV builders for the Meta (Facebook) catalog feeds. The main feed carries
// every product field in one currency (EUR); each other currency gets a
// country-override feed carrying `id` + the overridden `price`/`sale_price`,
// which Meta merges onto the main feed by id (so e.g. US viewers see USD).
//
// `sale_price` reflects the live launch promo (src/lib/promo) and is computed at
// REQUEST time via salePriceFor — when the promo ends it returns null and the
// column goes blank on its own. A product not priced in a currency (Songdeck is
// EUR-only) is omitted from that currency's override feed, so Meta falls back to
// the base feed for it.

import { CATALOG, salePriceFor, type FeedCurrency } from './products';

// Required + recommended Meta product-feed columns (main feed).
const MAIN_COLUMNS = [
  'id',
  'title',
  'description',
  'availability',
  'condition',
  'price',
  'sale_price',
  'link',
  'image_link',
  'additional_image_link',
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
  const rows = CATALOG.flatMap((item) => {
    const price = item.prices[currency];
    if (price == null) return []; // not priced in this currency — skip the row
    const sale = salePriceFor(item.id, currency);
    const cells: Record<(typeof MAIN_COLUMNS)[number], string> = {
      id: item.id,
      title: item.title,
      description: item.description,
      availability: item.availability,
      condition: item.condition,
      price: priceCell(price, currency),
      sale_price: sale == null ? '' : priceCell(sale, currency),
      link: `${base}${item.link}`,
      image_link: item.imageUrl ?? `${base}/media/${item.imageKey}`,
      additional_image_link: (item.additionalImageKeys ?? [])
        .map((k) => `${base}/media/${k}`)
        .join(','),
      brand: item.brand,
    };
    return [MAIN_COLUMNS.map((c) => csvCell(cells[c])).join(',')];
  });
  return [header, ...rows].join('\r\n') + '\r\n';
}

// The country-override feed: id + the fields that differ by market (price and,
// while the promo runs, sale_price). Products with no price in this currency
// are omitted so Meta keeps the base-feed values for them.
export function buildOverrideFeed(currency: FeedCurrency): string {
  const rows = CATALOG.flatMap((item) => {
    const price = item.prices[currency];
    if (price == null) return [];
    const sale = salePriceFor(item.id, currency);
    return [
      [
        csvCell(item.id),
        csvCell(priceCell(price, currency)),
        sale == null ? '' : csvCell(priceCell(sale, currency)),
      ].join(','),
    ];
  });
  return ['id,price,sale_price', ...rows].join('\r\n') + '\r\n';
}
