// An individual session's price per market — pure, safe for the browser.
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
