// Meta (Facebook) product catalog — the single source of truth for both the
// catalog data feed (/feeds/meta-catalog.csv) and the on-page ViewContent
// retargeting events (MetaProductView.astro). The whole point of catalog ads is
// to retarget a visitor with the exact product they looked at, and that only
// works if the feed's `id` and the Pixel's `content_id` are the SAME string.
// Keeping both on this one list is what guarantees they never drift.
//
// Scope: the self-paced, evergreen courses only. The dated workshop ticket
// (availability varies) and retreats (free-text pricing, no stable slugs) are
// deliberately excluded — they can be added later with a dynamic feed.
//
// Prices are NOT redefined here. We import the existing per-currency price
// modules and read the EUR figure, so any price retune in those modules flows
// straight through to the feed and the events.

import { PRICE as TWELVE_WEEK_PRICE } from '../courses/twelve-week';
import { getCertOffer, applyLaunchPromoToOffer } from '../courses/variant';
import { GRIEF_PRICE } from '../courses/grief';
import { PRICE_BY_SLUG } from '../courses/journeys';
import { MARKETING_PRICES_MINOR } from '../workshops/marketing-prices';
import {
  SUPPORTED_CURRENCIES,
  COUNTRY_CURRENCY,
  type SupportedCurrency,
} from '../workshops/currency';
import { launchPromoActive, LAUNCH_PROMO_PERCENT } from '../promo';

// The catalog id IS the Pixel content_id. Use the canonical product slugs.
// Note we deliberately list ONE certification product (the bundle/"path" is the
// same product, sold as the certification course) and ONE Authentic Singing
// product (ASJ-PRO is the same journey with a mantra-pack add-on, not its own
// catalog product). The variant checkout slugs are folded back to these by
// `catalogContentId` below so their events still bind to a real catalog item.
export type CatalogId =
  | 'svh-12week'
  | 'cc-cert'
  | 'grief-course'
  | 'asj'
  | 'mmj'
  | 'inner-child'
  | 'masterclass'
  | 'songdeck';

// Checkout/registration slugs that are variants of a catalog product, mapped to
// the canonical catalog id so Purchase/AddToCart events bind to a real product.
const VARIANT_TO_CATALOG_ID: Record<string, CatalogId> = {
  'cc-bundle': 'cc-cert', // the certification "path" is the certification course
  'asj-pro': 'asj', // ASJ-PRO is the Authentic Singing Journey + mantra pack
};

// Resolve any product/registration slug to the catalog content_id to report.
// Unknown slugs (e.g. the journey bundles, which aren't catalog products) pass
// through unchanged — harmless: they simply won't match a catalog item.
export function catalogContentId(slug: string): string {
  return VARIANT_TO_CATALOG_ID[slug] ?? slug;
}

// Meta wants ONE currency per feed (verified: a feed is single-currency, and
// other currencies come from a country-override feed keyed by id). So we publish
// the EUR main feed (/feeds/meta-catalog.csv) plus one override feed per other
// currency the site prices in (/feeds/meta-catalog-<cur>.csv). A feed currency
// is therefore exactly the set of currencies the site holds price points for.
export type FeedCurrency = SupportedCurrency;
export const FEED_CURRENCIES: FeedCurrency[] = [...SUPPORTED_CURRENCIES];

// EUR is the catalog's base/main-feed currency; every other supported currency
// gets a country-override feed. The country each override should be assigned to
// in Commerce Manager is the inverse of COUNTRY_CURRENCY (here 1:1 — USD↦US,
// GBP↦GB, …; EUR is the default for every other country).
export const BASE_FEED_CURRENCY: FeedCurrency = 'EUR';
export const OVERRIDE_CURRENCIES: FeedCurrency[] = FEED_CURRENCIES.filter(
  (c) => c !== BASE_FEED_CURRENCY,
);

// currency → the ISO-2 country/countries that should receive its override feed.
export const OVERRIDE_FEED_COUNTRIES: Record<string, string[]> = Object.entries(
  COUNTRY_CURRENCY,
).reduce<Record<string, string[]>>((acc, [country, currency]) => {
  (acc[currency] ??= []).push(country);
  return acc;
}, {});

export interface CatalogItem {
  id: CatalogId;
  title: string;
  // Public ad copy — bound by the copy book (docs/svh-copy-book.md). These are
  // lifted from each page's already-approved meta description.
  description: string;
  link: string; // site-relative path; absolutized in the feed
  imageKey?: string; // R2 key for the main image, served at /media/<key>
  imageUrl?: string; // absolute main-image URL — used instead of imageKey when set
  // Extra R2 image keys (served at /media/<key>) for Meta's additional_image_link
  // — Meta shows whichever performs best (up to 10).
  additionalImageKeys?: string[];
  priceEur: number; // major units (99 = €99) — convenience for pages/events
  // major units, per feed currency. Partial because a product may not be priced
  // in every currency (Songdeck is EUR-only), in which case the override feed
  // for the missing currency simply omits the product and Meta shows the base.
  prices: Partial<Record<FeedCurrency, number>>;
  availability: 'in stock' | 'out of stock';
  condition: 'new';
  brand: string;
}

