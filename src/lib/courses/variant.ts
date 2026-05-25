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

export type Offer = {
  slug: 'cc-cert' | 'cc-bundle';
  label: string;
  price_eur: number;
  price_cents: number;
};

export const CERT_OFFER: Offer = {
  slug: 'cc-cert',
  label: 'Certification Course',
  price_eur: 999,
  price_cents: 99900,
};

export const BUNDLE_OFFER: Offer = {
  slug: 'cc-bundle',
  label: 'Foundation + Certification (Bundle)',
  price_eur: 1499,
  price_cents: 149900,
};

export type VariantDecision = {
  variant: Variant;
  offers: Offer[];
  // Present only when the subscriber's 12w is ongoing — the inline UI uses
  // it to say "you're in week N" and to surface the activate-now / wait toggle.
  twelve_week_week?: number;
  // Present for variant C only — where to send them.
  course_portal_url?: string;
};

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

export function decideVariant(
  subscriber: DripSubscriber | null,
  opts: { coursePortalUrl?: string } = {},
): VariantDecision {
  // Unknown email → newcomer
  if (!subscriber) {
    return { variant: 'E', offers: [BUNDLE_OFFER] };
  }

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
    };
  }

  const svhWeek = parseSvhWeek(subscriber.custom_fields?.svh_week);
  const has12w = has('prod_SVH_12w');

  // B1 — currently mid 12-week
  if (has12w && svhWeek.ongoing) {
    return {
      variant: 'B1',
      offers: [CERT_OFFER],
      twelve_week_week: svhWeek.week,
    };
  }

  // B2 — completed the 12-week (either explicitly ended, or has the tag
  // with no usable week value)
  if (has12w) {
    return { variant: 'B2', offers: [CERT_OFFER] };
  }

  // A — old VSH client, no SVH foundation
  // (prod_VSH was the legacy course tag — these students return for the
  // updated SVH lineage and may or may not want the 12w refresh.)
  if (has('prod_VSH') && !hasAnyStartingWith('prod_SVH')) {
    return { variant: 'A', offers: [CERT_OFFER, BUNDLE_OFFER] };
  }

  // D — in the SVH ecosystem some other way (workshop, retreat, etc.)
  // but never bought the 12w or the cert.
  if (hasAnyStartingWith('prod_SVH')) {
    return { variant: 'D', offers: [CERT_OFFER, BUNDLE_OFFER] };
  }

  // E — known to Drip but no relevant product history → newcomer offer
  return { variant: 'E', offers: [BUNDLE_OFFER] };
}
