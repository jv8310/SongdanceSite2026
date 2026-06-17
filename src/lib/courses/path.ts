// The "Certification path" = the 12-Week Course + the Certification Course,
// presented (and sold) as two transparent line items with one combined total.
//
//   - The certification line is always its standard price.
//   - The 12-week line carries the workshop discount (and its 48h countdown)
//     when the buyer's email sits in a live workshop window — exactly the same
//     rule as the standalone 12-week course. No workshop link → full 12-week.
//   - Both portions are charged together in one currency, so the path is only
//     ever priced in the certification currencies (EUR/USD/GBP).
//
// This is the single source of truth shared by the two status endpoints AND the
// checkout, so the displayed breakdown can never drift from the amount charged.
// Fulfilment is unchanged: the path is the existing `cc-bundle` product, which
// already tags both `prod_SVH_12w` + `prod_SVH_9m` and honours `activate_choice`.

import { getCertOffer, applyLaunchPromoToOffer, type Currency } from './variant';
import { launchPromoActive } from '../promo';
import {
  priceCents,
  monthlyCents,
  applyPercentCents,
  bestDiscountStatus,
  anchorMsFromWorkshop,
  effectiveTwelveWeekDiscount,
  INSTALLMENT_COUNT,
  type DiscountKind,
  type EffectiveDiscount,
} from './twelve-week';
import {
  listSecuredWorkshopLinksByEmail,
  listReplayViewAnchorsByEmail,
} from '../workshops/db';

export type CertificationPathPricing = {
  currency: Currency;
  // 12-week line (workshop-discounted)
  twelve_week_base_cents: number;
  twelve_week_price_cents: number;
  twelve_week_base_monthly_cents: number;
  twelve_week_monthly_cents: number;
  // certification line (sticker → standard mid-cohort price)
  cert_base_price_cents: number;
  cert_price_cents: number;
  cert_monthly_cents: number;
  // combined
  total_cents: number;
  total_monthly_cents: number;
  base_total_cents: number; // pre-discount total (cert sticker + full 12-week)
  base_total_monthly_cents: number;
  installment_count: number;
  discount: {
    eligible: boolean;
    percent: number;
    kind: DiscountKind | 'override';
    expires_at_ms: number | null;
  };
};

// Compose the path's two line items + total from a currency and the 12-week
// discount that applies to the buyer. The cert price is taken straight from the
// certification offer; the 12-week price is the regional price with the discount.
export function buildCertificationPathPricing(
  currency: Currency,
  eff: EffectiveDiscount,
  nowMs: number = Date.now(),
): CertificationPathPricing {
  const baseCert = getCertOffer(currency);
  // The cert line takes the launch promo (50% off its list/base price), pausing
  // its mid-cohort discount — UNLESS a hand-crafted ?discount=N override is in
  // play, which wins outright and only ever touches the 12-week line.
  const certPromo = eff.kind !== 'override' && launchPromoActive(nowMs);
  const cert = certPromo ? applyLaunchPromoToOffer(baseCert, nowMs) : baseCert;
  const certBase = baseCert.base_price * 100; // sticker (e.g. €1500), shown struck
  const twBase = priceCents(currency);
  const twBaseMonthly = monthlyCents(currency);
  const twPrice = applyPercentCents(twBase, eff.percent);
  const twMonthly = applyPercentCents(twBaseMonthly, eff.percent);
  const certMonthly = cert.installments?.monthly_cents ?? 0;
  // The struck "before" monthly is always the FULL cert monthly (not the promo
  // one), so the path's monthly list price reads honestly. Equals certMonthly
  // when the promo isn't active.
  const certBaseMonthly = baseCert.installments?.monthly_cents ?? 0;
  return {
    currency,
    twelve_week_base_cents: twBase,
    twelve_week_price_cents: twPrice,
    twelve_week_base_monthly_cents: twBaseMonthly,
    twelve_week_monthly_cents: twMonthly,
    cert_base_price_cents: certBase,
    cert_price_cents: cert.price_cents,
    cert_monthly_cents: certMonthly,
    total_cents: cert.price_cents + twPrice,
    total_monthly_cents: certMonthly + twMonthly,
    // List total: cert sticker + full 12-week. The charged total still applies
    // the cert mid-cohort discount and the 12-week workshop discount.
    base_total_cents: certBase + twBase,
    base_total_monthly_cents: certBaseMonthly + twBaseMonthly,
    installment_count: INSTALLMENT_COUNT,
    discount: {
      eligible: eff.eligible,
      percent: eff.percent,
      kind: eff.kind,
      expires_at_ms: eff.expiresAtMs,
    },
  };
}

// Re-derive the 12-week discount for an email the same way everywhere: the
// workshop window (incl. replay-view anchors), with a `?discount=N` override
// (1–99) winning outright. Shared so status + checkout never disagree.
export async function deriveTwelveWeekDiscount(
  db: D1Database,
  email: string,
  overridePercent: number,
): Promise<EffectiveDiscount> {
  const links = await listSecuredWorkshopLinksByEmail(db, email);
  const replayAnchors = await listReplayViewAnchorsByEmail(db, email);
  const workshopStatus = bestDiscountStatus(
    [
      ...links.map((l) => anchorMsFromWorkshop(l.starts_at_utc, l.ends_at_utc)),
      ...replayAnchors,
    ],
    Date.now(),
  );
  return effectiveTwelveWeekDiscount(workshopStatus, overridePercent);
}
