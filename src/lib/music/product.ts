// Music albums as purchasable products.
//
// An album with a price (music_albums.price_eur_cents, migration 0077) can be
// bought straight from its player page / the /music listing. The purchase runs
// through the ordinary course checkout machinery (course_registrations +
// Stripe/PayPal + the shared paid-handler) under the product slug
// `album-<albumId>` — so every existing fulfilment path (webhook, PayPal
// return, reconciles, admin mark-paid, SD-ORDER, Drip order mirror) works for
// albums without new plumbing. On payment the paid-handler looks the album up
// and applies its drip_tag (src/lib/courses/paid-handler.ts).
//
// Multi-currency: the admin sets one EUR price; every other market's price is
// derived from it with the same EUR-relative ratios the hand-tuned journey /
// grief price maps use (ASJ €99 → $99 / £89 / CA$145 / kr 1150 …), rounded to
// clean headline numbers. The buyer's country picks the currency — the page
// and the charge derive the figure from the same function, so they always
// agree.

import {
  currencyForCountry,
  formatMoney,
  isSupportedCurrency,
  type SupportedCurrency,
} from '../workshops/currency';

export const ALBUM_PRODUCT_PREFIX = 'album-';

// EUR → market ratios, mirroring the journeys' hand-tuned maps (journeys.ts).
const ALBUM_PRICE_RATIO: Record<SupportedCurrency, number> = {
  EUR: 1, USD: 1, GBP: 0.9, CAD: 1.47, CHF: 0.96,
  AUD: 1.67, NZD: 1.87, NOK: 11.7, SEK: 11.1, DKK: 7.6,
};

export function albumCurrencyForCountry(
  country: string | null | undefined,
): SupportedCurrency {
  const c = currencyForCountry(country);
  return isSupportedCurrency(c) ? c : 'EUR';
}

// The charged amount (minor units) for an album in a market. EUR is the
// admin-set figure verbatim; other currencies scale by ratio and round to a
// clean whole unit (nearest 5 for the Scandinavian krona family, matching how
// the journey maps read — kr 575, kr 1150).
export function albumPriceCents(
  priceEurCents: number,
  currency: SupportedCurrency,
): number {
  if (currency === 'EUR') return priceEurCents;
  const step = currency === 'NOK' || currency === 'SEK' || currency === 'DKK' ? 5 : 1;
  const major = (priceEurCents / 100) * ALBUM_PRICE_RATIO[currency];
  return Math.max(step, Math.round(major / step) * step) * 100;
}

// "€22" / "$22" / "kr 260" — the localized headline for a market.
export function albumPriceLabel(
  priceEurCents: number,
  currency: SupportedCurrency,
): string {
  return formatMoney(albumPriceCents(priceEurCents, currency), currency);
}

export function albumProductSlug(albumId: string): `album-${string}` {
  return `${ALBUM_PRODUCT_PREFIX}${albumId}`;
}

export function isAlbumProductSlug(slug: string | null | undefined): boolean {
  return !!slug && slug.startsWith(ALBUM_PRODUCT_PREFIX);
}

export function albumIdFromProductSlug(slug: string): string {
  return slug.slice(ALBUM_PRODUCT_PREFIX.length);
}

// Whether this email holds a *paid* direct purchase of the album. The second
// entitlement path next to the Drip tag (src/lib/music/access.ts): it makes a
// fresh purchase play immediately — before Drip has even seen the order — and
// keeps buyers listening if Drip is ever unreachable. Renames keep working
// because upsertAlbum rewrites tracks' album_id but registrations keep the slug
// they were bought under — so this checks the *current* id; an admin renaming a
// sold album's slug should know old buyers then rely on the Drip tag alone.
export async function hasPaidAlbumRegistration(
  db: D1Database,
  email: string,
  albumId: string,
): Promise<boolean> {
  try {
    const row = await db
      .prepare(
        `SELECT id FROM course_registrations
          WHERE product_slug = ? AND lower(email) = ? AND status = 'paid'
          LIMIT 1`,
      )
      .bind(albumProductSlug(albumId), email.trim().toLowerCase())
      .first<{ id: number }>();
    return !!row;
  } catch {
    return false; // entitlement fallback only — never let it break the Drip path
  }
}

