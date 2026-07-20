// The post-workshop Song Deck gift — a one-hour "celebrate your yes" promo on
// the course checkouts (12-week + certification path).
//
// Anyone holding a secured (paid/coupon) seat at a workshop or masterclass
// sees, on both course checkouts, a free Song Deck with free worldwide
// shipping — from the moment their session starts until ONE HOUR after it
// ends. A 60-minute workshop at 20:00 runs the gift 20:00–22:00; a 90-minute
// masterclass runs it 30 minutes longer. While the gift window is live the
// checkout swaps its 48h discount countdown for the gift's own countdown; the
// window closing simply reveals the 48h countdown again (the 20%/30% course
// discount itself is untouched by any of this).
//
// The window is re-derived server-side at checkout time from the same
// email↔workshop link the discount uses, so the gift can't be spoofed by a
// tampered client. Fulfilment goes through the Songdeck Shopify shop: the gift
// is recorded as a zero-amount row in the registration's `bumps` JSON, and on
// payment the buyer receives a claim email (see deckGiftClaimEmail in
// src/lib/workshops/emails.ts, sent from src/lib/orders/notification.ts) whose
// button opens songdeck.shop with the SVH-BONUS coupon pre-applied — deck +
// worldwide shipping at €0, with Shopify collecting the shipping address and
// placing the order. (A direct Shopify API integration that places the order
// automatically is a later stage.)

import { DEFAULT_DURATION_MS } from '../workshops/time';
import { listSecuredWorkshopLinksByEmail } from '../workshops/db';

// How long the gift stays claimable after the session ends.
export const DECK_GIFT_AFTER_END_MS = 60 * 60 * 1000;

// The zero-amount `bumps` row that marks a registration as carrying the gift.
// NOT a real order bump (no price, no Drip tag) — parsePurchasedBumps carries
// it through, the SD-ORDER notification labels it, and the claim email keys on
// it; every bump consumer that grants access filters on isBumpSlug and so
// skips it.
export const DECK_GIFT_BUMP_SLUG = 'songdeck-gift';
export const DECK_GIFT_LABEL = 'Song Deck — free gift, ships free worldwide';

// The Shopify coupon that makes the deck + worldwide shipping free. The code
// must exist (and stay active) in the songdeck.shop Shopify admin.
export const DECK_GIFT_COUPON_CODE = 'SVH-BONUS';
export const DECK_GIFT_SHOP_ORIGIN = 'https://songdeck.shop';
export const DECK_GIFT_SHOP_PRODUCT_PATH =
  '/products/songdeck-authentic-singing-36-song-cards-with-accompanying-app';

// Shopify's discount deep link: opening it stores the coupon on the visitor's
// cart and redirects to the product page, so the buyer never types the code.
export function deckGiftClaimUrl(): string {
  return `${DECK_GIFT_SHOP_ORIGIN}/discount/${DECK_GIFT_COUPON_CODE}?redirect=${encodeURIComponent(
    DECK_GIFT_SHOP_PRODUCT_PATH,
  )}`;
}

export type DeckGiftStatus = {
  active: boolean;
  // Epoch ms the gift window closes at (the latest live window when the buyer
  // sits in several). null when inactive.
  ends_at_ms: number | null;
};

// The shipping address the buyer enters on the course checkout while the gift
// window is live, so the free Song Deck can be shipped to them. Stored as JSON
// on course_registrations.deck_gift_shipping (migration 0075) and read at
// fulfilment time to place the €0 Shopify order. `verified` records whether the
// address passed (or was standardised by) Google's Address Validation API.
export type DeckGiftShipping = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  region: string; // state / province — optional for many countries
  postal_code: string;
  country: string; // ISO-2
  phone: string;
  verified: boolean;
};

// The minimum an address needs to be worth shipping to: a recipient, a street,
// a city and a country. (Region/postal vary too much by country to hard-require.)
export function deckGiftShippingComplete(s: DeckGiftShipping | null): s is DeckGiftShipping {
  return !!s && !!s.name.trim() && !!s.line1.trim() && !!s.city.trim() && !!s.country.trim();
}

// Build a DeckGiftShipping from loose checkout-request fields, trimming and
// upper-casing the country. Returns null when nothing shippable was provided
// (so a blank address never records a row and never blocks the sale).
export function normalizeDeckGiftShipping(input: {
  name?: unknown;
  line1?: unknown;
  line2?: unknown;
  city?: unknown;
  region?: unknown;
  postal_code?: unknown;
  country?: unknown;
  phone?: unknown;
  verified?: unknown;
}): DeckGiftShipping | null {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const s: DeckGiftShipping = {
    name: str(input.name),
    line1: str(input.line1),
    line2: str(input.line2),
    city: str(input.city),
    region: str(input.region),
    postal_code: str(input.postal_code),
    country: str(input.country).toUpperCase(),
    phone: str(input.phone),
    verified: input.verified === true,
  };
  return deckGiftShippingComplete(s) ? s : null;
}

// Parse the JSON `deck_gift_shipping` column back into a validated address, or
// null for empty / malformed input.
export function parseDeckGiftShipping(raw: string | null | undefined): DeckGiftShipping | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return null;
    return normalizeDeckGiftShipping(o as Record<string, unknown>);
  } catch {
    return null;
  }
}

export const DECK_GIFT_INACTIVE: DeckGiftStatus = { active: false, ends_at_ms: null };

// Decide the gift window from a person's secured workshop seats: live from
// each session's start until an hour past its end (end defaults to start+60min
// when the workshop carries no explicit end).
export function deckGiftStatus(
  links: Array<{ starts_at_utc: string; ends_at_utc: string | null }>,
  nowMs: number = Date.now(),
): DeckGiftStatus {
  let latest: number | null = null;
  for (const l of links) {
    const start = Date.parse(l.starts_at_utc);
    if (!Number.isFinite(start)) continue;
    const endRaw = l.ends_at_utc ? Date.parse(l.ends_at_utc) : NaN;
    const end = Number.isFinite(endRaw) ? endRaw : start + DEFAULT_DURATION_MS;
    const windowEnd = end + DECK_GIFT_AFTER_END_MS;
    if (nowMs >= start && nowMs <= windowEnd) {
      if (latest == null || windowEnd > latest) latest = windowEnd;
    }
  }
  return latest != null
    ? { active: true, ends_at_ms: latest }
    : DECK_GIFT_INACTIVE;
}

// Server-side derivation by email — the authoritative check the checkout
// endpoints run. Fails closed but soft: a DB hiccup means "no gift", never a
// blocked checkout.
export async function deriveDeckGift(
  db: D1Database,
  email: string,
  nowMs: number = Date.now(),
): Promise<DeckGiftStatus> {
  try {
    const links = await listSecuredWorkshopLinksByEmail(db, email);
    return deckGiftStatus(links, nowMs);
  } catch {
    return DECK_GIFT_INACTIVE;
  }
}
