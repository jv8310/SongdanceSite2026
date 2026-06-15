// Variant-gate logic for the SVH Certification Course landing page.
// Given a Drip subscriber (or null = unknown email), decide which of the
// 6 personalized offers to render in the registration block.
//
// Variants:
//   B1 — currently in the 12-week course               → cert only
//   B2 — completed the 12-week course                  → cert only
//   A  — old VSH client, no SVH tags                   → cert OR bundle
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

export type Variant = 'B1' | 'B2' | 'A' | 'D' | 'E' | 'C';
export type Currency = 'EUR' | 'USD' | 'GBP';

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
// USD reuses the EUR numbers 1-for-1 ($999 / $1,499 etc.) — US buyers
// aren't paying EU VAT, so the merchant can absorb the FX gap and the
// price story stays simple.
//
// GBP is EUR × ~0.85, rounded to neat headline amounts.
// `monthly3` is the 3-month installment; `monthly6` the 6-month one;
// `monthly12` the hidden 12-month one. Each longer ladder totals more (a
// higher premium over pay-in-full) in exchange for a lower monthly figure.
const PRICES: Record<
  Currency,
  {
    cert:   { full: number; base: number; monthly3: number; monthly6: number; monthly12: number };
    bundle: { full: number; base: number; monthly3: number; monthly6: number; monthly12: number };
  }
> = {
  EUR: {
    cert:   { full: 999,  base: 1500, monthly3: 349, monthly6: 189, monthly12: 99 },
    bundle: { full: 1499, base: 2150, monthly3: 525, monthly6: 285, monthly12: 149 },
  },
  USD: {
    cert:   { full: 999,  base: 1500, monthly3: 349, monthly6: 189, monthly12: 99 },
    bundle: { full: 1499, base: 2150, monthly3: 525, monthly6: 285, monthly12: 149 },
  },
  GBP: {
    cert:   { full: 849,  base: 1299, monthly3: 299, monthly6: 159, monthly12: 85 },
    bundle: { full: 1299, base: 1849, monthly3: 459, monthly6: 245, monthly12: 129 },
  },
};

function symbol(c: Currency): string {
  if (c === 'USD') return '$';
  if (c === 'GBP') return '£';
  return '€';
}
function money(amount: number, currency: Currency): string {
  return `${symbol(currency)}${amount.toLocaleString('en-US')}`;
}

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
  return { ...base, save_note: 'Mid-cohort discount applied' };
}
export function getBundleOffer(currency: Currency): Offer {
  const base = bundleOffer(currency);
  return { ...base, save_note: 'Mid-cohort discount applied' };
}

// Back-compat exports (EUR) — still imported by older code paths.
export const CERT_OFFER: Offer = getCertOffer('EUR');
export const BUNDLE_OFFER: Offer = getBundleOffer('EUR');

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
// it's a number 1-12. Once the course ends, Jacob's automation sets it to
// "Ended since YYYY-MM-DD" (or similar). Anything else is treated as "no 12w".
function parseSvhWeek(raw: string | undefined): {
  ongoing: boolean;
  ended: boolean;
  week?: number;
} {
  if (!raw) return { ongoing: false, ended: false };
  const trimmed = raw.trim();
  if (!trimmed) return { ongoing: false, ended: false };
  if (/^ended\b/i.test(trimmed)) return { ongoing: false, ended: true };
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
  // "Save" amounts are derived from base − full so the copy stays correct
  // in either currency.
  const certSave = money(
    PRICES[currency].cert.base - PRICES[currency].cert.full,
    currency,
  );
  const bundleSave = money(
    PRICES[currency].bundle.base - PRICES[currency].bundle.full,
    currency,
  );
  switch (variant) {
    case 'B1':
      return [cert(`Save ${certSave} — upgrading from the 12-week course, mid-cohort discount applied`)];
    case 'B2':
      return [cert(`Save ${certSave} — graduate of the 12-week course, mid-cohort discount applied`)];
    case 'A':
      return [
        cert('Welcome-back price, mid-cohort discount applied'),
        bundle(`Save ${bundleSave} — includes the complete refreshed 12-week foundational course`),
      ];
    case 'D':
      return [
        cert('Mid-cohort discount applied'),
        bundle(`Save ${bundleSave} — includes the complete refreshed 12-week foundational course`),
      ];
    case 'E':
      return [bundle(`Save ${bundleSave} — mid-cohort discount applied`)];
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

  // A — old VSH client, no SVH foundation
  // (prod_VSH was the legacy course tag — these students return for the
  // updated SVH lineage and may or may not want the 12w refresh.)
  if (has('prod_VSH') && !hasAnyStartingWith('prod_SVH')) {
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
