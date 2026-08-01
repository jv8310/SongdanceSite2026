// Variant-gate logic for the SVH Certification Course landing page.
// Given a Drip subscriber (or null = unknown email), decide which of the
// 6 personalized offers to render in the registration block.
//
// Variants:
//   B1 — currently in the 12-week course               → cert only
//   B2 — completed the 12-week course                  → cert only
//   G  — completed the GERMAN 12-week course           → cert (20% off) OR the
//        (Drip tag prodG_SVH_12w), no English 12w/cert   path with the English
//                                                        12-week at 75% off
//   A  — any legacy "vsh" tag, no SVH tags             → cert OR bundle
//   D  — already in SVH ecosystem, no 12w / no 9m      → cert OR bundle
//   E  — completely new                                → bundle only
//   C  — already enrolled in the cert course           → portal link, plus
//                                                       an "activate now"
//                                                       affordance while
//                                                       they're still mid-12w
//
// Prices are rendered in EUR by default; US visitors see USD, UK visitors
// see GBP (detected via Cloudflare geo). The detected currency is what
// Stripe is asked to charge, so the buyer pays the headline number.

import type { DripSubscriber } from '../registrations/drip';
import {
  currencyForCountry,
  isSupportedCurrency,
  type SupportedCurrency,
} from '../workshops/currency';
import {
  launchPromoActive,
  LAUNCH_PROMO_PERCENT,
  LAUNCH_PROMO_END_LABEL,
  LAUNCH_PROMO_TAG,
} from '../promo';

export type Variant = 'B1' | 'B2' | 'G' | 'A' | 'D' | 'E' | 'C';

// The Drip tag applied to buyers of the German edition of the 12-week course.
// It never starts with `prod_SVH` (it's `prodG_…`), so it is invisible to the
// `has12w` / `prod_SVH`-prefix checks below — variant G matches it explicitly.
// The cert-page cross-sell for this segment (cert 20% off, English 12-week 75%
// off on the path) is priced in src/lib/courses/path.ts and verified from this
// tag both at display (subscriber-status) and at charge (checkout).
export const GERMAN_12W_DRIP_TAG = 'prodG_SVH_12w';

// The cert path prices in the same currencies the rest of the site is enabled
// for (workshops + the 12-week course), so a 12-week participant upgrading to
// the certification path — including on the 6-month installment plan — is
// billed in their own currency rather than being forced into EUR.
export type Currency = SupportedCurrency;

export type InstallmentPlan = {
  currency: Currency;
  monthly_cents: number;
  monthly: number;        // major unit, e.g. 349
  total_cents: number;    // monthly_cents × count
  total: number;
  count: number;          // 3, 6 or 12
};

export type Offer = {
  slug: 'cc-cert' | 'cc-bundle';
  label: string;
  currency: Currency;
  price: number;          // major unit, e.g. 999
  price_cents: number;    // for Stripe
  base_price: number;     // pre-discount sticker, major unit
  save_note: string;
  // Two installment ladders, both giving full access from the first
  // payment. The 6-month plan carries a higher premium over pay-in-full
  // than the 3-month plan (longer financing, lower monthly barrier).
  installments?: InstallmentPlan;     // 3 monthly payments
  installments_6x?: InstallmentPlan;  // 6 monthly payments
  // 12 monthly payments. Hidden by default — the cert page only surfaces this
  // ladder when the visitor arrives with `?installment=12`. It carries the
  // highest premium over pay-in-full (the longest financing, lowest monthly).
  installments_12x?: InstallmentPlan;
};

