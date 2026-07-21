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
// Albums charge in EUR only: the price is a single admin-set figure, not a
// hand-tuned per-market price map like the journeys, so the headline and the
// charge agree everywhere by simply being the same EUR amount.

export const ALBUM_PRODUCT_PREFIX = 'album-';

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

// "€22" / "€22.50" — the album price for page headlines.
export function formatAlbumPrice(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rem = cents % 100;
  return rem === 0 ? `€${whole}` : `€${whole}.${String(rem).padStart(2, '0')}`;
}
