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

import {
  getCertOffer,
  applyLaunchPromoToOffer,
  type Currency,
  type Offer,
  type InstallmentPlan,
} from './variant';
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

// The German 12-week graduate cross-sell (buyers tagged prodG_SVH_12w in Drip —
// see variant.ts, variant G). They've completed the German edition of the
// 12-week course, so on the cert page the certification is offered at the
// standard workshop-sale 20%, and the path pairs it with the ENGLISH 12-week
// course at a deep graduate discount. Verified server-side from the Drip tag in
// both the status endpoint (display) and the checkout (charge), so the price
// can't be spoofed.
export const GERMAN_CERT_DISCOUNT_PERCENT = CERT_PATH_DISCOUNT_PERCENT; // 20% off the cert line
export const GERMAN_TWELVE_WEEK_DISCOUNT_PERCENT = 75; // 75% off the English 12-week line

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
    // 'german' = the German-12-week-graduate cross-sell (cert 20% + English
    // 12-week 75%); it has no expiry, so no countdown ever clears it.
    kind: DiscountKind | 'override' | 'german';
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
// path (both lines) takes CERT_PATH_DISCOUNT_PERCENT off, and a URL override
// takes its own percent off both lines the same way; the launch promo keeps
// its own shape (see below).
export function buildCertificationPathPricing(
  currency: Currency,
  eff: EffectiveDiscount,
  nowMs: number = Date.now(),
): CertificationPathPricing {
  const baseCert = getCertOffer(currency);
  // A hand-crafted ?discount=N / ?adiscount=N override wins outright, so the
  // launch promo steps aside for it.
  const override = eff.kind === 'override';
  const certPromo = !override && launchPromoActive(nowMs);
  const cert = certPromo ? applyLaunchPromoToOffer(baseCert, nowMs) : baseCert;
  // The workshop sale: eff.kind 'pre'/'post' means the buyer's workshop window
  // is live — the path takes 20% off BOTH lines (the promo path above wins
  // while a site-wide promo runs; effectiveTwelveWeekDiscount already resolves
  // promo-vs-workshop upstream).
  const workshopSale = !certPromo && (eff.kind === 'pre' || eff.kind === 'post');
  // An override is an intentional, hand-made price for THIS buyer, so it takes
  // its percent off the WHOLE path — both lines — the same way the workshop
  // sale does (owner's call, Sept 2026; it used to touch the 12-week line
  // only, which made a 50% link read as ~20% off the path and looked broken).
  // A site-wide promo keeps the old shape: its percent is already in the cert
  // line via applyLaunchPromoToOffer, so eff.percent lands on 12-week only.
  const twPercent = workshopSale ? CERT_PATH_DISCOUNT_PERCENT : eff.percent;
  const certPercent = workshopSale
    ? CERT_PATH_DISCOUNT_PERCENT
    : override
      ? eff.percent
      : 0;
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

// The certification offer, discounted 20% for a German 12-week graduate. The
// list price stays as base_price (shown struck on the card); price + every
// installment ladder are floored to clean prices with the SAME pctMajor rule
// the path's cert line uses, so the cert-only card and the path's cert row
// always agree on the number (EUR: €797 → €635). Shared by subscriber-status
// (display) and the checkout (charge).
export function germanCertOffer(currency: Currency): Offer {
  const base = getCertOffer(currency);
  const disc = (cents: number) => pctMajor(cents, GERMAN_CERT_DISCOUNT_PERCENT);
  const ladder = (p?: InstallmentPlan): InstallmentPlan | undefined => {
    if (!p) return undefined;
    const monthly_cents = disc(p.monthly_cents);
    return {
      currency: p.currency,
      monthly: monthly_cents / 100,
      monthly_cents,
      count: p.count,
      total: (monthly_cents * p.count) / 100,
      total_cents: monthly_cents * p.count,
    };
  };
  const certPriceCents = disc(base.price_cents);
  return {
    ...base,
    price: certPriceCents / 100,
    price_cents: certPriceCents,
    // base_price stays the list price so the card strikes it through.
    save_note: 'Graduate of the German 12-week course — 20% off, self-paced',
    installments: ladder(base.installments),
    installments_6x: ladder(base.installments_6x),
    installments_12x: ladder(base.installments_12x),
  };
}

// The certification path for a German 12-week graduate: the ENGLISH 12-week
// course at GERMAN_TWELVE_WEEK_DISCOUNT_PERCENT off, paired with the cert at
// GERMAN_CERT_DISCOUNT_PERCENT off. Same shape + flooring as
// buildCertificationPathPricing, so the on-page breakdown and the charge match;
// no workshop window is consulted (the discount is the graduate offer itself,
// so kind is 'german' with no expiry / countdown). The cert line here equals
// germanCertOffer's price by construction (both pctMajor(cert, 20%)).
export function buildGermanCertificationPathPricing(
  currency: Currency,
): CertificationPathPricing {
  const baseCert = getCertOffer(currency);
  const certBase = baseCert.base_price * 100;
  const twBase = priceCents(currency);
  const twBaseMonthly = monthlyCents(currency);
  const twBaseMonthly6x = monthlyCents6x(currency);
  const certBaseMonthly = baseCert.installments?.monthly_cents ?? 0;
  const certBaseMonthly6x = baseCert.installments_6x?.monthly_cents ?? 0;

  const twPrice = pctMajor(twBase, GERMAN_TWELVE_WEEK_DISCOUNT_PERCENT);
  const twMonthly = pctMajor(twBaseMonthly, GERMAN_TWELVE_WEEK_DISCOUNT_PERCENT);
  const twMonthly6x = pctMajor(twBaseMonthly6x, GERMAN_TWELVE_WEEK_DISCOUNT_PERCENT);
  const certPrice = pctMajor(baseCert.price_cents, GERMAN_CERT_DISCOUNT_PERCENT);
  const certMonthly = pctMajor(certBaseMonthly, GERMAN_CERT_DISCOUNT_PERCENT);
  const certMonthly6x = pctMajor(certBaseMonthly6x, GERMAN_CERT_DISCOUNT_PERCENT);

  // Blended percent off the combined list total — for the receipt/metadata
  // audit only (each line carries its own percent on the page).
  const blended = Math.round(
    (1 - (certPrice + twPrice) / (certBase + twBase)) * 100,
  );

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
    base_total_cents: certBase + twBase,
    base_total_monthly_cents: certBaseMonthly + twBaseMonthly,
    installment_count: INSTALLMENT_COUNT,
    total_monthly_6x_cents: certMonthly6x + twMonthly6x,
    base_total_monthly_6x_cents: certBaseMonthly6x + twBaseMonthly6x,
    installment_6x_count: INSTALLMENT_COUNT_6X,
    discount: {
      eligible: true,
      percent: blended,
      kind: 'german',
      expires_at_ms: null,
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