// Currency map.
//
// The certification now charges its normal (former list) price — the
// "mid-cohort" discount is retired along with the cohort model (the course is
// fully self-paced now, so `full` equals `base` and nothing renders struck
// through). The workshop-sale discount on the certification path lives in
// src/lib/courses/path.ts, not here.
//
// EUR/USD share price points 1-for-1 — US buyers aren't paying EU VAT, so the
// merchant can absorb the FX gap and the price story stays simple. GBP is
// EUR × ~0.85, rounded to neat headline amounts. The remaining markets
// (CAD/CHF/AUD/NZD/NOK/SEK/DKK) mirror the same EUR-relative ratios the
// 12-week course already uses (see src/lib/courses/twelve-week.ts), rounded to
// clean headline numbers. They exist so a 12-week participant upgrading to the
// certification path is billed in their own currency.
//
// `monthly3` is the 3-month installment; `monthly6` the 6-month one;
// `monthly12` the hidden 12-month one. Each longer ladder totals more (a
// higher premium over pay-in-full: ~5% at 3×, ~13% at 6×, ~20% at 12×) in
// exchange for a lower monthly figure.
//
// INVARIANT: every bundle figure = the cert figure + the matching 12-week
// figure (PRICE/MONTHLY/MONTHLY_6X/MONTHLY_12X in twelve-week.ts) — the path
// page derives its two line items from those sources, so a bundle row that
// drifts from the sum would contradict the on-page breakdown. Reprice the
// 12-week course ⇒ re-sum these rows.
const PRICES: Record<
  Currency,
  {
    cert:   { full: number; base: number; monthly3: number; monthly6: number; monthly12: number };
    bundle: { full: number; base: number; monthly3: number; monthly6: number; monthly12: number };
  }
> = {
  EUR: {
    cert:   { full: 797, base: 797, monthly3: 280, monthly6: 150, monthly12: 80 },
    bundle: { full: 1347, base: 1347, monthly3: 475, monthly6: 255, monthly12: 135 },
  },
  USD: {
    cert:   { full: 797, base: 797, monthly3: 280, monthly6: 150, monthly12: 80 },
    bundle: { full: 1347, base: 1347, monthly3: 475, monthly6: 255, monthly12: 135 },
  },
  GBP: {
    cert:   { full: 690, base: 690, monthly3: 240, monthly6: 130, monthly12: 70 },
    bundle: { full: 1140, base: 1140, monthly3: 400, monthly6: 215, monthly12: 115 },
  },
  CAD: {
    cert:   { full: 1150, base: 1150, monthly3: 400, monthly6: 220, monthly12: 115 },
    bundle: { full: 1950, base: 1950, monthly3: 685, monthly6: 370, monthly12: 195 },
  },
  CHF: {
    cert:   { full: 770, base: 770, monthly3: 270, monthly6: 145, monthly12: 75 },
    bundle: { full: 1295, base: 1295, monthly3: 455, monthly6: 245, monthly12: 127 },
  },
  AUD: {
    cert:   { full: 1350, base: 1350, monthly3: 475, monthly6: 255, monthly12: 135 },
    bundle: { full: 2250, base: 2250, monthly3: 795, monthly6: 425, monthly12: 225 },
  },
  NZD: {
    cert:   { full: 1500, base: 1500, monthly3: 525, monthly6: 285, monthly12: 150 },
    bundle: { full: 2500, base: 2500, monthly3: 875, monthly6: 475, monthly12: 250 },
  },
  NOK: {
    cert:   { full: 9300, base: 9300, monthly3: 3250, monthly6: 1750, monthly12: 925 },
    bundle: { full: 15600, base: 15600, monthly3: 5500, monthly6: 2950, monthly12: 1555 },
  },
  SEK: {
    cert:   { full: 9000, base: 9000, monthly3: 3150, monthly6: 1700, monthly12: 900 },
    bundle: { full: 15200, base: 15200, monthly3: 5325, monthly6: 2875, monthly12: 1520 },
  },
  DKK: {
    cert:   { full: 5850, base: 5850, monthly3: 2050, monthly6: 1100, monthly12: 585 },
    bundle: { full: 9900, base: 9900, monthly3: 3475, monthly6: 1870, monthly12: 990 },
  },
};

