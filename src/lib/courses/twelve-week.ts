// The 12-Week Somatic Vocal Healing Course — pricing, regional rates, the
// 3-month installment plan, and the workshop-linked discount window.
//
// Sales model (set by Jacob):
//   - Email-gated. Entering an email reveals the price.
//   - Base price is a fixed per-region price point, ~€480 across the same
//     currencies the workshop engine prices in (NOT runtime FX).
//   - Anyone whose email matches a workshop registration gets a personal
//     25% discount, auto-applied — no code to type. It is live *before* their
//     workshop (no countdown) and for 48 hours *after* it (with a countdown);
//     after that the price returns to normal.
//   - A 3-month installment plan is available (a small premium over paying in
//     full); the discount applies to each installment too.
//
// Stripe fulfilment reuses the shared course pipeline (pending row → Checkout
// → webhook → paid-handler). On payment the Drip subscriber is tagged
// `prod_SVH_12w`.

import {
  currencyForCountry,
  isSupportedCurrency,
  type SupportedCurrency,
} from '../workshops/currency';
import {
  launchPromoPercent,
  LAUNCH_PROMO_ENDS_AT_MS,
  LAUNCH_PROMO_END_LABEL,
} from '../promo';

export type TwelveWeekCurrency = SupportedCurrency;

export const TWELVE_WEEK_PRODUCT_SLUG = 'svh-12week';
export const TWELVE_WEEK_DRIP_TAG = 'prod_SVH_12w';
export const TWELVE_WEEK_DRIP_EVENT = 'Completed 12-Week SVH course registration';

// Workshop-attendee discount.
export const DISCOUNT_PERCENT = 25;
// Hours the discount stays live after a workshop has taken place.
export const DISCOUNT_WINDOW_HOURS = 48;
// Installments.
export const INSTALLMENT_COUNT = 3;

// Fixed price points (major units), chosen to sit close to €480 in each market
// and round cleanly. EUR/USD are pinned at 480; the rest are sensible
// equivalents. Edit these numbers to change a region's price.
export const PRICE: Record<TwelveWeekCurrency, number> = {
  EUR: 480,
  USD: 480,
  GBP: 400,
  CAD: 700,
  CHF: 460,
  AUD: 800,
  NZD: 880,
  NOK: 5500,
  SEK: 5400,
  DKK: 3550,
};

// Per-month installment amount (major units), ×3. Carries a small premium over
// paying in full (≈5–8%) for the convenience of spreading it out.
export const MONTHLY: Record<TwelveWeekCurrency, number> = {
  EUR: 170,
  USD: 170,
  GBP: 140,
  CAD: 250,
  CHF: 165,
  AUD: 285,
  NZD: 310,
  NOK: 1950,
  SEK: 1900,
  DKK: 1250,
};

// 6-month installment plan. Used by the 12-week line of the Certification path,
// and — unlocked by a hand-shared `?installment=6` (or `=12`) link — on the
// standalone 12-week course too (it's hidden by default; the page only shows
// full + 3× unless the visitor arrives with that param). The longer term
// carries a slightly higher total than the 3-month plan — ≈0.54× the 3-month
// monthly, the same step the certification ladder takes from its 3- to 6-month
// tier, landing the 6-month total ~14–16% over pay-in-full. Edit to reprice. ×6.
export const INSTALLMENT_COUNT_6X = 6;
export const MONTHLY_6X: Record<TwelveWeekCurrency, number> = {
  EUR: 90,
  USD: 90,
  GBP: 75,
  CAD: 130,
  CHF: 85,
  AUD: 150,
  NZD: 165,
  NOK: 1050,
  SEK: 1025,
  DKK: 670,
};

// 12-month installment plan for the standalone 12-week course, unlocked only by
// a hand-shared `?installment=12` link (never shown to everyone). The longest
// term carries the largest convenience premium — set at a clean ~20% over
// pay-in-full across every market. Edit these to reprice. ×12.
export const INSTALLMENT_COUNT_12X = 12;
export const MONTHLY_12X: Record<TwelveWeekCurrency, number> = {
  EUR: 48,
  USD: 48,
  GBP: 40,
  CAD: 70,
  CHF: 46,
  AUD: 80,
  NZD: 88,
  NOK: 550,
  SEK: 540,
  DKK: 355,
};

