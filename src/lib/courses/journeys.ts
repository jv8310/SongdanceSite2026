// The Three Journeys — self-paced thematic courses sold as flat-price products,
// in the same multi-currency model as the Grief course (see ./grief.ts).
//
//   asj             — Authentic Singing Journey            €99   → prod_ASJ
//   asj-pro         — ASJ + the PRO mantra pack (license)  €149  → prod_ASJ + prod_Mantra
//   mmj             — Magical Movement Journey             €49   → prod_MMJ
//   inner-child     — Inner Child Healing Journey          €29   → prod_InnerChild
//   journeys-bundle — all three journeys, 50% off the sum  →      prod_ASJ + prod_MMJ + prod_InnerChild
//
// One product, one price, full payment only — no installments. The buyer's
// country picks the currency (US→USD, … else EUR), so the headline price and
// the charged price always agree. A successful payment runs through the shared
// course paid-handler, which reads the slug below and applies the Drip tags.

import {
  currencyForCountry,
  isSupportedCurrency,
  type SupportedCurrency,
} from '../workshops/currency';

export type JourneyCurrency = SupportedCurrency;

export type JourneySlug =
  | 'asj'
  | 'asj-pro'
  | 'mmj'
  | 'inner-child'
  | 'journeys-bundle';

// Fixed regional price points (major units), mirroring the EUR-relative ratios
// the Grief / 12-week courses use, rounded to clean headline numbers. Edit a
// number to retune a market. NOT runtime FX.
type PriceMap = Record<JourneyCurrency, number>;

const ASJ_PRICE: PriceMap = {
  EUR: 99, USD: 99, GBP: 89, CAD: 145, CHF: 95,
  AUD: 165, NZD: 185, NOK: 1150, SEK: 1100, DKK: 745,
};
const MMJ_PRICE: PriceMap = {
  EUR: 49, USD: 49, GBP: 45, CAD: 72, CHF: 49,
  AUD: 82, NZD: 92, NOK: 575, SEK: 545, DKK: 369,
};
const INNER_CHILD_PRICE: PriceMap = {
  EUR: 29, USD: 29, GBP: 26, CAD: 43, CHF: 29,
  AUD: 49, NZD: 55, NOK: 339, SEK: 325, DKK: 219,
};
// PRO = the Authentic Singing Journey plus the downloadable mantra pack
// (professional licence). Roughly ASJ + €50 across the board.
const ASJ_PRO_PRICE: PriceMap = {
  EUR: 149, USD: 149, GBP: 135, CAD: 219, CHF: 145,
  AUD: 249, NZD: 279, NOK: 1725, SEK: 1649, DKK: 1115,
};

// Per-currency sum of the three standalone journeys (the bundle's "before"
// figure). The bundle is sold at exactly half this — a clean 50% off.
function bundleSum(currency: JourneyCurrency): number {
  return ASJ_PRICE[currency] + MMJ_PRICE[currency] + INNER_CHILD_PRICE[currency];
}

export const PRICE_BY_SLUG: Record<JourneySlug, PriceMap | null> = {
  asj: ASJ_PRICE,
  'asj-pro': ASJ_PRO_PRICE,
  mmj: MMJ_PRICE,
  'inner-child': INNER_CHILD_PRICE,
  'journeys-bundle': null, // computed from the three maps (see priceCents)
};

export const LABEL_BY_SLUG: Record<JourneySlug, string> = {
  asj: 'The Authentic Singing Journey',
  'asj-pro': 'The Authentic Singing Journey — PRO (with mantra pack)',
  mmj: 'The Magical Movement Journey',
  'inner-child': 'The Inner Child Healing Journey',
  'journeys-bundle': 'The Three Journeys — complete bundle',
};

// Drip side-effects per product (read by the shared course paid-handler).
export const DRIP_BY_SLUG: Record<JourneySlug, { tags: string[]; event: string }> = {
  asj: { tags: ['prod_ASJ'], event: 'Completed Authentic Singing Journey registration' },
  'asj-pro': {
    tags: ['prod_ASJ', 'prod_Mantra'],
    event: 'Completed Authentic Singing Journey PRO registration',
  },
  mmj: { tags: ['prod_MMJ'], event: 'Completed Magical Movement Journey registration' },
  'inner-child': {
    tags: ['prod_InnerChild'],
    event: 'Completed Inner Child Journey registration',
  },
  'journeys-bundle': {
    tags: ['prod_ASJ', 'prod_MMJ', 'prod_InnerChild'],
    event: 'Completed Three Journeys bundle registration',
  },
};

export function isJourneySlug(slug: string | null | undefined): slug is JourneySlug {
  return !!slug && slug in LABEL_BY_SLUG;
}

export function journeyCurrencyForCountry(
  country: string | null | undefined,
): JourneyCurrency {
  const c = currencyForCountry(country);
  return isSupportedCurrency(c) ? c : 'EUR';
}

// Final charged amount (in cents) for a product + currency. The bundle is half
// the per-currency sum of the three journeys, rounded to the nearest cent.
export function priceCents(slug: JourneySlug, currency: JourneyCurrency): number {
  if (slug === 'journeys-bundle') {
    return Math.round((bundleSum(currency) * 100) / 2);
  }
  const map = PRICE_BY_SLUG[slug]!;
  return map[currency] * 100;
}

// The "before" amount (cents) to strike through. Only the bundle has one — the
// undiscounted sum of the three journeys.
export function compareAtCents(
  slug: JourneySlug,
  currency: JourneyCurrency,
): number | null {
  if (slug === 'journeys-bundle') return bundleSum(currency) * 100;
  return null;
}

export type JourneyOffer = {
  slug: JourneySlug;
  label: string;
  currency: JourneyCurrency;
  price_cents: number;
  compare_at_cents: number | null;
};

export function journeyOffer(
  slug: JourneySlug,
  currency: JourneyCurrency,
): JourneyOffer {
  return {
    slug,
    label: LABEL_BY_SLUG[slug],
    currency,
    price_cents: priceCents(slug, currency),
    compare_at_cents: compareAtCents(slug, currency),
  };
}
