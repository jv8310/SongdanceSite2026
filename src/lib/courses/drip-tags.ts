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
import { isAlbumProductSlug } from '../music/product';

// Tagging differs by course, exactly as the paid-handler applies it:
//   grief        → prod_Grief-sp
//   journeys     → DRIP_BY_SLUG tags, honouring the Dutch-edition language choice
//   svh-12week   → prod_SVH_12w + each purchased order bump's product tag
//   album-<id>   → [] here — the tag lives on the music_albums row (D1), so the
//                  paid-handler looks it up itself; this pure function must not
//                  fall through to the cert tags for an album purchase
//   cert/bundle  → prod_SVH_9m (+ prod_SVH_12w for the bundle) + each order bump's tag
export function courseDripTags(reg: {
  product_slug: string;
  language_choice: JourneyLanguageChoice | null;
  bumps: string | null;
}): string[] {
  if (reg.product_slug === GRIEF_PRODUCT_SLUG) return [GRIEF_DRIP_TAG];

  if (isAlbumProductSlug(reg.product_slug)) return [];

  if (isJourneySlug(reg.product_slug)) {
    return journeyDrip(reg.product_slug, reg.language_choice).tags;
  }

  // Purchased order bumps (ASJ / Grief) grant their product tag, on both the
  // 12-week and the cert/bundle checkouts. The zero-amount Song Deck gift row
  // isn't a bump slug, so isBumpSlug skips it.
  const bumpTags: string[] = [];
  for (const b of parsePurchasedBumps(reg.bumps)) {
    if (isBumpSlug(b.slug)) bumpTags.push(BUMPS[b.slug].dripTag);
  }

  if (reg.product_slug === TWELVE_WEEK_PRODUCT_SLUG) {
    return [TWELVE_WEEK_DRIP_TAG, ...bumpTags];
  }

  // cert (cc-cert) / bundle (cc-bundle).
  const tags = ['prod_SVH_9m'];
  if (reg.product_slug === 'cc-bundle') tags.push('prod_SVH_12w');
  tags.push(...bumpTags);
  return tags;
}
