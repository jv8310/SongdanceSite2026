// Splitting Meta ad spend by funnel intent.
//
// Jacob's naming convention on the ad account: the prospecting (top-of-funnel)
// campaign carries "TOF" in its name; every other campaign is a retargeting /
// warm-audience campaign. Cost per workshop registration is an *acquisition*
// metric — it should be charged against the prospecting spend that actually
// buys new registrations, not against retargeting that re-touches people who
// are already in the funnel. Folding retargeting in would overstate what a
// registration costs to acquire.
//
// A blank campaign name (an account-level pull from before the per-campaign
// breakdown existed, or a CSV with no campaign column) can't be split, so it
// counts as acquisition — this preserves the old "all spend ÷ regs" figure for
// any window that predates per-campaign data.

// Matches "TOF" as its own token, tolerant of the delimiters Meta names use
// (space, dash, underscore, pipe, colon). So "TOF", "TOF - Prospecting",
// "SVH_TOF_Broad", "svh-tof|broad" all count; "portfolio"/"platform" don't.
const TOF_TOKEN = /(^|[^a-z0-9])tof([^a-z0-9]|$)/i;

export type CampaignKind = 'acquisition' | 'retargeting';

// True when the campaign's spend should count toward cost per registration.
export function isAcquisitionCampaign(campaign: string | null | undefined): boolean {
  const s = (campaign ?? '').trim();
  if (s === '') return true; // no breakdown → treat as acquisition (legacy)
  return TOF_TOKEN.test(s);
}

export function isRetargetingCampaign(campaign: string | null | undefined): boolean {
  return !isAcquisitionCampaign(campaign);
}

export function campaignKind(campaign: string | null | undefined): CampaignKind {
  return isAcquisitionCampaign(campaign) ? 'acquisition' : 'retargeting';
}

// ---------------------------------------------------------------------------
// Which product a campaign buys registrations for.
//
// Prospecting runs one campaign per top-of-funnel product — e.g.
// "IM | WW_TOF_Purchase_Cold_SVH Workshop" and
// "IM | WW_TOF_Purchase_Cold_SVH Masterclass". Pooling those two and pricing
// every registration off the pool charges masterclass money to workshop seats
// and vice versa: the cheaper product subsidises the dearer one and neither
// cost per registration is real. So spend is bucketed by the product its
// campaign names, and each bucket is only ever charged to that product's
// sessions (see lib/ads/allocation.ts + computeWorkshopPerformance).
//
// A campaign that names neither ("general" — including the blank campaign of a
// legacy account-level pull or a CSV with no campaign column) can't be tied to
// one product, so it keeps the old behaviour: charged across every
// registration in the window.

// "Masterclass" / "master class" / "master-class" (+ plural) as its own token.
const MASTERCLASS_TOKEN = /(^|[^a-z0-9])master[\s_-]?classe?s?([^a-z0-9]|$)/i;
// "Workshop"/"Workshops" as its own token.
const WORKSHOP_TOKEN = /(^|[^a-z0-9])workshops?([^a-z0-9]|$)/i;

export type CampaignAudience = 'workshop' | 'masterclass' | 'general';

/**
 * The product a campaign's spend should be charged to. Masterclass is tested
 * first: it is the more specific name, so "SVH Masterclass" never reads as a
 * workshop campaign even if the word appears alongside it.
 */
export function campaignAudience(campaign: string | null | undefined): CampaignAudience {
  const s = (campaign ?? '').trim();
  if (s === '') return 'general';
  if (MASTERCLASS_TOKEN.test(s)) return 'masterclass';
  if (WORKSHOP_TOKEN.test(s)) return 'workshop';
  return 'general';
}

export const CAMPAIGN_AUDIENCE_LABEL: Record<CampaignAudience, string> = {
  workshop: 'Workshop',
  masterclass: 'Masterclass',
  general: 'All sessions',
};
