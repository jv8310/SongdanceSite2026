// The 12-Week Somatic Vocal Healing Course — pricing, regional rates, the
// 3-month installment plan, and the workshop-linked discount window.
//
// Sales model (set by Jacob):
//   - Email-gated. Entering an email reveals the price.
//   - Base price is a fixed per-region price point, ~€650 across the same
//     currencies the workshop engine prices in (NOT runtime FX).
//   - Anyone whose email matches a workshop registration gets a personal
//     20% discount, auto-applied — no code to type. It is live *before* their
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

export type TwelveWeekCurrency = SupportedCurrency;

export const TWELVE_WEEK_PRODUCT_SLUG = 'svh-12week';
export const TWELVE_WEEK_DRIP_TAG = 'prod_SVH_12w';
export const TWELVE_WEEK_DRIP_EVENT = 'Completed 12-Week SVH course registration';

// Workshop-attendee discount.
export const DISCOUNT_PERCENT = 20;
// Hours the discount stays live after a workshop has taken place.
export const DISCOUNT_WINDOW_HOURS = 48;
// Installments.
export const INSTALLMENT_COUNT = 3;

// Fixed price points (major units), chosen to sit close to €650 in each market
// and round cleanly. EUR/USD are pinned at 650; the rest are sensible
// equivalents. Edit these numbers to change a region's price.
export const PRICE: Record<TwelveWeekCurrency, number> = {
  EUR: 650,
  USD: 650,
  GBP: 550,
  CAD: 950,
  CHF: 620,
  AUD: 1090,
  NZD: 1190,
  NOK: 7500,
  SEK: 7300,
  DKK: 4800,
};

// Per-month installment amount (major units), ×3. Carries a small premium over
// paying in full (≈5–8%) for the convenience of spreading it out.
export const MONTHLY: Record<TwelveWeekCurrency, number> = {
  EUR: 230,
  USD: 230,
  GBP: 195,
  CAD: 335,
  CHF: 220,
  AUD: 385,
  NZD: 420,
  NOK: 2650,
  SEK: 2590,
  DKK: 1700,
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
export function installmentTotalCents(currency: TwelveWeekCurrency): number {
  return monthlyCents(currency) * INSTALLMENT_COUNT;
}

// Apply the 20% discount to a cents amount (rounded to the nearest cent).
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

export type DiscountKind = 'pre' | 'post' | 'none';

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
// decides (20% off, with the 48h countdown only for the post-workshop window).
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
): EffectiveDiscount {
  if (overridePercent >= 1 && overridePercent <= 99) {
    return { eligible: true, percent: overridePercent, kind: 'override', expiresAtMs: null };
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
