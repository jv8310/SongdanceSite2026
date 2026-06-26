// The downsell catalogue — the gentler, lower-commitment doors we offer an
// attendee who didn't take the 12-week course after the discount window closed.
//
// Instead of nagging about the €650 course again, the reworked downsell sequence
// promotes the journeys and the grief course: small, self-paced (or short live)
// products that are a natural next sip after one workshop hour. WHICH of them a
// given person sees is decided per-recipient from what they DON'T already own —
// the cron passes in the buyer's Drip product tags + paid course slugs and we
// filter the owned ones out, so nobody is pitched a product they bought
// (including as an order bump on a previous checkout — bumps apply the same
// `prod_*` tags). If they own everything here, the downsell quietly drops the
// product cards and ends on the free practice + the live calendar.
//
// This module is pure data + selection (no HTML). emails.ts renders the cards
// from it via the email-design toolkit; cron.ts computes ownership and selection.
//
// Ownership tags mirror the canonical Drip side-effects:
//   grief        → prod_Grief-sp            (src/lib/courses/grief.ts)
//   inner-child  → prod_InnerChild          (src/lib/courses/journeys.ts)
//   mmj          → prod_MMJ                 (src/lib/courses/journeys.ts)
//   asj          → prod_ASJ / prod_JAZ      (English + Dutch editions)
// and the paid `course_registrations.product_slug` each product checks out as.

export type DownsellKey = 'grief' | 'inner-child' | 'mmj' | 'asj';

export type DownsellOffer = {
  key: DownsellKey;
  label: string;
  path: string; // course page path; emails prepend the base URL
  image: string; // absolute R2 URL (inboxes can't resolve relative paths)
  imageAlt: string;
  eyebrow: string;
  blurb: string; // feature-card prose (copy-book voice)
  points: string[]; // 2–3 bullets
  priceNote: string; // small tag line — EUR anchor; the page localises on arrival
  miniLine: string; // one line for the slim "also" card
  quote: string; // a copy-book one-liner, used where a pull-quote fits
  // Ownership signals — matched case-insensitively.
  ownedTags: string[]; // Drip product tags meaning they already have it
  // Paid product slugs that mean they own it: a course_registrations.product_slug
  // (a standalone purchase) OR a workshop_purchases bump/course slug (e.g. the
  // workshop's `asj-bump` order bump — "bought as a bump offer").
  paidSlugs: string[];
};

