// Display-only price labels for the marketing copy and navigation across the
// static site. Two top-of-funnel products (the workshop ticket and the
// masterclass) carry their own deliberate price points, mirroring:
//   - migrations/0023_workshop_ticket_price_9.sql   (svh-ticket)
//   - migrations/0022_workshop_masterclass.sql       (svh-masterclass)
// The themed courses and journeys (grief + the three journeys) instead reuse
// the SAME per-currency price maps the checkout charges from, so the figure on
// the grid/nav is exactly what the buyer pays in their currency.
//
// IMPORTANT: this is for labels only. The actual charged amounts live in the
// product price tables (workshop_product_prices for the two top-of-funnel
// products; src/lib/courses/{grief,journeys}.ts for the courses). When a price
// changes there, the course labels follow automatically (shared map); the two
// workshop figures below must be updated by hand to keep telling the truth.
// (We keep a static copy rather than hitting D1 because these labels render on
// every page — including the nav — and the pages are statically built; a
// per-request DB read would defeat that.)

import { formatMoney } from './currency';
import { GRIEF_PRICE } from '../courses/grief';
import { PRICE_BY_SLUG } from '../courses/journeys';

export type MarketingProduct =
  | 'ticket'
  | 'masterclass'
  | 'grief'
  | 'asj'
  | 'mmj'
  | 'inner-child';

// The course price maps are stored in major units (99 = €99); convert to the
// minor units (9900) the marketing helpers work in.
const toMinor = (m: Record<string, number>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const k of Object.keys(m)) out[k] = m[k] * 100;
  return out;
};

// Fixed per-currency price points in minor units (900 = €9.00). No FX — these
// are deliberate price points. The two workshop figures match the migrations
// referenced above; the course figures are pulled straight from the checkout's
// own price maps so the label and the charge can never drift apart.
export const MARKETING_PRICES_MINOR: Record<MarketingProduct, Record<string, number>> = {
  ticket: {
    EUR: 900, USD: 900, GBP: 800, CHF: 900, CAD: 1300,
    AUD: 1500, NZD: 1600, NOK: 9900, SEK: 9900, DKK: 6900,
  },
  masterclass: {
    EUR: 2900, USD: 2900, GBP: 2500, CHF: 2900, CAD: 3900,
    AUD: 3900, NZD: 4900, NOK: 29900, SEK: 29900, DKK: 19900,
  },
  grief: toMinor(GRIEF_PRICE),
  asj: toMinor(PRICE_BY_SLUG.asj!),
  mmj: toMinor(PRICE_BY_SLUG.mmj!),
  'inner-child': toMinor(PRICE_BY_SLUG['inner-child']!),
};

// The EUR label exactly as written in the site copy — and the token the client
// enhancer replaces. The two workshop products write the euro sign AFTER the
// number ("9€"); the courses write it before ("€99"), matching formatMoney and
// the hand-written note text on the cards/menu (e.g. "with Daniela · €99").
export const EUR_COPY_LABEL: Record<MarketingProduct, string> = {
  ticket: '9€',
  masterclass: '29€',
  grief: `€${GRIEF_PRICE.EUR}`,
  asj: `€${PRICE_BY_SLUG.asj!.EUR}`,
  mmj: `€${PRICE_BY_SLUG.mmj!.EUR}`,
  'inner-child': `€${PRICE_BY_SLUG['inner-child']!.EUR}`,
};

// Build { product: { CURRENCY: "label" } } for every supported currency. EUR
// keeps the copy style (9€ / €99); every other currency uses formatMoney ($9,
// £8, CA$13, kr 99 …) so the symbol and placement are correct per market.
export function buildMarketingPriceLabels(): Record<MarketingProduct, Record<string, string>> {
  const out = {} as Record<MarketingProduct, Record<string, string>>;
  for (const product of Object.keys(MARKETING_PRICES_MINOR) as MarketingProduct[]) {
    const byCur: Record<string, string> = {};
    const prices = MARKETING_PRICES_MINOR[product];
    for (const cur of Object.keys(prices)) {
      byCur[cur] = cur === 'EUR' ? EUR_COPY_LABEL[product] : formatMoney(prices[cur], cur);
    }
    out[product] = byCur;
  }
  return out;
}
