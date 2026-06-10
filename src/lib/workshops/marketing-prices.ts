// Display-only price labels for the two top-of-funnel products that appear in
// marketing copy and navigation across the static site (the workshop ticket and
// the masterclass). These mirror the *charged* amounts seeded in:
//   - migrations/0023_workshop_ticket_price_9.sql   (svh-ticket)
//   - migrations/0022_workshop_masterclass.sql       (svh-masterclass)
//
// IMPORTANT: this is for labels only. The `workshop_product_prices` table stays
// the single source of truth for what's actually charged at checkout. When a
// price changes in those migrations, update the matching figure here so the
// marketing buttons keep telling the truth. (We keep a static copy rather than
// hitting D1 because these labels render on every page — including the nav — and
// the pages are statically built; a per-request DB read would defeat that.)

import { formatMoney } from './currency';

export type MarketingProduct = 'ticket' | 'masterclass';

// Fixed per-currency price points in minor units (900 = €9.00). No FX — these
// are deliberate price points, matching the migrations referenced above.
export const MARKETING_PRICES_MINOR: Record<MarketingProduct, Record<string, number>> = {
  ticket: {
    EUR: 900, USD: 900, GBP: 800, CHF: 900, CAD: 1300,
    AUD: 1500, NZD: 1600, NOK: 9900, SEK: 9900, DKK: 6900,
  },
  masterclass: {
    EUR: 2900, USD: 2900, GBP: 2500, CHF: 2900, CAD: 3900,
    AUD: 3900, NZD: 4900, NOK: 29900, SEK: 29900, DKK: 19900,
  },
};

// The EUR label exactly as written in the site copy — the euro sign sits AFTER
// the number ("9€"), unlike formatMoney's symbol-leading style. This is both the
// no-JS / first-paint default and the token the client enhancer replaces.
export const EUR_COPY_LABEL: Record<MarketingProduct, string> = {
  ticket: '9€',
  masterclass: '29€',
};

// Build { product: { CURRENCY: "label" } } for every supported currency. EUR
// keeps the copy style (9€); every other currency uses formatMoney ($9, £8,
// CA$13, kr 99 …) so the symbol and placement are correct per market.
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