// The single price-resolution point. Reads each product's figure from the
// existing per-currency price modules (never a second copy), so the feeds and
// the on-page event value all track one source. Returns null when a product has
// no price point in that currency, so the override feed can skip it.
// NOTE: the masterclass DB/migration slug is `svh-masterclass`, but the catalog
// id stays `masterclass` on purpose — do not "fix" it, or the feed/Pixel match
// breaks. Its price lives (in minor units) in the marketing-prices table.
// Songdeck is a physical product sold on the external songdeck.shop (Shopify),
// which handles its own currency display — so here it carries only its EUR
// price and is omitted from the non-EUR override feeds.
const SONGDECK_PRICE_EUR = 44;

function priceFor(id: CatalogId, currency: FeedCurrency): number | null {
  switch (id) {
    case 'svh-12week':
      return TWELVE_WEEK_PRICE[currency];
    case 'cc-cert':
      return getCertOffer(currency).price;
    case 'grief-course':
      return GRIEF_PRICE[currency];
    case 'asj':
      return PRICE_BY_SLUG.asj![currency];
    case 'mmj':
      return PRICE_BY_SLUG.mmj![currency];
    case 'inner-child':
      return PRICE_BY_SLUG['inner-child']![currency];
    case 'masterclass':
      return MARKETING_PRICES_MINOR.masterclass[currency] / 100;
    case 'songdeck':
      return currency === 'EUR' ? SONGDECK_PRICE_EUR : null;
  }
}

// The current sale price for the feed's `sale_price` column, or null when there
// is no live sale for this product/currency. Driven by the site's single promo
// source (src/lib/promo): when the launch promo ends, this returns null again
// and the feeds drop sale_price automatically — no manual edit, no rebuild.
//
// MUST be called at request time (it reads Date.now() via launchPromoActive),
// never baked into the module-load CATALOG. Songdeck (external shop) is never on
// sale here. The certification has bespoke promo math (the launch percent off
// its LIST/base price), so we read its authoritative promo price from
// applyLaunchPromoToOffer rather than halving its regular price; every other
// product is a straight `LAUNCH_PROMO_PERCENT`% off its regular price — matching
// what each checkout actually charges.
export function salePriceFor(
  id: CatalogId,
  currency: FeedCurrency,
  nowMs: number = Date.now(),
): number | null {
  if (id === 'songdeck') return null;
  if (!launchPromoActive(nowMs)) return null;
  const regular = priceFor(id, currency);
  if (regular == null) return null;
  if (id === 'cc-cert') {
    return applyLaunchPromoToOffer(getCertOffer(currency), nowMs).price;
  }
  return Math.round(regular * (100 - LAUNCH_PROMO_PERCENT)) / 100;
}

type CatalogMeta = Omit<CatalogItem, 'priceEur' | 'prices'>;