function plan(currency: Currency, monthly: number, count: number): InstallmentPlan {
  return {
    currency,
    monthly,
    monthly_cents: monthly * 100,
    count,
    total: monthly * count,
    total_cents: monthly * 100 * count,
  };
}

function certOffer(currency: Currency): Omit<Offer, 'save_note'> {
  const p = PRICES[currency].cert;
  return {
    slug: 'cc-cert',
    label: 'SVH Certification Course',
    currency,
    price: p.full,
    price_cents: p.full * 100,
    base_price: p.base,
    installments: plan(currency, p.monthly3, 3),
    installments_6x: plan(currency, p.monthly6, 6),
    installments_12x: plan(currency, p.monthly12, 12),
  };
}
function bundleOffer(currency: Currency): Omit<Offer, 'save_note'> {
  const p = PRICES[currency].bundle;
  return {
    slug: 'cc-bundle',
    label: 'Certification path',
    currency,
    price: p.full,
    price_cents: p.full * 100,
    base_price: p.base,
    installments: plan(currency, p.monthly3, 3),
    installments_6x: plan(currency, p.monthly6, 6),
    installments_12x: plan(currency, p.monthly12, 12),
  };
}

// Bare offers used by the checkout endpoint, where the discount copy is
// irrelevant — only the price + identity matter. Exported per currency so
// the checkout handler can validate {product_slug, currency} → offer.
export function getCertOffer(currency: Currency): Offer {
  const base = certOffer(currency);
  return { ...base, save_note: '' };
}
export function getBundleOffer(currency: Currency): Offer {
  const base = bundleOffer(currency);
  return { ...base, save_note: '' };
}

// Back-compat exports (EUR) — still imported by older code paths.
export const CERT_OFFER: Offer = getCertOffer('EUR');
export const BUNDLE_OFFER: Offer = getBundleOffer('EUR');

// During a launch promo, the certification price becomes the launch percent
// off the LIST/base price (e.g. €797 → €399). The base stays as the struck
// "before" figure. Each installment ladder keeps its existing
// premium-over-pay-in-full ratio, scaled to the promo price and rounded to
// clean whole units so the monthly figures stay tidy. Returns the offer
// unchanged when the promo isn't live. A `?discount=N` override should NOT be
// combined with this (the override wins outright) — the callers only apply
// this when no override is present.
export function applyLaunchPromoToOffer(
  offer: Offer,
  nowMs: number = Date.now(),
): Offer {
  if (!launchPromoActive(nowMs)) return offer;
  const promoFullCents = Math.round(
    (offer.base_price * 100 * (100 - LAUNCH_PROMO_PERCENT)) / 100,
  );
  const oldFullCents = offer.price_cents; // normal full; ladders are relative to it
  const reLadder = (p?: InstallmentPlan): InstallmentPlan | undefined => {
    if (!p) return undefined;
    const ratio = oldFullCents > 0 ? (p.monthly_cents * p.count) / oldFullCents : 1;
    const monthlyMajor = Math.round((promoFullCents * ratio) / p.count / 100);
    const monthly_cents = monthlyMajor * 100;
    return {
      currency: p.currency,
      monthly: monthlyMajor,
      monthly_cents,
      count: p.count,
      total: monthlyMajor * p.count,
      total_cents: monthly_cents * p.count,
    };
  };
  return {
    ...offer,
    price: Math.round(promoFullCents / 100),
    price_cents: promoFullCents,
    save_note: `${LAUNCH_PROMO_TAG} — ${LAUNCH_PROMO_PERCENT}% off, through ${LAUNCH_PROMO_END_LABEL}`,
    installments: reLadder(offer.installments),
    installments_6x: reLadder(offer.installments_6x),
    installments_12x: reLadder(offer.installments_12x),
  };
}

