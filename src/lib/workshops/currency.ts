// Country → currency mapping + display helpers for the workshop engine.
//
// Mirrors the current PHP app: non-EU countries map to their local currency,
// EU (and everywhere we don't have a dedicated price point for) maps to EUR.
// Prices themselves are fixed price points stored in workshop_product_prices,
// NOT runtime FX — this map only chooses *which* price column to read.

export const BASE_CURRENCY = 'EUR';

// The currencies we actually hold price points for. Anything else falls back
// to EUR at price-resolution time.
export const SUPPORTED_CURRENCIES = [
  'EUR', 'USD', 'CAD', 'GBP', 'CHF', 'NOK', 'SEK', 'DKK', 'AUD', 'NZD',
] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

// ISO-2 country → currency. EU members are intentionally omitted so they fall
// through to EUR. Only the non-EUR markets we price for are listed.
const COUNTRY_CURRENCY: Record<string, string> = {
  US: 'USD',
  CA: 'CAD',
  GB: 'GBP',
  CH: 'CHF',
  NO: 'NOK',
  SE: 'SEK',
  DK: 'DKK',
  AU: 'AUD',
  NZ: 'NZD',
};

export function currencyForCountry(country: string | null | undefined): string {
  if (!country) return BASE_CURRENCY;
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? BASE_CURRENCY;
}

// Symbol / formatting. Use Intl where available for the long tail; keep an
// explicit table for the common cases so the symbol is exactly what we want.
const SYMBOLS: Record<string, string> = {
  EUR: '€',
  USD: '$',
  CAD: 'CA$',
  GBP: '£',
  CHF: 'CHF ',
  NOK: 'kr ',
  SEK: 'kr ',
  DKK: 'kr ',
  AUD: 'A$',
  NZD: 'NZ$',
};

// Currencies with no minor unit are rare here; all of ours are 2-decimal.
export function formatMoney(amountMinor: number, currency: string): string {
  const cur = currency.toUpperCase();
  const major = amountMinor / 100;
  const sym = SYMBOLS[cur];
  // Whole-number prices read cleaner without trailing ".00".
  const body = Number.isInteger(major) ? String(major) : major.toFixed(2);
  if (sym) {
    // Trailing-space symbols (kr, CHF) sit before the number with their space.
    return sym.endsWith(' ') ? `${sym}${body}` : `${sym}${body}`;
  }
  return `${body} ${cur}`;
}

export function isSupportedCurrency(c: string): c is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(c.toUpperCase());
}
