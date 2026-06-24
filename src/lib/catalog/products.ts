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
import { getCertOffer, getBundleOffer } from '../courses/variant';
import { GRIEF_PRICE } from '../courses/grief';
import { PRICE_BY_SLUG } from '../courses/journeys';
import { MARKETING_PRICES_MINOR } from '../workshops/marketing-prices';

// The catalog id IS the Pixel content_id. Use the canonical product slugs.
export type CatalogId =
  | 'svh-12week'
  | 'cc-cert'
  | 'cc-bundle'
  | 'grief-course'
  | 'asj'
  | 'asj-pro'
  | 'mmj'
  | 'inner-child'
  | 'masterclass';

export interface CatalogItem {
  id: CatalogId;
  title: string;
  // Public ad copy — bound by the copy book (docs/svh-copy-book.md). These are
  // lifted from each page's already-approved meta description.
  description: string;
  link: string; // site-relative path; absolutized in the feed
  imageKey: string; // R2 key, served at /media/<key>
  priceEur: number; // major units (99 = €99)
  availability: 'in stock' | 'out of stock';
  condition: 'new';
  brand: string;
}

// Masterclass has no per-currency course-price module of its own; its EUR price
// lives (in minor units) in the marketing-prices table. NOTE: the DB/migration
// slug for this product is `svh-masterclass`, but the catalog id stays
// `masterclass` on purpose — do not "fix" it, or the feed/Pixel match breaks.
const MASTERCLASS_EUR = MARKETING_PRICES_MINOR.masterclass.EUR / 100;

export const CATALOG: CatalogItem[] = [
  {
    id: 'svh-12week',
    title: 'Somatic Vocal Healing — The 12-Week Course',
    description:
      'Twelve weeks to learn the practice of Somatic Vocal Healing — until you can hold it yourself. A self-paced video course with live weekly Q&A: 12 modules, 18+ hours of guided practice, and lifetime access.',
    link: '/courses/12-week',
    imageKey: 'library/svh-retreat-circle-sunset-group-jacob-central.webp',
    priceEur: TWELVE_WEEK_PRICE.EUR,
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
    priceEur: getCertOffer('EUR').price,
    availability: 'in stock',
    condition: 'new',
    brand: 'Songdance',
  },
  {
    id: 'cc-bundle',
    title: 'The Certification Path — 12-Week Course + Certification',
    description:
      'The full path in one place: the 12-Week Course and the Certification Course together. Learn the practice of Somatic Vocal Healing and walk all the way to certified practitioner, with live classes, weekly Q&As, the app, and a global community.',
    link: '/courses/certification',
    imageKey: 'library/svh-retreat-facilitator-jacob-seated.webp',
    priceEur: getBundleOffer('EUR').price,
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
    priceEur: GRIEF_PRICE.EUR,
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
    priceEur: PRICE_BY_SLUG.asj!.EUR,
    availability: 'in stock',
    condition: 'new',
    brand: 'Songdance',
  },
  {
    id: 'asj-pro',
    title: 'The Authentic Singing Journey — PRO (with mantra pack)',
    description:
      'The Authentic Singing Journey with the PRO mantra pack added — the same forty weeks of mantras and music to free the voice you already have, plus the downloadable mantra pack. Self-paced, at home.',
    link: '/courses/authentic-singing',
    imageKey: 'library/singing-lights-woman.webp',
    priceEur: PRICE_BY_SLUG['asj-pro']!.EUR,
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
    priceEur: PRICE_BY_SLUG.mmj!.EUR,
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
    priceEur: PRICE_BY_SLUG['inner-child']!.EUR,
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
    priceEur: MASTERCLASS_EUR,
    availability: 'in stock',
    condition: 'new',
    brand: 'Songdance',
  },
];

const BY_ID = new Map<string, CatalogItem>(CATALOG.map((it) => [it.id, it]));

export function catalogItemById(id: CatalogId): CatalogItem {
  const item = BY_ID.get(id);
  if (!item) throw new Error(`Unknown catalog id: ${id}`);
  return item;
}
