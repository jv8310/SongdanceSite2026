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
