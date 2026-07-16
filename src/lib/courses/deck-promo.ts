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
// tampered client. Fulfilment is manual: the gift is recorded as a zero-amount
// row in the registration's `bumps` JSON, the Stripe Checkout collects a
// shipping address, and the SD-ORDER email calls out the deck so it gets
// shipped. (PayPal buyers: the shipping address lives on the PayPal
// transaction.)

import { DEFAULT_DURATION_MS } from '../workshops/time';
import { listSecuredWorkshopLinksByEmail } from '../workshops/db';

// How long the gift stays claimable after the session ends.
export const DECK_GIFT_AFTER_END_MS = 60 * 60 * 1000;

// The zero-amount `bumps` row that marks a registration as carrying the gift.
// NOT a real order bump (no price, no Drip tag) — parsePurchasedBumps carries
// it through and the SD-ORDER notification labels it for fulfilment; every
// bump consumer that grants access filters on isBumpSlug and so skips it.
export const DECK_GIFT_BUMP_SLUG = 'songdeck-gift';
export const DECK_GIFT_LABEL = 'Song Deck — free gift, ships free worldwide';

export type DeckGiftStatus = {
  active: boolean;
  // Epoch ms the gift window closes at (the latest live window when the buyer
  // sits in several). null when inactive.
  ends_at_ms: number | null;
};

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
