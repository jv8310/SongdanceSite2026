// The exact Drip tags a paid course registration receives — extracted as a pure
// function so the live paid-handler (pushPaidCourseRegistrationToDrip) and the
// historical contact-tag backfill compute an identical tag set and can never
// drift. This is ONLY the tag list; the Drip event name + custom fields stay in
// the handler (they aren't mirrored onto contacts).

import { GRIEF_DRIP_TAG, GRIEF_PRODUCT_SLUG } from './grief';
import { TWELVE_WEEK_DRIP_TAG, TWELVE_WEEK_PRODUCT_SLUG } from './twelve-week';
import { isJourneySlug, journeyDrip, type JourneyLanguageChoice } from './journeys';
import { BUMPS, isBumpSlug } from './bumps';
import { parsePurchasedBumps } from './db';

// Tagging differs by course, exactly as the paid-handler applies it:
//   grief        → prod_Grief-sp
//   journeys     → DRIP_BY_SLUG tags, honouring the Dutch-edition language choice
//   svh-12week   → prod_SVH_12w + each purchased order bump's product tag
//   cert/bundle  → prod_SVH_9m (+ prod_SVH_12w for the bundle)
export function courseDripTags(reg: {
  product_slug: string;
  language_choice: JourneyLanguageChoice | null;
  bumps: string | null;
}): string[] {
  if (reg.product_slug === GRIEF_PRODUCT_SLUG) return [GRIEF_DRIP_TAG];

  if (isJourneySlug(reg.product_slug)) {
    return journeyDrip(reg.product_slug, reg.language_choice).tags;
  }

  if (reg.product_slug === TWELVE_WEEK_PRODUCT_SLUG) {
    const tags = [TWELVE_WEEK_DRIP_TAG];
    for (const b of parsePurchasedBumps(reg.bumps)) {
      if (isBumpSlug(b.slug)) tags.push(BUMPS[b.slug].dripTag);
    }
    return tags;
  }

  // cert (cc-cert) / bundle (cc-bundle).
  const tags = ['prod_SVH_9m'];
  if (reg.product_slug === 'cc-bundle') tags.push('prod_SVH_12w');
  return tags;
}
