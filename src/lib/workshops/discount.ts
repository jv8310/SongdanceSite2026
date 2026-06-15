// Workshop / masterclass TICKET discounts, driven by two URL params. The
// discount only ever touches the ticket — the order bump is never discounted.
//
//   ?discount=50    Public. ONLY the value 50 is honored — this is the
//                   "share with a friend" link, safe to post anywhere. Any
//                   other value is ignored, so no one can edit it up to 100.
//
//   ?adiscount=N    Owner. Any integer 1–100. The param NAME ("adiscount") is
//                   the secret — not guessable, meant to be shared sparingly.
//                   Use it to hand-craft a bespoke discount for a campaign.
//
// Enforcement lives server-side in /api/workshops/register (the single
// checkout chokepoint); the page-level reads below only mirror the price so
// the buyer sees what they'll pay.

export const PUBLIC_DISCOUNT_PCT = 50;
export const PUBLIC_DISCOUNT_PARAM = 'discount';
export const SECRET_DISCOUNT_PARAM = 'adiscount';

// Resolve the effective ticket discount percent (0 = none) from raw param
// values. The owner's secret param wins; the public param only ever yields 50.
export function resolveDiscountPercent(raw: {
  discount?: string | null;
  adiscount?: string | null;
}): number {
  const secret = clampPct(raw.adiscount);
  if (secret) return secret;
  return clampPct(raw.discount) === PUBLIC_DISCOUNT_PCT ? PUBLIC_DISCOUNT_PCT : 0;
}

// Parse a percent string to an integer in 1–100, or 0 if out of range / junk.
function clampPct(v: string | null | undefined): number {
  const n = parseInt((v ?? '').trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 100) return 0;
  return n;
}

// Apply a percent discount to a minor amount (rounded to the nearest unit).
// A percent of 0 returns the amount unchanged.
export function applyDiscountPercent(amountMinor: number, pct: number): number {
  if (!pct) return amountMinor;
  return Math.round((amountMinor * (100 - pct)) / 100);
}
