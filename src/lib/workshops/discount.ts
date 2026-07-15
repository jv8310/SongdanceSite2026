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

import { launchPromoPercent } from '../promo';
import { masterclassPromoPercent } from '../masterclass-promo';

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

// Compound two discount percents — e.g. a 50% promo and a 50% referral give
// 75% off (50% off the already-half price), NOT 100%. Order-independent;
// inputs are clamped to 0–100.
export function compoundDiscountPercent(a: number, b: number): number {
  const pa = Math.min(100, Math.max(0, a || 0));
  const pb = Math.min(100, Math.max(0, b || 0));
  return Math.round(100 - ((100 - pa) * (100 - pb)) / 100);
}

// Resolve the effective TICKET discount percent for a workshop checkout,
// folding the promo(s) into the URL params. Ticket only — the order bump is
// never discounted.
//
// "the promo" is the launch sale (all tickets) OR — for a masterclass ticket —
// the better of the launch sale and the standalone masterclass launch offer
// (src/lib/masterclass-promo.ts), which keeps the masterclass at 50% after the
// launch sale closes. `opts.isMasterclass` must be set by the caller once the
// ticket product is known (its slug contains "masterclass").
//
//   - ?adiscount=N (owner secret): an intentional, absolute price — taken as the
//     better of it and the promo (max), never stacked.
//   - ?discount=50 (public "share with a friend"): STACKS on top of the promo,
//     so a referred friend gets 50% off the already-50%-off price (75% total)
//     while a promo runs, and a plain 50% off once it ends.
//   - neither: just the promo (0 when none applies).
//
// Mirrored client-side in WERegister/MCRegister so the displayed price matches.
export function resolveTicketDiscountPercent(
  raw: { discount?: string | null; adiscount?: string | null },
  nowMs: number = Date.now(),
  opts: { isMasterclass?: boolean } = {},
): number {
  const promo = Math.max(
    launchPromoPercent(nowMs),
    opts.isMasterclass ? masterclassPromoPercent(nowMs) : 0,
  );
  const secret = clampPct(raw.adiscount);
  if (secret) return Math.max(secret, promo);
  const referral = clampPct(raw.discount) === PUBLIC_DISCOUNT_PCT ? PUBLIC_DISCOUNT_PCT : 0;
  if (referral) return promo ? compoundDiscountPercent(promo, referral) : referral;
  return promo;
}