const META: CatalogMeta[] = [
  {
    id: 'svh-12week',
    title: 'Somatic Vocal Healing — The 12-Week Course',
    description:
      'Twelve weeks to learn the practice of Somatic Vocal Healing — until you can hold it yourself. A self-paced video course with live weekly Q&A: 12 modules, 18+ hours of guided practice, and lifetime access.',
    link: '/courses/12-week',
    imageKey: 'library/svh-retreat-circle-sunset-group-jacob-central.webp',
    additionalImageKeys: [
      'library/svh-retreat-sounding-jacob-sunset.webp',
      'library/svh-retreat-teaching-jacob-whiteboard.webp',
      'library/svh-retreat-group-indoor.webp',
      // The SVH concept illustrations — warm, evocative sounding imagery.
      'library/svhgpt-01-hero-in-one-breath.webp',
      'library/svhgpt-03-sounding-not-singing.webp',
      'library/svhgpt-06-holding-space.webp',
      'library/svhgpt-05-the-cup-receiving.webp',
    ],
    availability: 'in stock',
    condition: 'new',
    brand: 'Songdance',
  },
  {
    id: 'cc-cert',
    title: 'The Somatic Vocal Healing Certification Course',
    description:
      'A deepening journey with Jacob Vermeulen. Fully self-paced — instant access to the class library with written manuals — with weekly live Q&As, hosted practice sessions and monthly live deepening sessions through the end of 2026, the Somatic Vocal Healing app, and a global community walking it together. Become a certified Somatic Vocal Healing practitioner — or simply go fully in with your own voice.',
    link: '/courses/certification',
    imageKey: 'library/svh-retreat-facilitator-jacob-seated.webp',
    additionalImageKeys: [
      'library/svh-retreat-teaching-jacob-whiteboard.webp',
      'library/svh-retreat-singing-microphone-jacob.webp',
      'library/svh-retreat-circle-sunset-group-jacob-central.webp',
    ],
    availability: 'in stock',
    condition: 'new',
    brand: 'Songdance',
  },
  {
    id: 'grief-course',
    title: 'The Grief Course',
    description:
      'Because no one taught you how to grieve. Learn the foundational tools and practices to be with your grief in a conscious, healthy way — with Daniela Hess and Jacob Vermeulen. 4 sessions, lifetime access.',
    link: '/courses/grief',
    imageKey: 'library/grief-jacob-letting-go-sounding.webp',
    additionalImageKeys: [
      'library/grief-daniela.webp',
      'library/grief-hands-letting-go.webp',
      'library/grief-background-lotus.webp',
    ],
    availability: 'in stock',
    condition: 'new',
    brand: 'Songdance',
  },
  {
    id: 'asj',
    title: 'The Authentic Singing Journey',
    description:
      'Forty weeks of mantras and music, made to free the voice you already have. Self-paced, at home. No range, no experience, no performance required.',
    link: '/courses/authentic-singing',
    imageKey: 'library/singing-lights-woman.webp',
    additionalImageKeys: [
      'library/singing-lights-man.webp',
      'library/singing-nature.webp',
      'library/singing-water.webp',
    ],
    availability: 'in stock',
    condition: 'new',
    brand: 'Songdance',
  },
  {
    id: 'mmj',
    title: 'The Magical Movement Journey',
    description:
      'Guided movement sessions you can do in your own room — standing or seated. No steps to learn, no floor to be good enough for. For every body.',
    link: '/courses/magical-movement',
    imageKey: 'library/movement.webp',
    additionalImageKeys: [
      'library/movement2.webp',
      'library/movement-beach.webp',
      'library/movement-stillness.webp',
    ],
    availability: 'in stock',
    condition: 'new',
    brand: 'Songdance',
  },
  {
    id: 'inner-child',
    title: 'The Inner Child Healing Journey',
    description:
      'Five gentle sessions to meet the younger part of you — and to give it, in sound, some of what it went without. Self-paced, at home.',
    link: '/courses/inner-child',
    imageKey: 'library/inner-child-glow.webp',
    additionalImageKeys: [
      'library/inner-child-beach.webp',
      'library/inner-child-touch.webp',
      'library/inner-child-closeup.webp',
    ],
    availability: 'in stock',
    condition: 'new',
    brand: 'Songdance',
  },
  {
    id: 'masterclass',
    title: 'Professional Masterclass — Somatic Vocal Healing in Your Work',
    description:
      'A 100-minute live masterclass for therapists, coaches, bodyworkers, facilitators, teachers, and leaders — when words can\'t reach it, sound can. Online, with replay.',
    link: '/courses/masterclass',
    imageKey: 'library/jacob-teaching.webp',
    additionalImageKeys: [
      'library/svh-retreat-teaching-jacob-whiteboard.webp',
      'library/svh-retreat-singing-microphone-jacob.webp',
      'library/jacob-at-piano.webp',
    ],
    availability: 'in stock',
    condition: 'new',
    brand: 'Songdance',
  },
  {
    id: 'songdeck',
    title: 'Songdeck — Authentic Singing',
    description:
      'A deck of 36 illustrated cards, each with a written message and its own song, mantra, or soundscape. Draw a card, scan it with the free Songdeck app, and the music plays.',
    link: '/music/songdeck',
    // Physical product fulfilled on songdeck.shop; its canonical product photo
    // lives on that store's CDN (same image used on the page + structured data).
    imageUrl:
      'https://songdeck.shop/cdn/shop/files/Open_Box_Mockup.jpg?v=1728399000&width=1070',
    // The free Songdeck app that plays each card's sound (served from our R2).
    additionalImageKeys: [
      'library/app-soundofthemoment.webp',
      'library/app-quizz.webp',
      'library/app-leaderboard.webp',
    ],
    availability: 'in stock',
    condition: 'new',
    brand: 'Songdance',
  },
];

export const CATALOG: CatalogItem[] = META.map((m) => {
  const prices: Partial<Record<FeedCurrency, number>> = {};
  for (const c of FEED_CURRENCIES) {
    const p = priceFor(m.id, c);
    if (p != null) prices[c] = p;
  }
  // EUR is always priced (it's the base currency), so priceEur is safe.
  return { ...m, priceEur: prices.EUR!, prices };
});

const BY_ID = new Map<string, CatalogItem>(CATALOG.map((it) => [it.id, it]));

export function catalogItemById(id: CatalogId): CatalogItem {
  const item = BY_ID.get(id);
  if (!item) throw new Error(`Unknown catalog id: ${id}`);
  return item;
}
