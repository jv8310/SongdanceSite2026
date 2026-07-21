// Order bumps for the 12-Week SVH course checkout — optional one-time add-ons
// shown beside the price, each offered only when the buyer's Drip tags say they
// don't already own it (eligibility decided in twelve-week-status.ts). Two
// bumps:
//
//   asj   — The Authentic Singing Journey   €99  → prod_ASJ
//           Struck 33% off a €148 sticker (the €99 bump is its former
//           standalone price; the journey page keeps its €150 standalone).
//   grief — The Grief Course                €49  → prod_Grief-sp
//           Half the €99 standalone, co-taught with Daniela Hess.
//
// Prices are per-currency price points (NOT runtime FX): ASJ's €99 bump strikes
// a dedicated €148 sticker (ASJ_BUMP_COMPARE_AT) so it reads as a clean 33% off;
// grief is scaled on the standalone grief course's own EUR-relative ratios
// (grief.ts), rounded to clean numbers, and its struck "was" is the real €99
// standalone pulled from grief.ts so it can never drift.
//
// Fulfilment is provider-agnostic: the checkout records the chosen bumps on the
// course_registration row; on payment the course paid-handler applies each
// bump's Drip tag and fires its completion event, enrolling the buyer exactly
// as a standalone purchase would (Jacob's existing Drip automations grant
// access). The course's own amount_cents stays the course price only — the bump
// is a separate charge (full payment) or rides the first installment invoice.

import { type SupportedCurrency } from '../workshops/currency';
import { DRIP_BY_SLUG } from './journeys';
import { GRIEF_PRICE, GRIEF_DRIP_TAG, GRIEF_DRIP_EVENT } from './grief';

export type BumpSlug = 'asj' | 'grief';

type PriceMap = Record<SupportedCurrency, number>; // major units

// ASJ — €99, offered as a bump struck through against a €148 sticker so it
// reads as a clean 33% off (the €99 bump is the former standalone price; the
// journey page keeps its own €150 standalone). Per-currency ≈ 4/3 × the bump.
const ASJ_BUMP_PRICE: PriceMap = {
  EUR: 99, USD: 99, GBP: 89, CAD: 145, CHF: 95,
  AUD: 165, NZD: 185, NOK: 1150, SEK: 1100, DKK: 745,
};
const ASJ_BUMP_COMPARE_AT: PriceMap = {
  EUR: 148, USD: 148, GBP: 133, CAD: 216, CHF: 142,
  AUD: 246, NZD: 276, NOK: 1720, SEK: 1640, DKK: 1110,
};
// Grief — €49, half the €99 standalone, scaled to each market on the standalone
// grief course's ratios (grief.ts) and rounded to clean headline numbers.
const GRIEF_BUMP_PRICE: PriceMap = {
  EUR: 49, USD: 49, GBP: 45, CAD: 72, CHF: 47,
  AUD: 82, NZD: 92, NOK: 575, SEK: 550, DKK: 375,
};

const ASJ_DRIP = DRIP_BY_SLUG['asj']; // { tags: ['prod_ASJ'], event: … }

export type BumpDef = {
  slug: BumpSlug;
  label: string;
  // A canonical product slug for line-item metadata (Quaderno / Stripe).
  catalogSlug: string;
  blurb: string;
  points: string[];
  image: string; // /media/… thumbnail for the bump card
  dripTag: string; // applied on payment (grants the product in Drip)
  dripEvent: string; // fired on payment (drives Jacob's enrolment automation)
  // Tags that mean the buyer already owns this product → don't offer the bump.
  // Matched case-insensitively (Drip tags are free-form).
  ownedTags: string[];
  price: PriceMap; // bump price, major units
  compareAtCents: (currency: SupportedCurrency) => number; // standalone price
};

export const BUMPS: Record<BumpSlug, BumpDef> = {
  asj: {
    slug: 'asj',
    label: 'The Authentic Singing Journey',
    catalogSlug: 'asj',
    blurb:
      'Somewhere to keep practising between the modules — original music made to sound along with, yours to keep.',
    points: [
      '40 guided singing journeys',
      'Original music & mantras by Jacob',
      'Stream anytime — yours to keep',
    ],
    image: '/media/library/collage-mantrapakket-klein.webp',
    dripTag: ASJ_DRIP.tags[0], // prod_ASJ
    dripEvent: ASJ_DRIP.event,
    // prod_ASJ (English edition) or prod_JAZ (Dutch edition) → already owned.
    ownedTags: ['prod_ASJ', 'prod_JAZ'],
    price: ASJ_BUMP_PRICE,
    compareAtCents: (c) => ASJ_BUMP_COMPARE_AT[c] * 100,
  },
  grief: {
    slug: 'grief',
    label: 'The Grief Course',
    catalogSlug: 'grief-course',
    blurb:
      'Four live sessions with Daniela Hess & Jacob — somatic tools to be with grief in its many forms, and to sound it through the body.',
    points: [
      '4 live sessions · 120 min each — in your own time',
      'Held by two grief educators — Daniela Hess & Jacob',
      'Lifetime access to every practice & journey',
    ],
    image: '/media/library/grief-jacob-letting-go-sounding.webp',
    dripTag: GRIEF_DRIP_TAG, // prod_Grief-sp
    dripEvent: GRIEF_DRIP_EVENT,
    ownedTags: [GRIEF_DRIP_TAG],
    price: GRIEF_BUMP_PRICE,
    compareAtCents: (c) => GRIEF_PRICE[c] * 100,
  },
};

// Display order on the checkout card.
export const BUMP_ORDER: BumpSlug[] = ['asj', 'grief'];

export function isBumpSlug(s: unknown): s is BumpSlug {
  return s === 'asj' || s === 'grief';
}

export function bumpPriceCents(slug: BumpSlug, currency: SupportedCurrency): number {
  return BUMPS[slug].price[currency] * 100;
}

// The wire shape sent to the client (and the basis for the line item / row).
export type BumpOffer = {
  slug: BumpSlug;
  label: string;
  blurb: string;
  points: string[];
  image: string;
  currency: SupportedCurrency;
  price_cents: number;
  // The standalone price to strike through, when it's higher than the bump.
  compare_at_cents: number | null;
  drip_tag: string;
};

export function bumpOffer(slug: BumpSlug, currency: SupportedCurrency): BumpOffer {
  const def = BUMPS[slug];
  const price = bumpPriceCents(slug, currency);
  const compare = def.compareAtCents(currency);
  return {
    slug: def.slug,
    label: def.label,
    blurb: def.blurb,
    points: def.points,
    image: def.image,
    currency,
    price_cents: price,
    compare_at_cents: compare > price ? compare : null,
    drip_tag: def.dripTag,
  };
}

// Which bumps to offer a buyer with the given Drip tag set: the ones they don't
// already own. `tags === null` (Drip unreachable, or an unknown email) offers
// all of them — an optional add-on is better shown than hidden; the buyer can
// always decline, and the checkout re-derives the price either way.
export function eligibleBumpOffers(
  currency: SupportedCurrency,
  tags: string[] | null,
): BumpOffer[] {
  const owned = new Set((tags ?? []).map((t) => t.toLowerCase()));
  return BUMP_ORDER.filter((slug) => {
    if (!tags) return true; // fail open
    return !BUMPS[slug].ownedTags.some((t) => owned.has(t.toLowerCase()));
  }).map((slug) => bumpOffer(slug, currency));
}
