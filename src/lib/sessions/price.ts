// An private session's price per market — pure, safe for the browser.
//
// One EUR price (set on /admin/sessions), scaled to each market with the same
// EUR-relative ratios the albums and the journeys use (albumPriceCents), so
// the page, the form's repaint and the charge derive one figure from one
// function.

import { albumCurrencyForCountry, albumPriceCents } from '../music/product';
import { formatMoney, type SupportedCurrency } from '../workshops/currency';

export function sessionCurrencyForCountry(country: string | null | undefined): SupportedCurrency {
  return albumCurrencyForCountry(country);
}

export function sessionPriceCents(priceEurCents: number, currency: SupportedCurrency): number {
  return albumPriceCents(priceEurCents, currency);
}

export function sessionPriceLabel(priceEurCents: number, currency: SupportedCurrency): string {
  return formatMoney(sessionPriceCents(priceEurCents, currency), currency);
}

// ── A discount link: ?discount=N (or ?adiscount=N), N from 1 to 100 ─────────
// Jacob's links for a private session (November 2026). 100 is a complimentary
// session — booked without a payment page; anything less comes off the price.
// Unlike the course links (src/lib/courses/discount.ts, where only the secret
// ?adiscount reaches 100), the public ?discount goes all the way here, as asked.
// The page shows the figure and the checkout re-derives it from the same two
// functions, so what is shown is what is charged.
export function clampSessionDiscount(v: string | number | null | undefined): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '').trim(), 10);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 0;
}

// The two URL params, ?adiscount winning when both are set.
export function sessionDiscountFrom(raw: { discount?: string | number | null; adiscount?: string | number | null }): number {
  return clampSessionDiscount(raw.adiscount) || clampSessionDiscount(raw.discount);
}

// What a discounted session costs, rounded DOWN to whole units, so the
// percent on the page is never under-delivered. 100% → 0.
export function sessionDiscountedCents(priceCents: number, pct: number): number {
  if (pct <= 0) return priceCents;
  if (pct >= 100) return 0;
  return Math.floor((priceCents * (100 - pct)) / 100 / 100) * 100;
}