// The four atomic downsell products, in the order we prefer to surface them:
// grief leads (it is the deepest companion to a sounding hour — "grief is the
// river"), then the gentle, low-cost inner-child, then movement, then the big
// authentic-singing library.
export const DOWNSELL_OFFERS: Record<DownsellKey, DownsellOffer> = {
  grief: {
    key: 'grief',
    label: 'The Grief Course',
    path: '/courses/grief',
    image: 'https://songdance.co/media/library/grief-jacob-letting-go-sounding.webp',
    imageAlt: 'Jacob sounding in an open field',
    eyebrow: 'With Daniela Hess & Jacob',
    blurb:
      'Because no one taught you how to grieve. Four live sessions on being with grief — the great griefs and the everyday ones — and on sounding it through the body. Grief is the river, not the knot; here you learn to let the wave move through.',
    points: [
      'Four live sessions · 120 min each — with lifetime replay',
      'Held by two grief educators — Daniela Hess & Jacob',
      'Somatic tools to meet grief in its many forms',
    ],
    priceNote: '€99 · 4 live sessions · lifetime access',
    miniLine: 'Sound your grief through — four live sessions, lifetime replay.',
    quote: 'When grief comes, it is welcome.',
    ownedTags: ['prod_grief-sp'],
    paidSlugs: ['grief-course'],
  },
  'inner-child': {
    key: 'inner-child',
    label: 'The Inner Child Healing Journey',
    path: '/courses/inner-child',
    image: 'https://songdance.co/media/library/inner-child-glow.webp',
    imageAlt: 'Warm light — the inner-child journey',
    eyebrow: 'The gentlest way in',
    blurb:
      'Five gentle sessions to meet the younger part of you — and to give it, in sound, some of what it went without. The high, small sounds in a voice usually belong to the child you were; this is where you sit down beside them.',
    points: [
      'Five short, self-paced sessions',
      'Sound a little of what that part went without',
      'Yours to return to — lifetime access',
    ],
    priceNote: '€29 · self-paced · lifetime access',
    miniLine: 'Five gentle sessions to meet the child you were.',
    quote: 'The child you were is still listening.',
    ownedTags: ['prod_innerchild'],
    paidSlugs: ['inner-child'],
  },
  mmj: {
    key: 'mmj',
    label: 'The Magical Movement Journey',
    path: '/courses/magical-movement',
    image: 'https://songdance.co/media/library/movement.webp',
    imageAlt: 'Movement in an open room',
    eyebrow: 'For every body',
    blurb:
      'Guided movement you can do in your own room — standing, or seated in a chair if that is what the body needs today. No steps to learn, no floor to be good enough for. The body remembers what the voice begins.',
    points: [
      'Guided sessions — standing or seated',
      'No steps to learn · for every body',
      'Self-paced · yours to keep',
    ],
    priceNote: '€49 · self-paced · lifetime access',
    miniLine: 'Move it through — guided, standing or seated, for every body.',
    quote: 'Alone in your own room, it is another story entirely.',
    ownedTags: ['prod_mmj'],
    paidSlugs: ['mmj'],
  },
  asj: {
    key: 'asj',
    label: 'The Authentic Singing Journey',
    path: '/courses/authentic-singing',
    image: 'https://songdance.co/media/library/singing-lights-woman.webp',
    imageAlt: 'A woman sounding in warm light',
    eyebrow: 'Forty weeks of mantras & music',
    blurb:
      'A different doorway: forty weeks of original mantras and music, made to free the voice you already have — not to train it into something else. No right notes. No audition. No one listening but you.',
    points: [
      '40 guided sessions · one a week, in your own time',
      'Original music & mantras to sound along with',
      'Stream anytime — yours to keep',
    ],
    priceNote: '€99 · 40 sessions · yours to keep',
    miniLine: 'Forty weeks of mantras to free the voice you already have.',
    quote: 'The voice you already have — not trained into something else.',
    ownedTags: ['prod_asj', 'prod_jaz'],
    paidSlugs: ['asj', 'asj-pro', 'asj-bump'], // asj-bump = the workshop order bump
  },
};

// Preference order for surfacing offers in the sequence.
export const DOWNSELL_ORDER: DownsellKey[] = ['grief', 'inner-child', 'mmj', 'asj'];

// The three journeys, for the "or take all three together" bundle mention —
// only worth offering when the person owns none of them.
export const JOURNEY_KEYS: DownsellKey[] = ['inner-child', 'mmj', 'asj'];
export const BUNDLE_PATH = '/courses/authentic-singing';

export type Ownership = {
  tags: Set<string>; // lowercased Drip tags
  slugs: Set<string>; // lowercased paid course_registrations product slugs
};

export function ownsOffer(offer: DownsellOffer, owned: Ownership): boolean {
  if (offer.ownedTags.some((t) => owned.tags.has(t.toLowerCase()))) return true;
  if (offer.paidSlugs.some((s) => owned.slugs.has(s.toLowerCase()))) return true;
  return false;
}

// The offers this person doesn't already own, in preference order.
export function eligibleDownsellOffers(owned: Ownership): DownsellOffer[] {
  return DOWNSELL_ORDER.map((k) => DOWNSELL_OFFERS[k]).filter((o) => !ownsOffer(o, owned));
}

// Whether the all-three-journeys bundle is worth mentioning (owns none of the
// three journeys — grief is separate and doesn't count).
export function bundleEligible(owned: Ownership): boolean {
  return JOURNEY_KEYS.every((k) => !ownsOffer(DOWNSELL_OFFERS[k], owned));
}
