// The "Certification path" = the 12-Week Course + the Certification Course,
// presented (and sold) as two transparent line items with one combined total.
//
//   - The workshop sale: when the buyer's email sits in a live workshop window
//     (same pre/post-48h rule as the standalone 12-week course), the WHOLE
//     path is 20% off — both line items (CERT_PATH_DISCOUNT_PERCENT below).
//     The standalone 12-week course keeps its own 20%.
//   - No workshop link → both lines at their normal price.
//   - A `?discount=N` override still wins outright and, as before, only ever
//     touches the 12-week line.
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
  monthlyCents6x,
  applyPercentCents,
  bestDiscountStatus,
  anchorMsFromWorkshop,
  effectiveTwelveWeekDiscount,
  INSTALLMENT_COUNT,
  INSTALLMENT_COUNT_6X,
  type DiscountKind,
  type EffectiveDiscount,
} from './twelve-week';
import {
  listSecuredWorkshopLinksByEmail,
  listReplayViewAnchorsByEmail,
} from '../workshops/db';

// The workshop-sale discount on the certification path: 20% off the whole
// path (both line items) while the buyer's workshop window is live. Twin
// of the standalone 12-week course's 20% (DISCOUNT_PERCENT in twelve-week.ts),
// so the lifecycle emails can quote a single "20%" for both offers.
export const CERT_PATH_DISCOUNT_PERCENT = 20;

export type CertificationPathPricing = {
  currency: Currency;
  // 12-week line (workshop-discounted)
  twelve_week_base_cents: number;
  twelve_week_price_cents: number;
  twelve_week_base_monthly_cents: number;
  twelve_week_monthly_cents: number;
  // certification line (workshop-discounted on the path)
  cert_base_price_cents: number;
  cert_price_cents: number;
  cert_monthly_cents: number;
  // combined
  total_cents: number;
  total_monthly_cents: number;
  base_total_cents: number; // pre-discount total (cert sticker + full 12-week)
  base_total_monthly_cents: number;
  installment_count: number;
  // 6-month installment tier (longer term, a slightly higher total than 3×)
  total_monthly_6x_cents: number;
  base_total_monthly_6x_cents: number;
  installment_6x_count: number;
  discount: {
    eligible: boolean;
    percent: number;
    kind: DiscountKind | 'override';
    expires_at_ms: number | null;
  };
};

// Apply a percent off a cents amount. A discounted figure is floored to the
// nearest 5 major units (…500 cents), so every sale line item, monthly and
// total reads as a round price (EUR at 20%: cert 797 → 635, 12-week 550 → 440,
// path 1347 → 1075) — flooring, never rounding up, so the advertised percent
// is always honoured or slightly bettered. Undiscounted amounts just normalize
// to a whole major unit (identity for the price tables, which are already
// multiples of 5).
function pctMajor(cents: number, percent: number): number {
  if (percent <= 0) return Math.round(cents / 100) * 100;
  return Math.floor(applyPercentCents(cents, percent) / 500) * 500;
}

// Compose the path's two line items + total from a currency and the 12-week
// discount that applies to the buyer. During a live workshop window the whole
// path (both lines) takes CERT_PATH_DISCOUNT_PERCENT off; a URL override or
// the launch promo keep their existing shapes (see below).
export function buildCertificationPathPricing(
  currency: Currency,
  eff: EffectiveDiscount,
  nowMs: number = Date.now(),
): CertificationPathPricing {
  const baseCert = getCertOffer(currency);
  // The cert line takes the launch promo (50% off its list/base price) when a
  // promo is live — UNLESS a hand-crafted ?discount=N override is in play,
  // which wins outright and only ever touches the 12-week line.
  const certPromo = eff.kind !== 'override' && launchPromoActive(nowMs);
  const cert = certPromo ? applyLaunchPromoToOffer(baseCert, nowMs) : baseCert;
  // The workshop sale: eff.kind 'pre'/'post' means the buyer's workshop window
  // is live — the path takes 20% off BOTH lines (the promo path above wins
  // while a site-wide promo runs; effectiveTwelveWeekDiscount already resolves
  // promo-vs-workshop upstream). Override/promo keep the old shape: the
  // percent lands on the 12-week line only.
  const workshopSale = !certPromo && (eff.kind === 'pre' || eff.kind === 'post');
  const twPercent = workshopSale ? CERT_PATH_DISCOUNT_PERCENT : eff.percent;
  const certPercent = workshopSale ? CERT_PATH_DISCOUNT_PERCENT : 0;
  const certBase = baseCert.base_price * 100; // normal price, shown struck while discounted
  const twBase = priceCents(currency);
  const twBaseMonthly = monthlyCents(currency);
  const twPrice = pctMajor(twBase, twPercent);
  const twMonthly = pctMajor(twBaseMonthly, twPercent);
  const certPrice = pctMajor(cert.price_cents, certPercent);
  const certMonthly = pctMajor(cert.installments?.monthly_cents ?? 0, certPercent);
  // The struck "before" monthly is always the FULL cert monthly (not the
  // discounted one), so the path's monthly list price reads honestly. Equals
  // certMonthly when no discount is live.
  const certBaseMonthly = baseCert.installments?.monthly_cents ?? 0;
  // Same composition for the 6-month tier: cert's 6-month ladder (discounted
  // the same way) + the discounted 12-week 6-month monthly. The struck
  // "before" is the full cert 6-month monthly + the full 12-week 6-month one.
  const certMonthly6x = pctMajor(cert.installments_6x?.monthly_cents ?? 0, certPercent);
  const certBaseMonthly6x = baseCert.installments_6x?.monthly_cents ?? 0;
  const twBaseMonthly6x = monthlyCents6x(currency);
  const twMonthly6x = pctMajor(twBaseMonthly6x, twPercent);
  return {
    currency,
    twelve_week_base_cents: twBase,
    twelve_week_price_cents: twPrice,
    twelve_week_base_monthly_cents: twBaseMonthly,
    twelve_week_monthly_cents: twMonthly,
    cert_base_price_cents: certBase,
    cert_price_cents: certPrice,
    cert_monthly_cents: certMonthly,
    total_cents: certPrice + twPrice,
    total_monthly_cents: certMonthly + twMonthly,
    // List total: normal cert + full 12-week, shown struck while a discount
    // (workshop sale / promo / override) reduces the charged total.
    base_total_cents: certBase + twBase,
    base_total_monthly_cents: certBaseMonthly + twBaseMonthly,
    installment_count: INSTALLMENT_COUNT,
    total_monthly_6x_cents: certMonthly6x + twMonthly6x,
    base_total_monthly_6x_cents: certBaseMonthly6x + twBaseMonthly6x,
    installment_6x_count: INSTALLMENT_COUNT_6X,
    discount: {
      eligible: eff.eligible,
      // The percent the path actually applies — 20 during the workshop
      // window, the override/promo percent otherwise.
      percent: eff.eligible ? (workshopSale ? CERT_PATH_DISCOUNT_PERCENT : eff.percent) : 0,
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
