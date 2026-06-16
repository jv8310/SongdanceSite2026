// The Grief Course — a flat-price thematic course with Daniela Hess & Jacob.
//
// Unlike the SVH Certification Course (which has a 6-variant offer gate,
// installments and a bundle), the grief course is deliberately simple:
//   - one product, one price,
//   - full payment only (no installments),
//   - B2C by default, B2B optional (company + VAT → reverse-charge via Stripe
//     tax_id_data, which Quaderno reads to issue the invoice),
//   - a URL-driven discount (`?discount=N`, 1–99) exactly like the cert course.
//
// It is priced per region in the same currencies as the rest of the site
// (workshops + the 12-week course), so a buyer is charged a tidy round number
// in their own currency rather than being pushed into EUR/USD.
//
// On a successful payment the Stripe webhook flips the row to `paid` and the
// shared paid-handler tags the Drip subscriber with `prod_Grief-sp`.

import {
  currencyForCountry,
  isSupportedCurrency,
  type SupportedCurrency,
} from '../workshops/currency';

// The grief course prices in the full supported set (EUR/USD/GBP/CAD/CHF/
// AUD/NZD/NOK/SEK/DKK). Anything we don't hold a price point for falls back
// to EUR at resolution time.
export type GriefCurrency = SupportedCurrency;

export const GRIEF_PRODUCT_SLUG = 'grief-course';
export const GRIEF_DRIP_TAG = 'prod_Grief-sp';
export const GRIEF_DRIP_EVENT = 'Completed Grief course registration';

// Fixed regional price points (major units). EUR/USD are pinned at 99; the
// rest mirror the same EUR-relative ratios the 12-week course already uses
// (see src/lib/courses/twelve-week.ts), rounded to clean headline numbers.
// These are price points, NOT runtime FX — edit a number to retune a market.
export const GRIEF_PRICE: Record<GriefCurrency, number> = {
  EUR: 99,
  USD: 99,
  GBP: 89,
  CAD: 145,
  CHF: 95,
  AUD: 165,
  NZD: 185,
  NOK: 1150,
  SEK: 1100,
  DKK: 745,
};

export type GriefOffer = {
  slug: typeof GRIEF_PRODUCT_SLUG;
  label: string;
  currency: GriefCurrency;
  price: number; // major unit, e.g. 99
  price_cents: number; // for Stripe
};

export function griefOffer(currency: GriefCurrency): GriefOffer {
  const price = GRIEF_PRICE[currency];
  return {
    slug: GRIEF_PRODUCT_SLUG,
    label: 'The Grief Course',
    currency,
    price,
    price_cents: price * 100,
  };
}

// Country (ISO-2) → the currency we price the grief course in. Reuses the
// workshop resolver (US→USD, GB→GBP, CA→CAD, … everywhere we don't hold a
// price point → EUR).
export function griefCurrencyForCountry(
  country: string | null | undefined,
): GriefCurrency {
  const c = currencyForCountry(country);
  return isSupportedCurrency(c) ? c : 'EUR';
}