// Country (ISO-2) → the currency we price the course in. Reuses the workshop
// resolver (which already falls back to EUR for everywhere we don't price).
export function twelveWeekCurrencyForCountry(
  country: string | null | undefined,
): TwelveWeekCurrency {
  const c = currencyForCountry(country);
  return isSupportedCurrency(c) ? c : 'EUR';
}

export function priceCents(currency: TwelveWeekCurrency): number {
  return PRICE[currency] * 100;
}
export function monthlyCents(currency: TwelveWeekCurrency): number {
  return MONTHLY[currency] * 100;
}
export function monthlyCents6x(currency: TwelveWeekCurrency): number {
  return MONTHLY_6X[currency] * 100;
}
export function monthlyCents12x(currency: TwelveWeekCurrency): number {
  return MONTHLY_12X[currency] * 100;
}
export function installmentTotalCents(currency: TwelveWeekCurrency): number {
  return monthlyCents(currency) * INSTALLMENT_COUNT;
}

// Apply the 25% discount to a cents amount (rounded to the nearest cent).
export function applyDiscountCents(cents: number): number {
  return Math.round((cents * (100 - DISCOUNT_PERCENT)) / 100);
}

// Apply an arbitrary percentage off a cents amount (rounded to nearest cent).
// Used for the URL `?discount=N` override, which can be any integer 1–99.
export function applyPercentCents(cents: number, percent: number): number {
  if (percent <= 0) return cents;
  return Math.round((cents * (100 - percent)) / 100);
}

// URL-driven discount override (`?discount=N`). Any integer 1–99 is honoured
// and *overrides* the automatic workshop discount; anything else (0, ≥100,
// NaN, negative) means "no override". Mirrors the certification page's
// `?discount=` so both funnels behave identically. (100% isn't supported —
// Stripe Checkout can't take a zero charge.)
export function parseUrlDiscountPercent(raw: unknown): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? parseInt(raw, 10)
        : NaN;
  if (Number.isInteger(n) && n >= 1 && n <= 99) return n;
  return 0;
}

// 'promo' = the launch-promo discount (no countdown; ends at the promo deadline).
export type DiscountKind = 'pre' | 'post' | 'none' | 'promo';

export type DiscountStatus = {
  eligible: boolean;
  kind: DiscountKind;
  // Epoch ms the discount expires at — only set for the post-workshop window
  // (the 48h countdown). null before the workshop and when not eligible.
  expiresAtMs: number | null;
};

// Given the anchor time of a person's workshop (its end, or start if no end is
// known) and "now", decide whether their discount is live and which kind.
//   now  <  anchor            → 'pre'  (registered, workshop still ahead — no countdown)
//   anchor ≤ now ≤ anchor+48h → 'post' (just happened — 48h countdown)
//   now  >  anchor+48h        → 'none' (window closed)
export function workshopDiscountStatus(
  anchorMs: number | null | undefined,
  nowMs: number,
  windowHours: number = DISCOUNT_WINDOW_HOURS,
): DiscountStatus {
  if (anchorMs == null || !Number.isFinite(anchorMs)) {
    return { eligible: false, kind: 'none', expiresAtMs: null };
  }
  if (nowMs < anchorMs) {
    return { eligible: true, kind: 'pre', expiresAtMs: null };
  }
  const expiresAtMs = anchorMs + windowHours * 60 * 60 * 1000;
  if (nowMs <= expiresAtMs) {
    return { eligible: true, kind: 'post', expiresAtMs };
  }
  return { eligible: false, kind: 'none', expiresAtMs: null };
}

// Best discount across all of a person's workshop anchors. A live "pre" window
// (an upcoming workshop) wins outright — the discount is open with no countdown.
// Otherwise the "post" window with the most time left is used (its 48h
// countdown). If nothing is live, no discount.
export function bestDiscountStatus(
  anchorsMs: Array<number | null | undefined>,
  nowMs: number,
  windowHours: number = DISCOUNT_WINDOW_HOURS,
): DiscountStatus {
  let hasPre = false;
  let latestPostExpiry: number | null = null;
  for (const a of anchorsMs) {
    const s = workshopDiscountStatus(a, nowMs, windowHours);
    if (s.kind === 'pre') hasPre = true;
    else if (s.kind === 'post' && s.expiresAtMs != null) {
      if (latestPostExpiry == null || s.expiresAtMs > latestPostExpiry) {
        latestPostExpiry = s.expiresAtMs;
      }
    }
  }
  if (hasPre) return { eligible: true, kind: 'pre', expiresAtMs: null };
  if (latestPostExpiry != null) {
    return { eligible: true, kind: 'post', expiresAtMs: latestPostExpiry };
  }
  return { eligible: false, kind: 'none', expiresAtMs: null };
}