export type VariantDecision = {
  variant: Variant;
  currency: Currency;
  offers: Offer[];
  // Present only when the subscriber's 12w is ongoing — the inline UI uses
  // it to say "you're in week N" and to surface the activate-now / wait toggle.
  twelve_week_week?: number;
  // Variant C only: true when the buyer holds prod_SVH_9m but is still mid-12w
  // (svh_week 1-12 ongoing). The cert page then offers a one-click
  // "activate now" button that sets svh_week to 12 on Drip.
  can_activate_now?: boolean;
  // Present for variant C only — where to send them once activated.
  course_portal_url?: string;
  // Personalisation: known subscriber details the front-end can use to
  // greet by name and pre-fill the form.
  first_name?: string;
  last_name?: string;
  country?: string;
  phone?: string;
};

// The Drip "current week" field has been named differently over time
// (Jacob's older automations use `prod_SVH_week`; the spec calls it
// `svh_week`). Look it up case-insensitively across known aliases so a
// returning student in week 2 isn't misclassified as "completed".
function readWeekField(
  fields: Record<string, string> | undefined,
): string | undefined {
  if (!fields) return undefined;
  const aliases = ['svh_week', 'prod_svh_week', 'svh_current_week', 'prod_svh_current_week'];
  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(fields)) lower.set(k.toLowerCase(), v);
  for (const a of aliases) {
    const v = lower.get(a);
    if (v != null && String(v).trim()) return String(v);
  }
  return undefined;
}

// Parse Drip's `svh_week` custom field. While the 12-week course is running,
// it's a number 1-12 (published by src/lib/courses/week-progress.ts as the
// weeks turn over). Once the run ends it reads "Ended since YYYY-MM-DD"; once
// the person moves onto the certification course it reads "Ongoing
// Certification". Anything else is treated as "no 12w".
function parseSvhWeek(raw: string | undefined): {
  ongoing: boolean;
  ended: boolean;
  week?: number;
} {
  if (!raw) return { ongoing: false, ended: false };
  const trimmed = raw.trim();
  if (!trimmed) return { ongoing: false, ended: false };
  if (/^ended\b/i.test(trimmed)) return { ongoing: false, ended: true };
  // On the certification course — past the foundation lane either way, and
  // never a candidate for the "activate now" offer (it's already activated).
  if (/^ongoing\s+certification/i.test(trimmed)) return { ongoing: false, ended: true };
  const m = trimmed.match(/^(\d{1,2})/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 12) return { ongoing: true, ended: false, week: n };
    if (n > 12) return { ongoing: false, ended: true };
  }
  return { ongoing: false, ended: false };
}

function offersFor(variant: Variant, currency: Currency): Offer[] {
  const cert = (save_note: string): Offer => ({
    ...certOffer(currency),
    save_note,
  });
  const bundle = (save_note: string): Offer => ({
    ...bundleOffer(currency),
    save_note,
  });
  switch (variant) {
    case 'B1':
      return [cert('Upgrading from the 12-week course — self-paced, start today')];
    case 'B2':
      return [cert('Graduate of the 12-week course — self-paced, start today')];
    case 'G':
      // Cert first (their natural next step; priced 20% off — the discounted
      // offer is substituted by subscriber-status, see germanCertOffer), then
      // the path pairing it with the English 12-week at a graduate's 75% off.
      return [
        cert('Graduate of the German 12-week course — self-paced, start today'),
        bundle('Add the English 12-week course at a graduate’s price'),
      ];
    case 'A':
      return [
        cert('Welcome back — self-paced, start today'),
        bundle('Includes the complete refreshed 12-week foundational course'),
      ];
    case 'D':
      return [
        cert('Self-paced — start today'),
        bundle('Includes the complete refreshed 12-week foundational course'),
      ];
    case 'E':
      return [bundle('Includes the complete refreshed 12-week foundational course')];
    case 'C':
      return [];
  }
}

