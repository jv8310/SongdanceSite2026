// Variant-gate logic for the SVH Certification Course landing page.
// Given a Drip subscriber (or null = unknown email), decide which of the
// 6 personalized offers to render in the registration block.
//
// Variants:
//   B1 — currently in the 12-week course               → cert only (€999)
//   B2 — completed the 12-week course                  → cert only (€999)
//   A  — old VSH client, no SVH tags                   → cert OR bundle
//   D  — already in SVH ecosystem, no 12w / no 9m      → cert OR bundle
//   E  — completely new                                → bundle only (€1,499)
//   C  — already enrolled in the cert course           → portal link, no checkout

import type { DripSubscriber } from '../registrations/drip';

export type Variant = 'B1' | 'B2' | 'A' | 'D' | 'E' | 'C';

export type InstallmentPlan = {
  // 3 monthly charges of `monthly_cents`. `total_cents` may differ from
  // price_cents by a few cents because we round to a clean monthly amount
  // (e.g. €499.67/mo rounds to a fixed value Stripe can charge). The UI
  // surfaces both the monthly and the rounded total.
  monthly_cents: number;
  monthly_eur: number;
  total_cents: number;
  total_eur: number;
  count: number; // always 3 for now
};

export type Offer = {
  slug: 'cc-cert' | 'cc-bundle';
  label: string;
  price_eur: number;
  price_cents: number;
  base_price_eur: number;
  save_note: string;
  installments?: InstallmentPlan;
};

// €333 × 3 = €999 (exact match to the cert price)
const CERT_INSTALLMENTS: InstallmentPlan = {
  monthly_cents: 33300,
  monthly_eur: 333,
  total_cents: 99900,
  total_eur: 999,
  count: 3,
};

// €500 × 3 = €1500 — €1 uplift over the €1499 sticker; the UI is honest
// about the slight markup that pays for the 3-month payment plan.
const BUNDLE_INSTALLMENTS: InstallmentPlan = {
  monthly_cents: 50000,
  monthly_eur: 500,
  total_cents: 150000,
  total_eur: 1500,
  count: 3,
};

const CERT_BASE = {
  slug: 'cc-cert' as const,
  label: 'SVH Certification Course',
  price_eur: 999,
  price_cents: 99900,
  base_price_eur: 1500,
  installments: CERT_INSTALLMENTS,
};

const BUNDLE_BASE = {
  slug: 'cc-bundle' as const,
  label: '12-Week Course + Certification Course',
  price_eur: 1499,
  price_cents: 149900,
  base_price_eur: 2150,
  installments: BUNDLE_INSTALLMENTS,
};

// Bare offers used by the checkout endpoint, where the discount copy is
// irrelevant — only the price + identity matter.
export const CERT_OFFER: Offer = {
  ...CERT_BASE,
  save_note: 'Mid-cohort discount applied',
};
export const BUNDLE_OFFER: Offer = {
  ...BUNDLE_BASE,
  save_note: 'Mid-cohort discount applied',
};

export type VariantDecision = {
  variant: Variant;
  offers: Offer[];
  // Present only when the subscriber's 12w is ongoing — the inline UI uses
  // it to say "you're in week N" and to surface the activate-now / wait toggle.
  twelve_week_week?: number;
  // Present for variant C only — where to send them.
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

function offersFor(variant: Variant): Offer[] {
  const cert = (save: string): Offer => ({
    ...CERT_BASE,
    save_note: save,
  });
  const bundle = (save: string): Offer => ({
    ...BUNDLE_BASE,
    save_note: save,
  });
  switch (variant) {
    case 'B1':
      return [cert('Save €501 — upgrading from the 12-week course, mid-cohort discount applied')];
    case 'B2':
      return [cert('Save €501 — graduate of the 12-week course, mid-cohort discount applied')];
    case 'A':
      return [
        cert('Welcome-back price, mid-cohort discount applied'),
        bundle('Save €651 — includes the complete refreshed 12-week foundational course'),
      ];
    case 'D':
      return [
        cert('Mid-cohort discount applied'),
        bundle('Save €651 — includes the complete refreshed 12-week foundational course'),
      ];
    case 'E':
      return [bundle('Save €651 — mid-cohort discount applied')];
    case 'C':
      return [];
  }
}

export function decideVariant(
  subscriber: DripSubscriber | null,
  opts: { coursePortalUrl?: string } = {},
): VariantDecision {
  // Unknown email → newcomer
  if (!subscriber) {
    return { variant: 'E', offers: offersFor('E') };
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

  // C — already in the cert course
  if (has('prod_SVH_9m')) {
    return {
      variant: 'C',
      offers: [],
      course_portal_url:
        opts.coursePortalUrl ?? 'https://app.songdance.co/svh-certification',
      ...personalia,
    };
  }

  const svhWeek = parseSvhWeek(readWeekField(subscriber.custom_fields));
  const has12w = has('prod_SVH_12w');

  // B1 — currently mid 12-week
  if (has12w && svhWeek.ongoing) {
    return {
      variant: 'B1',
      offers: offersFor('B1'),
      twelve_week_week: svhWeek.week,
      ...personalia,
    };
  }

  // B2 — completed the 12-week (either explicitly ended, or has the tag
  // with no usable week value)
  if (has12w) {
    return { variant: 'B2', offers: offersFor('B2'), ...personalia };
  }

  // A — old VSH client, no SVH foundation
  // (prod_VSH was the legacy course tag — these students return for the
  // updated SVH lineage and may or may not want the 12w refresh.)
  if (has('prod_VSH') && !hasAnyStartingWith('prod_SVH')) {
    return { variant: 'A', offers: offersFor('A'), ...personalia };
  }

  // D — in the SVH ecosystem some other way (workshop, retreat, etc.)
  // but never bought the 12w or the cert.
  if (hasAnyStartingWith('prod_SVH')) {
    return { variant: 'D', offers: offersFor('D'), ...personalia };
  }

  // E — known to Drip but no relevant product history → newcomer offer
  return { variant: 'E', offers: offersFor('E'), ...personalia };
}