// Resolve a workshop's discount-window anchor: prefer its end time, fall back
// to its start. Returns epoch ms, or null if unparseable.
export function anchorMsFromWorkshop(
  startsAtUtc: string,
  endsAtUtc: string | null,
): number | null {
  const raw = endsAtUtc || startsAtUtc;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

// The discount that actually applies to the 12-week price, after a possible
// URL override. A `?discount=N` override (1–99) always wins over the automatic
// workshop discount and carries no countdown; otherwise the workshop window
// decides (25% off, with the 48h countdown only for the post-workshop window).
// The override percent is the source of truth for the charge, so the server
// re-derives it the same way the status endpoint reports it.
export type EffectiveDiscount = {
  eligible: boolean;
  percent: number; // 0 when not eligible
  kind: DiscountKind | 'override';
  expiresAtMs: number | null;
};

export function effectiveTwelveWeekDiscount(
  workshop: DiscountStatus,
  overridePercent: number,
  nowMs: number = Date.now(),
): EffectiveDiscount {
  // A hand-crafted ?discount=N link is an explicit, intentional price — it wins
  // outright (even over the launch promo), so partner/bespoke links aren't
  // capped at the promo percent.
  if (overridePercent >= 1 && overridePercent <= 99) {
    return { eligible: true, percent: overridePercent, kind: 'override', expiresAtMs: null };
  }
  // Launch promo vs. the workshop window: take the better deal. The promo
  // carries no countdown (the banner names its deadline plainly).
  const promo = launchPromoPercent(nowMs);
  const workshopPercent = workshop.eligible ? DISCOUNT_PERCENT : 0;
  if (promo > 0 && promo >= workshopPercent) {
    return { eligible: true, percent: promo, kind: 'promo', expiresAtMs: null };
  }
  if (workshop.eligible) {
    return {
      eligible: true,
      percent: DISCOUNT_PERCENT,
      kind: workshop.kind,
      expiresAtMs: workshop.expiresAtMs,
    };
  }
  return { eligible: false, percent: 0, kind: 'none', expiresAtMs: null };
}

// The offer the after-workshop emails should actually quote — promo-aware.
//
// Normally that's the 25% participant discount on its real 48h countdown. But
// while the launch promo is live it beats that discount site-wide (50% > 25%)
// and runs to a fixed calendar date, so the same page an attendee lands on
// shows 50% off through the promo deadline — not 25%, and not a 48h cliff.
// The emails must match: quoting "25%, then full price in 48h" during the promo
// both *undersells* the page and names a deadline that isn't real (they keep
// 50% until the promo ends). This returns the percent + the deadline the copy
// should name, and flips back to the 25%/48h window automatically the moment
// the promo ends — nothing to unwind by hand later.
export type PostWorkshopOffer = {
  percent: number; // 25 normally; the promo percent while the promo is live
  deadlineMs: number; // the 48h window end normally; the promo end while live
  // A plain calendar label ('July 15') while the promo is live; null outside it,
  // where the caller formats `deadlineMs` as the recipient's local 48h time.
  deadlineLabel: string | null;
  promo: boolean;
};

export function postWorkshopEmailOffer(
  discountEndsMs: number,
  nowMs: number = Date.now(),
): PostWorkshopOffer {
  const promo = launchPromoPercent(nowMs);
  if (promo >= DISCOUNT_PERCENT && Number.isFinite(LAUNCH_PROMO_ENDS_AT_MS)) {
    return {
      percent: promo,
      deadlineMs: LAUNCH_PROMO_ENDS_AT_MS,
      deadlineLabel: LAUNCH_PROMO_END_LABEL,
      promo: true,
    };
  }
  return {
    percent: DISCOUNT_PERCENT,
    deadlineMs: discountEndsMs,
    deadlineLabel: null,
    promo: false,
  };
}