export function decideVariant(
  subscriber: DripSubscriber | null,
  opts: { coursePortalUrl?: string; currency?: Currency } = {},
): VariantDecision {
  const currency: Currency = opts.currency ?? 'EUR';

  // Unknown email → newcomer
  if (!subscriber) {
    return { variant: 'E', currency, offers: offersFor('E', currency) };
  }

  const personalia = {
    first_name: subscriber.first_name || undefined,
    last_name: subscriber.last_name || undefined,
    country: subscriber.country || undefined,
    phone: subscriber.phone || undefined,
  };

  const tags = new Set(subscriber.tags ?? []);
  const has = (t: string) => tags.has(t);
  const hasAnyStartingWith = (prefix: string) => {
    for (const t of tags) if (t.startsWith(prefix)) return true;
    return false;
  };
  // Legacy "VSH" (Vocal Sound Healing — the trainings offered before the SVH
  // lineage) marks someone who has already walked this work. Drip records it
  // under many tag spellings — `prod_VSH`, but also free-form ones like `VSH`,
  // `vsh-2021`, `VSH workshop` — so match any tag CONTAINING "vsh"
  // case-insensitively rather than a single exact tag. (The current "svh"
  // product tags do not contain the substring "vsh", so the SVH checks above
  // are unaffected.)
  const hasLegacyVsh = (() => {
    for (const t of tags) if (t.toLowerCase().includes('vsh')) return true;
    return false;
  })();

  const svhWeek = parseSvhWeek(readWeekField(subscriber.custom_fields));

  // C — already in the cert course. If they're still in the 12-week (week 1-12
  // ongoing), offer them an "activate now" button that bumps svh_week to 12
  // on Drip so the existing automation opens cert access.
  if (has('prod_SVH_9m')) {
    return {
      variant: 'C',
      currency,
      offers: [],
      can_activate_now: svhWeek.ongoing,
      twelve_week_week: svhWeek.week,
      course_portal_url:
        opts.coursePortalUrl ?? 'https://circle.songdance.co/spaces/20377292/feed',
      ...personalia,
    };
  }

  const has12w = has('prod_SVH_12w');

  // B1 — currently mid 12-week
  if (has12w && svhWeek.ongoing) {
    return {
      variant: 'B1',
      currency,
      offers: offersFor('B1', currency),
      twelve_week_week: svhWeek.week,
      ...personalia,
    };
  }

  // B2 — completed the 12-week (either explicitly ended, or has the tag
  // with no usable week value)
  if (has12w) {
    return { variant: 'B2', currency, offers: offersFor('B2', currency), ...personalia };
  }

  // G — graduate of the GERMAN 12-week course (prodG_SVH_12w), without the
  // English 12-week or the cert. Checked after B1/B2 (someone who also owns the
  // English 12-week gets that cert-only offer — the English cross-sell is moot)
  // and before A/D/E (the German-graduate offer is the most specific one for
  // them). They walked the foundation once, so the cert is 20% off and the path
  // adds the English 12-week at a graduate's 75% off (priced in path.ts).
  if (has(GERMAN_12W_DRIP_TAG)) {
    return { variant: 'G', currency, offers: offersFor('G', currency), ...personalia };
  }

  // A — old VSH client, no SVH foundation
  // (any "vsh"-containing tag marks the legacy course — these students return
  // for the updated SVH lineage and may or may not want the 12w refresh. They
  // are experienced in this work, never newcomers.)
  if (hasLegacyVsh && !hasAnyStartingWith('prod_SVH')) {
    return { variant: 'A', currency, offers: offersFor('A', currency), ...personalia };
  }

  // D — in the SVH ecosystem some other way (workshop, retreat, etc.)
  // but never bought the 12w or the cert.
  if (hasAnyStartingWith('prod_SVH')) {
    return { variant: 'D', currency, offers: offersFor('D', currency), ...personalia };
  }

  // E — known to Drip but no relevant product history → newcomer offer
  return { variant: 'E', currency, offers: offersFor('E', currency), ...personalia };
}
