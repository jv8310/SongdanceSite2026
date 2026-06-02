// The Grief Course — a flat-price thematic course with Daniela Hess & Jacob.
//
// Unlike the SVH Certification Course (which has a 6-variant offer gate,
// installments and a bundle), the grief course is deliberately simple:
//   - one product, one price (€99 / $99),
//   - full payment only (no installments),
//   - B2C by default, B2B optional (company + VAT → reverse-charge via Stripe
//     tax_id_data, which Quaderno reads to issue the invoice),
//   - a URL-driven discount (`?discount=N`, 1–99) exactly like the cert course.
//
// On a successful payment the Stripe webhook flips the row to `paid` and the
// shared paid-handler tags the Drip subscriber with `prod_Grief-sp`.

export type GriefCurrency = 'EUR' | 'USD';

export const GRIEF_PRODUCT_SLUG = 'grief-course';
export const GRIEF_DRIP_TAG = 'prod_Grief-sp';
export const GRIEF_DRIP_EVENT = 'Completed Grief course registration';

// Flat price: €99 and $99. USD reuses the EUR number 1-for-1 — US buyers
// aren't paying EU VAT, so the price story stays simple.
export const GRIEF_PRICE: Record<GriefCurrency, number> = {
  EUR: 99,
  USD: 99,
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

// Country → currency for the grief course: only EUR and USD are offered, so
// US buyers see USD and everyone else sees EUR.
export function griefCurrencyForCountry(code: string): GriefCurrency {
  return code.toUpperCase() === 'US' ? 'USD' : 'EUR';
}

export function griefCurrencySymbol(c: GriefCurrency): string {
  return c === 'USD' ? '$' : '€';
}
