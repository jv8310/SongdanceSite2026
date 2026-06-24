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
import { getCertOffer } from '../courses/variant';
import { GRIEF_PRICE } from '../courses/grief';
import { PRICE_BY_SLUG } from '../courses/journeys';
import { MARKETING_PRICES_MINOR } from '../workshops/marketing-prices';

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
// other currencies come from a country-override feed keyed by id). We publish
// the EUR main feed plus a USD override feed, so these are the two currencies
// a catalog item resolves a price in.
export type FeedCurrency = 'EUR' | 'USD';
export const FEED_CURRENCIES: FeedCurrency[] = ['EUR', 'USD'];

export interface CatalogItem {
  id: CatalogId;
  title: string;
  // Public ad copy — bound by the copy book (docs/svh-copy-book.md). These are
  // lifted from each page's already-approved meta description.
  description: string;
  link: string; // site-relative path; absolutized in the feed
  imageKey?: string; // R2 key, served at /media/<key>
  imageUrl?: string; // absolute image URL — used instead of imageKey when set
  priceEur: number; // major units (99 = €99) — convenience for pages/events
  prices: Record<FeedCurrency, number>; // major units, per feed currency
  availability: 'in stock' | 'out of stock';
  condition: 'new';
  brand: string;
}

// The single price-resolution point. Reads each product's EUR/USD figure from
// the existing per-currency price modules (never a second copy), so the feeds,
// the override feed, and the on-page event value all track one source.
// NOTE: the masterclass DB/migration slug is `svh-masterclass`, but the catalog
// id stays `masterclass` on purpose — do not "fix" it, or the feed/Pixel match
// breaks. Its price lives (in minor units) in the marketing-prices table.
// Songdeck is a physical product sold on the external songdeck.shop (Shopify),
// so it has no per-currency price module here — its price is a fixed figure,
// the same numerically in EUR and USD (matching how every other product mirrors
// EUR↔USD on this site).
const SONGDECK_PRICE = 44;

function priceFor(id: CatalogId, currency: FeedCurrency): number {
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
      return SONGDECK_PRICE;
  }
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
    availability: 'in stock',
    condition: 'new',
    brand: 'Songdance',
  },
  {
    id: 'cc-cert',
    title: 'The Somatic Vocal Healing Certification Course',
    description:
      'A deepening journey with Jacob Vermeulen. Live classes and instant-access recordings, weekly Q&As, hosted practice sessions, monthly live deepening sessions, the Somatic Vocal Healing app, and a global community walking it together. Become a certified Somatic Vocal Healing practitioner — or simply go fully in with your own voice.',
    link: '/courses/certification',
    imageKey: 'library/svh-retreat-facilitator-jacob-seated.webp',
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
    availability: 'in stock',
    condition: 'new',
    brand: 'Songdance',
  },
  {
    id: 'masterclass',
    title: 'Professional Masterclass — Somatic Vocal Healing in Your Work',
    description:
      'A 90-minute live masterclass for therapists, coaches, bodyworkers, facilitators, teachers, and leaders — what sound can do in your work when words run out. Online, with replay.',
    link: '/courses/masterclass',
    imageKey: 'library/jacob-teaching.webp',
    availability: 'in stock',
    condition: 'new',
    brand: 'Songdance',
  },
  {
    id: 'songdeck',
    title: 'Songdeck — Authentic Singing',
    description:
      'A deck of 36 illustrated cards, each with a written message and its own song, mantra, or soundscape. Draw a card, scan it with the free Songdeck app, and the music plays.',
    link: '/courses/songdeck',
    // Physical product fulfilled on songdeck.shop; its canonical product photo
    // lives on that store's CDN (same image used on the page + structured data).
    imageUrl:
      'https://songdeck.shop/cdn/shop/files/Open_Box_Mockup.jpg?v=1728399000&width=1070',
    availability: 'in stock',
    condition: 'new',
    brand: 'Songdance',
  },
];

export const CATALOG: CatalogItem[] = META.map((m) => ({
  ...m,
  priceEur: priceFor(m.id, 'EUR'),
  prices: { EUR: priceFor(m.id, 'EUR'), USD: priceFor(m.id, 'USD') },
}));

const BY_ID = new Map<string, CatalogItem>(CATALOG.map((it) => [it.id, it]));

export function catalogItemById(id: CatalogId): CatalogItem {
  const item = BY_ID.get(id);
  if (!item) throw new Error(`Unknown catalog id: ${id}`);
  return item;
}
