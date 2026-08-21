// Statistics + ROAS for the workshop engine, plus standalone course sales.
//
// All money is reported in EUR minor units. The EUR conversion mirrors the
// legacy stats: gross EUR = the Stripe settlement amount (payout currency),
// and net-of-tax EUR = subtotal * (settlement / amount). Per-payment totals
// are split across ticket / masterclass / bump / course using the purchases
// line-item shares. Masterclass tickets are classified by the product slug
// (`svh-masterclass`) and split out of the regular ticket bucket.
//
// Standalone course sales (12-week, certification, grief) live in
// `course_registrations`, which has no Stripe settlement or tax data. By
// default those figures are the charged amount at fallback FX rates (gross of
// any VAT). Callers that pass a `MoneyOpts` (see resolveMoneyOpts) get the
// true figure instead: VAT stripped per buyer country via Quaderno — the same
// treatment /admin/courses/future-revenue applies — and EUR conversion at the
// live `fx_rates` table. Attributed to the day of `paid_at` either way.

import { FX_TO_EUR } from './currency';
import { selectByIdsChunked } from '../db/chunked';
import { isAcquisitionCampaign, campaignKind, type CampaignKind } from '../ads/campaigns';
import { allocateSpendByDay } from '../ads/allocation';
import { getTaxRate, netFromGross, type QuadernoTaxConfig } from './quaderno';
import { getFxRatesToEur } from '../admin/fx';
import { parsePurchasedBumps } from '../courses/db';
import { BUMPS, isBumpSlug } from '../courses/bumps';

export const MASTERCLASS_PRODUCT_SLUG = 'svh-masterclass';

// ---------------------------------------------------------------------------
// Money context for standalone course figures: live FX rates + a Quaderno tax
// config so charged (gross) amounts can be reported net of VAT in true EUR.
// Optional everywhere it's accepted — callers that don't pass it keep the old
// behaviour (fallback FX, gross of VAT), so nothing breaks where precision
// doesn't matter.

export type MoneyOpts = {
  fxRates?: Record<string, number>; // currency → EUR; falls back to FX_TO_EUR
  taxCfg?: QuadernoTaxConfig | null; // when set, VAT is stripped per country
};

export async function resolveMoneyOpts(
  db: D1Database,
  env: {
    QUADERNO_API_KEY?: string;
    QUADERNO_ACCOUNT?: string;
    QUADERNO_SANDBOX?: string;
  },
): Promise<MoneyOpts> {
  return {
    fxRates: await getFxRatesToEur(db),
    taxCfg:
      env.QUADERNO_API_KEY && env.QUADERNO_ACCOUNT
        ? {
            apiKey: env.QUADERNO_API_KEY,
            account: env.QUADERNO_ACCOUNT,
            sandbox: env.QUADERNO_SANDBOX === '1',
          }
        : null,
  };
}

// The country we charge eservice VAT against: the buyer's, or Belgium (home
// market) when it's an EUR charge with no country on file — the same
// convention /admin/orders uses (orders.ts eserviceCountry), so the two admin
// views agree on net figures.
function courseTaxCountry(
  country: string | null | undefined,
  currency: string | null | undefined,
): string | null {
  const c = (country ?? '').toUpperCase();
  if (c) return c;
  return (currency || 'EUR').toUpperCase() === 'EUR' ? 'BE' : null;
}

// Per-country VAT rates for a set of course rows (skipping B2B reverse-charge
// rows — a VAT number means 0%). getTaxRate caches per isolate, so repeated
// windows/pages re-resolve for free. No config → empty map → net = gross.
async function resolveCourseTaxRates(
  rows: Array<{ country?: string | null; vat_number?: string | null; currency?: string | null }>,
  taxCfg: QuadernoTaxConfig | null | undefined,
): Promise<Map<string, number>> {
  const rates = new Map<string, number>();
  if (!taxCfg) return rates;
  const countries = new Set<string>();
  for (const r of rows) {
    if (r.vat_number) continue;
    const c = courseTaxCountry(r.country, r.currency);
    if (c) countries.add(c);
  }
  await Promise.all(
    [...countries].map(async (c) => {
      rates.set(c, await getTaxRate(taxCfg, c, 'eservice'));
    }),
  );
  return rates;
}

// Collected gross (original currency) → net-of-VAT EUR minor units.
function courseNetEur(
  collectedMinor: number,
  row: { country?: string | null; vat_number?: string | null; currency?: string | null },
  taxRates: Map<string, number>,
  fxRates: Record<string, number> | undefined,
): { eurMinor: number; grossEurMinor: number } {
  const country = row.vat_number ? null : courseTaxCountry(row.country, row.currency);
  const rate = (country ? taxRates.get(country) : 0) ?? 0; // VAT number → reverse charge (0)
  const net = netFromGross(collectedMinor, rate).subtotalMinor;
  const cur = (row.currency || 'EUR').toUpperCase();
  const fx = fxRates?.[cur] ?? FX_TO_EUR[cur] ?? 1;
  return { eurMinor: Math.round(net * fx), grossEurMinor: Math.round(collectedMinor * fx) };
}

// What a course row actually collected, split across the lines it was charged
// on — and what a refund took back off each of them.
//
// `amount_cents` is the COURSE price only: order bumps (the €99 Authentic
// Singing Journey, the €49 Grief course) are charged alongside it as their own
// line — a Stripe line item on a pay-in-full checkout, the subscription setup
// fee on a plan — and recorded in the `bumps` JSON. So the money that actually
// left the buyer's card is course + bumps, and that is the base a refund is
// measured against.
//
// Two things follow, and both used to be wrong:
//
//   • A refund is allocated PRO-RATA across the lines it covered. Subtracting
//     it from the course line alone meant a full refund of a €550 course + €49
//     bump drove the course line to −€49, which `max(0, …)` then quietly
//     swallowed — while the bump line, counted from the JSON by a separate
//     query that never looked at refunds, still reported its full €49.
//   • A row whose entire charge came back is not a sale. It stays in the query
//     (its refund still has to be reported) but callers skip it, so a refunded
//     order no longer reads as "1 sale, €0".
//
// Installment plans bill monthly, so the course line is the plan total scaled
// by installments paid. (Scaling keys on installments_total, not
// payment_plan === '3x' — 6×/12× plans used to slip through and count their
// FULL plan value at first charge.) Bumps ride the first charge, so they count
// as collected as soon as any cycle has settled.

export type CourseCollected = {
  courseMinor: number; // collected on the course itself, after refunds
  bumpsMinor: number; // collected across the order bumps, after refunds
  bumps: Array<{ slug: string; label: string; amountMinor: number }>;
  chargedMinor: number; // course + bumps, before refunds
  refundedMinor: number; // clamped to what was actually charged
  fullyRefunded: boolean; // the whole charge came back — not a sale
};

type CourseCollectedInput = {
  installments_total: number;
  installments_paid: number;
  amount_cents: number;
  refunded_amount_cents: number | null;
  bumps?: string | null;
};

function bumpLabelOf(slug: string): string {
  return isBumpSlug(slug) ? BUMPS[slug].label : slug;
}

export function collectedSplitOf(r: CourseCollectedInput): CourseCollected {
  const courseCharged =
    r.installments_total > 1
      ? Math.round(r.amount_cents * (r.installments_paid / r.installments_total))
      : r.amount_cents;

  // Bumps are taken on the first charge, so they're collected once any cycle
  // has settled (a plan sitting at 0/N has taken nothing at all).
  const anyCycleSettled = r.installments_total <= 1 || r.installments_paid >= 1;
  const lines = anyCycleSettled ? parsePurchasedBumps(r.bumps) : [];
  const bumpsCharged = lines.reduce((sum, b) => sum + Math.max(0, b.amount_cents), 0);

  const chargedMinor = courseCharged + bumpsCharged;
  const refundedMinor = Math.min(
    Math.max(0, r.refunded_amount_cents ?? 0),
    Math.max(0, chargedMinor),
  );
  const fullyRefunded = refundedMinor > 0 && refundedMinor >= chargedMinor;

  // Pro-rata split of the refund. The course line takes its share; the bumps
  // absorb the rest, so the two always sum back to the refund exactly.
  const courseRefund =
    chargedMinor > 0 ? Math.round((refundedMinor * courseCharged) / chargedMinor) : 0;
  let bumpsRefundLeft = refundedMinor - courseRefund;

  const bumps: CourseCollected['bumps'] = [];
  let bumpsMinor = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const amount = Math.max(0, line.amount_cents);
    // Last line absorbs the rounding so the parts sum to the whole.
    const cut =
      i === lines.length - 1
        ? bumpsRefundLeft
        : bumpsCharged > 0
          ? Math.round((refundedMinor - courseRefund) * (amount / bumpsCharged))
          : 0;
    const taken = Math.min(amount, Math.max(0, cut));
    bumpsRefundLeft -= taken;
    const net = amount - taken;
    bumpsMinor += net;
    bumps.push({ slug: line.slug, label: bumpLabelOf(line.slug), amountMinor: net });
  }

  return {
    courseMinor: Math.max(0, courseCharged - courseRefund),
    bumpsMinor,
    bumps,
    chargedMinor,
    refundedMinor,
    fullyRefunded,
  };
}

type PaymentRow = {
  id: number;
  registration_id: number;
  status: string;
  amount_minor: number;
  refunded_amount_minor: number | null;
  currency: string;
  settlement_amount_minor: number | null;
  settlement_currency: string | null;
  fx_rate: number | null;
  subtotal_minor: number | null;
  tax_minor: number | null;
  created_at: string;
};

type PurchaseRow = {
  payment_id: number | null;
  product_type: string;
  product_id: number;
  amount_minor: number;
  slug: string | null;
};

export type StatsTotals = {
  grossEurMinor: number;
  netEurMinor: number; // tax-excluded, all product types (incl. masterclass)
  taxEurMinor: number;
  ticketNetEurMinor: number; // regular workshop tickets, masterclass excluded
  masterclassNetEurMinor: number;
  bumpNetEurMinor: number;
  courseNetEurMinor: number; // course add-ons sold through workshop checkout
  ticketCount: number;
  masterclassCount: number;
  bumpCount: number;
  courseCount: number;
  paidCount: number;
  flaggedNoTax: number; // rows where we fell back to net = gross
};

export type DailyStat = {
  date: string; // YYYY-MM-DD (UTC)
  grossEurMinor: number;
  netEurMinor: number;
  ticketNetEurMinor: number;
  masterclassNetEurMinor: number;
  bumpNetEurMinor: number;
  courseNetEurMinor: number;
  adSpendEurMinor: number; // all campaigns
  acquisitionAdSpendEurMinor: number; // prospecting (TOF) campaigns only
  roas: number | null;
};

export type StatsReport = {
  totals: StatsTotals;
  daily: DailyStat[];
  adSpendEurMinor: number; // all campaigns (drives blended ROAS)
  acquisitionAdSpendEurMinor: number; // prospecting (TOF) share
  retargetingAdSpendEurMinor: number; // everything else
  roas: number | null;
  courseBreakdown: Array<{ product_id: number; count: number; netEurMinor: number }>;
};

// The share of a workshop payment the buyer actually kept: 1 with no refund,
// 0 when it all came back, the remainder after a partial. `status = 'refunded'`
// now means *fully* refunded (migration 0082), so those rows are filtered out
// upstream anyway; this catches the partials, which stay 'paid'.
function collectedShareOf(p: { amount_minor: number; refunded_amount_minor: number | null }): number {
  const refunded = Math.max(0, p.refunded_amount_minor ?? 0);
  if (refunded <= 0) return 1;
  if (p.amount_minor <= 0) return 0;
  return Math.max(0, (p.amount_minor - refunded) / p.amount_minor);
}

// Gross EUR for a payment: prefer the EUR settlement; otherwise best-effort.
function grossEurMinor(p: PaymentRow): number {
  if (p.settlement_amount_minor != null && p.settlement_currency === 'EUR') {
    return p.settlement_amount_minor;
  }
  if (p.currency === 'EUR') return p.amount_minor;
  // Settlement in a non-EUR payout currency, or missing — fall back to the
  // charged amount. (Single-payout-currency accounts never hit this.)
  return p.settlement_amount_minor ?? p.amount_minor;
}

function netEurMinor(p: PaymentRow, grossEur: number): { net: number; flagged: boolean } {
  if (p.subtotal_minor != null && p.amount_minor > 0) {
    return { net: Math.round(p.subtotal_minor * (grossEur / p.amount_minor)), flagged: false };
  }
  return { net: grossEur, flagged: true };
}

export async function computeStats(
  db: D1Database,
  opts: { from?: string | null; to?: string | null; workshopId?: number | null } = {},
): Promise<StatsReport> {
  const where: string[] = ["p.status = 'paid'"];
  const binds: unknown[] = [];
  if (opts.from) {
    where.push('p.created_at >= ?');
    binds.push(opts.from);
  }
  if (opts.to) {
    where.push('p.created_at <= ?');
    binds.push(`${opts.to} 23:59:59`);
  }
  if (opts.workshopId) {
    where.push('r.workshop_id = ?');
    binds.push(opts.workshopId);
  }

  const pRes = await db
    .prepare(
      `SELECT p.* FROM workshop_payments p
         JOIN workshop_registrations r ON r.id = p.registration_id
        WHERE ${where.join(' AND ')}`,
    )
    .bind(...binds)
    .all<PaymentRow>();
  const payments = pRes.results ?? [];

  // Purchases for those payments (with product slug, to spot masterclass
  // tickets), grouped by payment_id.
  const byPayment = new Map<number, PurchaseRow[]>();
  if (payments.length) {
    // Chunked by payment_id to stay under D1's 100-bound-param cap — a busy
    // day/week can easily exceed 100 paid payments, which previously threw here
    // and silently killed the SD-REPORT digest.
    const ids = payments.map((p) => p.id);
    const purchaseRows = await selectByIdsChunked<PurchaseRow>(
      db,
      ids,
      (ph) =>
        `SELECT pur.payment_id, pur.product_type, pur.product_id, pur.amount_minor, prod.slug
           FROM workshop_purchases pur
           LEFT JOIN workshop_products prod ON prod.id = pur.product_id
          WHERE pur.payment_id IN (${ph})`,
    );
    for (const pur of purchaseRows) {
      if (pur.payment_id == null) continue;
      const arr = byPayment.get(pur.payment_id) ?? [];
      arr.push(pur);
      byPayment.set(pur.payment_id, arr);
    }
  }

  const totals: StatsTotals = {
    grossEurMinor: 0, netEurMinor: 0, taxEurMinor: 0,
    ticketNetEurMinor: 0, masterclassNetEurMinor: 0, bumpNetEurMinor: 0, courseNetEurMinor: 0,
    ticketCount: 0, masterclassCount: 0, bumpCount: 0, courseCount: 0,
    paidCount: 0, flaggedNoTax: 0,
  };
  type DayAcc = { gross: number; net: number; ticket: number; masterclass: number; bump: number; course: number };
  const dailyMap = new Map<string, DayAcc>();
  const courseMap = new Map<number, { count: number; net: number }>();

  for (const p of payments) {
    // A partial refund takes back part of the charge, not all of it. Scale the
    // payment (and with it every line item below) by what the buyer actually
    // kept — before migration 0082 there was nowhere to record a partial, so
    // any refund flipped the row to 'refunded' and the WHERE above dropped the
    // whole charge, erasing €22 of ticket over a €5 refund.
    const kept = collectedShareOf(p);
    if (kept <= 0) continue; // fully refunded — not a sale
    const gross = Math.round(grossEurMinor(p) * kept);
    const { net, flagged } = netEurMinor(p, gross);
    totals.grossEurMinor += gross;
    totals.netEurMinor += net;
    totals.taxEurMinor += gross - net;
    totals.paidCount += 1;
    if (flagged) totals.flaggedNoTax += 1;

    const date = (p.created_at || '').slice(0, 10);
    const d = dailyMap.get(date) ?? { gross: 0, net: 0, ticket: 0, masterclass: 0, bump: 0, course: 0 };
    d.gross += gross;
    d.net += net;

    // Allocate the payment's net across its line items by charged-amount share.
    const lines = byPayment.get(p.id) ?? [];
    const lineTotal = lines.reduce((s, l) => s + l.amount_minor, 0) || p.amount_minor;
    for (const l of lines) {
      const share = lineTotal > 0 ? l.amount_minor / lineTotal : 0;
      const lineNet = Math.round(net * share);
      if (l.product_type === 'ticket') {
        if (l.slug === MASTERCLASS_PRODUCT_SLUG) {
          totals.masterclassNetEurMinor += lineNet;
          totals.masterclassCount += 1;
          d.masterclass += lineNet;
        } else {
          totals.ticketNetEurMinor += lineNet;
          totals.ticketCount += 1;
          d.ticket += lineNet;
        }
      } else if (l.product_type === 'bump') {
        totals.bumpNetEurMinor += lineNet;
        totals.bumpCount += 1;
        d.bump += lineNet;
      } else if (l.product_type === 'course') {
        totals.courseNetEurMinor += lineNet;
        totals.courseCount += 1;
        d.course += lineNet;
        const c = courseMap.get(l.product_id) ?? { count: 0, net: 0 };
        c.count += 1;
        c.net += lineNet;
        courseMap.set(l.product_id, c);
      }
    }
    dailyMap.set(date, d);
  }

  // Ad spend over the same window.
  const adWhere: string[] = [];
  const adBinds: unknown[] = [];
  if (opts.from) { adWhere.push('spend_date >= ?'); adBinds.push(opts.from); }
  if (opts.to) { adWhere.push('spend_date <= ?'); adBinds.push(opts.to); }
  const adRes = await db
    .prepare(
      `SELECT spend_date, campaign, amount_eur_minor, amount_minor, currency FROM workshop_ad_spend
        ${adWhere.length ? 'WHERE ' + adWhere.join(' AND ') : ''}`,
    )
    .bind(...adBinds)
    .all<{ spend_date: string; campaign: string; amount_eur_minor: number | null; amount_minor: number; currency: string }>();

  // Total spend drives blended ROAS; the acquisition (TOF/prospecting) share
  // drives cost per registration. Split both overall and per day.
  let adSpendEurMinor = 0;
  let acquisitionAdSpendEurMinor = 0;
  const adByDate = new Map<string, number>();
  const acqByDate = new Map<string, number>();
  for (const a of adRes.results ?? []) {
    const eur = a.amount_eur_minor ?? (a.currency === 'EUR' ? a.amount_minor : 0);
    adSpendEurMinor += eur;
    adByDate.set(a.spend_date, (adByDate.get(a.spend_date) ?? 0) + eur);
    if (isAcquisitionCampaign(a.campaign)) {
      acquisitionAdSpendEurMinor += eur;
      acqByDate.set(a.spend_date, (acqByDate.get(a.spend_date) ?? 0) + eur);
    }
  }

  // Daily table merges revenue + ad spend dates.
  const allDates = new Set<string>([...dailyMap.keys(), ...adByDate.keys()]);
  const daily: DailyStat[] = [...allDates]
    .sort()
    .map((date) => {
      const rev = dailyMap.get(date) ?? { gross: 0, net: 0, ticket: 0, masterclass: 0, bump: 0, course: 0 };
      const spend = adByDate.get(date) ?? 0;
      return {
        date,
        grossEurMinor: rev.gross,
        netEurMinor: rev.net,
        ticketNetEurMinor: rev.ticket,
        masterclassNetEurMinor: rev.masterclass,
        bumpNetEurMinor: rev.bump,
        courseNetEurMinor: rev.course,
        adSpendEurMinor: spend,
        acquisitionAdSpendEurMinor: acqByDate.get(date) ?? 0,
        roas: spend > 0 ? rev.net / spend : null,
      };
    });

  return {
    totals,
    daily,
    adSpendEurMinor,
    acquisitionAdSpendEurMinor,
    retargetingAdSpendEurMinor: adSpendEurMinor - acquisitionAdSpendEurMinor,
    roas: adSpendEurMinor > 0 ? totals.netEurMinor / adSpendEurMinor : null,
    courseBreakdown: [...courseMap.entries()].map(([product_id, v]) => ({
      product_id,
      count: v.count,
      netEurMinor: v.net,
    })),
  };
}

// ---------------------------------------------------------------------------
// Standalone course sales (course_registrations): 12-week, certification,
// grief. Sold outside the workshop engine, so no settlement/tax data —
// figures are charged amounts (gross of VAT) at fallback FX rates.

export type CourseGroup = 'twelve_week' | 'certification' | 'other';

const COURSE_PRODUCT_INFO: Record<string, { group: CourseGroup; label: string }> = {
  'svh-12week': { group: 'twelve_week', label: '12-Week SVH Course' },
  'cc-cert': { group: 'certification', label: 'Certification — cert only' },
  'cc-bundle': { group: 'certification', label: 'Certification — Foundation + Cert bundle' },
  'grief-course': { group: 'other', label: 'The Grief Course' },
};

export type CourseDailyStat = {
  date: string; // YYYY-MM-DD (UTC, from paid_at)
  twelveWeekEurMinor: number;
  certificationEurMinor: number;
  otherEurMinor: number;
};

export type CourseSalesReport = {
  twelveWeek: { count: number; netEurMinor: number };
  certification: { count: number; netEurMinor: number };
  other: { count: number; netEurMinor: number };
  totalCount: number;
  totalNetEurMinor: number;
  byProduct: Array<{ slug: string; label: string; group: CourseGroup; count: number; netEurMinor: number }>;
  daily: CourseDailyStat[];
  // Order bumps taken on a course checkout (the €99 Authentic Singing Journey,
  // the €49 Grief course). Charged as their own line beside the course, so they
  // are NOT part of the figures above — and, like them, net of refunds.
  bumps: { count: number; eurMinor: number; byLabel: Array<{ label: string; count: number; eurMinor: number }> };
  // Orders in this window whose whole charge was refunded: skipped entirely
  // above (not a sale), surfaced here so the omission is visible.
  fullyRefundedCount: number;
  fxConverted: number; // rows converted to EUR (fallback table unless MoneyOpts gave live rates)
  taxApplied: boolean; // true when VAT was stripped per country (Quaderno configured)
  taxEurMinor: number; // estimated VAT removed from the figures, EUR
};

type CourseRegRow = {
  product_slug: string;
  amount_cents: number;
  currency: string;
  country: string | null;
  vat_number: string | null;
  payment_plan: string;
  installments_paid: number;
  installments_total: number;
  refunded_amount_cents: number;
  bumps: string | null;
  paid_at: string;
};

export async function computeCourseSales(
  db: D1Database,
  opts: { from?: string | null; to?: string | null; money?: MoneyOpts } = {},
): Promise<CourseSalesReport> {
  // Anything that ever collected money: paid, plus refunded/cancelled rows
  // (a cancelled 3x sub keeps the installments it already collected; the
  // refunded amount is subtracted below).
  const where: string[] = ['paid_at IS NOT NULL', "status NOT IN ('pending','expired')"];
  const binds: unknown[] = [];
  if (opts.from) { where.push('paid_at >= ?'); binds.push(opts.from); }
  if (opts.to) { where.push('paid_at <= ?'); binds.push(`${opts.to} 23:59:59`); }

  const res = await db
    .prepare(
      `SELECT product_slug, amount_cents, currency, country, vat_number, payment_plan,
              installments_paid, installments_total, refunded_amount_cents, bumps, paid_at
         FROM course_registrations
        WHERE ${where.join(' AND ')}`,
    )
    .bind(...binds)
    .all<CourseRegRow>();
  const regRows = res.results ?? [];
  const taxRates = await resolveCourseTaxRates(regRows, opts.money?.taxCfg);

  const report: CourseSalesReport = {
    twelveWeek: { count: 0, netEurMinor: 0 },
    certification: { count: 0, netEurMinor: 0 },
    other: { count: 0, netEurMinor: 0 },
    totalCount: 0,
    totalNetEurMinor: 0,
    byProduct: [],
    daily: [],
    bumps: { count: 0, eurMinor: 0, byLabel: [] },
    fullyRefundedCount: 0,
    fxConverted: 0,
    taxApplied: Boolean(opts.money?.taxCfg),
    taxEurMinor: 0,
  };
  const productMap = new Map<string, { count: number; net: number }>();
  const dailyMap = new Map<string, { tw: number; cert: number; other: number }>();
  const bumpMap = new Map<string, { count: number; eurMinor: number }>();

  for (const r of regRows) {
    const split = collectedSplitOf(r);

    // Every penny came back: it isn't a sale, and counting it as one (at €0)
    // is how a refunded order used to keep inflating the sale count. Its
    // refund is reported by computeRefunds, dated to the day it was given.
    if (split.fullyRefunded) {
      report.fullyRefundedCount += 1;
      continue;
    }

    const cur = (r.currency || 'EUR').toUpperCase();
    if (cur !== 'EUR') report.fxConverted += 1;
    const { eurMinor, grossEurMinor: rowGrossEur } = courseNetEur(
      split.courseMinor, r, taxRates, opts.money?.fxRates,
    );
    report.taxEurMinor += rowGrossEur - eurMinor;

    // Order bumps: same VAT netting and live FX as the course line they rode
    // in on, and carrying their share of any refund.
    for (const b of split.bumps) {
      const { eurMinor: bumpEur, grossEurMinor: bumpGross } = courseNetEur(
        b.amountMinor, r, taxRates, opts.money?.fxRates,
      );
      report.taxEurMinor += bumpGross - bumpEur;
      const e = bumpMap.get(b.label) ?? { count: 0, eurMinor: 0 };
      e.count += 1;
      e.eurMinor += bumpEur;
      bumpMap.set(b.label, e);
      report.bumps.count += 1;
      report.bumps.eurMinor += bumpEur;
    }

    const info = COURSE_PRODUCT_INFO[r.product_slug] ?? { group: 'other' as const, label: r.product_slug };
    const bucket =
      info.group === 'twelve_week' ? report.twelveWeek :
      info.group === 'certification' ? report.certification : report.other;
    bucket.count += 1;
    bucket.netEurMinor += eurMinor;
    report.totalCount += 1;
    report.totalNetEurMinor += eurMinor;

    const p = productMap.get(r.product_slug) ?? { count: 0, net: 0 };
    p.count += 1;
    p.net += eurMinor;
    productMap.set(r.product_slug, p);

    const date = (r.paid_at || '').slice(0, 10);
    const d = dailyMap.get(date) ?? { tw: 0, cert: 0, other: 0 };
    if (info.group === 'twelve_week') d.tw += eurMinor;
    else if (info.group === 'certification') d.cert += eurMinor;
    else d.other += eurMinor;
    dailyMap.set(date, d);
  }

  report.byProduct = [...productMap.entries()]
    .map(([slug, v]) => {
      const info = COURSE_PRODUCT_INFO[slug] ?? { group: 'other' as const, label: slug };
      return { slug, label: info.label, group: info.group, count: v.count, netEurMinor: v.net };
    })
    .sort((a, b) => b.netEurMinor - a.netEurMinor);

  report.daily = [...dailyMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({
      date,
      twelveWeekEurMinor: v.tw,
      certificationEurMinor: v.cert,
      otherEurMinor: v.other,
    }));

  report.bumps.byLabel = [...bumpMap.entries()]
    .map(([label, v]) => ({ label, count: v.count, eurMinor: v.eurMinor }))
    .sort((a, b) => b.eurMinor - a.eurMinor);

  return report;
}

// ---------------------------------------------------------------------------
// Refunds, dated by the day the money went BACK.
//
// Every revenue figure on this page is dated by the sale (`paid_at` for a
// course, the payment date for a workshop) and carries its refunds netted off.
// That is the right way to read a product's performance — a refunded sale
// should not look like a good one — but it leaves a blind spot, and with a
// 30-day money-back guarantee it is not a small one: a refund is usually given
// in a LATER month than the sale. So it silently rewrites the month it was sold
// in, and never appears in the month it was actually paid out. "How much did we
// give back in August" had no answer anywhere.
//
// This is that answer, and it is deliberately reported SEPARATELY rather than
// folded into the revenue total — netting it there would double-count the part
// already deducted from an in-window sale. The split says which is which:
//
//   • againstWindowSalesEurMinor — the sale is in this window too, so the
//     revenue figures above have already had this taken off.
//   • againstEarlierSalesEurMinor — the sale predates the window. NOT in any
//     figure above; this is money that left in this window and was invisible.
//
// Caveat, worth knowing when reading a day: `refunded_at` is stamped on the
// FIRST refund and the row carries one running total, so a refund given in two
// parts months apart is dated wholly to the first. Partial refunds are rare and
// second ones rarer; the total is always right, only its placement on a day can
// be early. Retreats are excluded because retreat revenue isn't in these
// figures in the first place.

export type RefundsReport = {
  count: number; // orders refunded in the window
  eurMinor: number; // total given back, net of VAT, EUR
  againstWindowSalesEurMinor: number; // already deducted from the revenue above
  againstEarlierSalesEurMinor: number; // not reflected in it at all
  courseEurMinor: number;
  workshopEurMinor: number;
  byLabel: Array<{ label: string; count: number; eurMinor: number }>;
  daily: Array<{ date: string; eurMinor: number }>;
};

const WORKSHOP_REFUND_LABEL = 'Workshop & masterclass tickets';

export async function computeRefunds(
  db: D1Database,
  opts: { from?: string | null; to?: string | null; money?: MoneyOpts } = {},
): Promise<RefundsReport> {
  const from = opts.from ?? null;
  const to = opts.to ?? null;
  const bounded = Boolean(from || to);
  // Was the SALE inside the window too? Unbounded window → everything is.
  const soldInWindow = (saleDate: string | null | undefined): boolean => {
    if (!bounded) return true;
    const d = (saleDate ?? '').slice(0, 10);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };

  const win = (col: string, binds: unknown[]): string => {
    const parts: string[] = [];
    if (from) { parts.push(`${col} >= ?`); binds.push(from); }
    if (to) { parts.push(`${col} <= ?`); binds.push(`${to} 23:59:59`); }
    return parts.length ? ' AND ' + parts.join(' AND ') : '';
  };

  const report: RefundsReport = {
    count: 0,
    eurMinor: 0,
    againstWindowSalesEurMinor: 0,
    againstEarlierSalesEurMinor: 0,
    courseEurMinor: 0,
    workshopEurMinor: 0,
    byLabel: [],
    daily: [],
  };
  const labelMap = new Map<string, { count: number; eurMinor: number }>();
  const dailyMap = new Map<string, number>();
  const add = (label: string, date: string, eurMinor: number, saleDate: string | null) => {
    report.count += 1;
    report.eurMinor += eurMinor;
    if (soldInWindow(saleDate)) report.againstWindowSalesEurMinor += eurMinor;
    else report.againstEarlierSalesEurMinor += eurMinor;
    const l = labelMap.get(label) ?? { count: 0, eurMinor: 0 };
    l.count += 1;
    l.eurMinor += eurMinor;
    labelMap.set(label, l);
    if (date) dailyMap.set(date, (dailyMap.get(date) ?? 0) + eurMinor);
  };

  // ── Courses (course_registrations: 12-week, certification, grief, albums).
  const crsBinds: unknown[] = [];
  const crsRes = await db
    .prepare(
      `SELECT product_slug, currency, country, vat_number, refunded_amount_cents,
              substr(refunded_at, 1, 10) AS refund_date, paid_at
         FROM course_registrations
        WHERE refunded_at IS NOT NULL
          AND refunded_amount_cents > 0${win('refunded_at', crsBinds)}`,
    )
    .bind(...crsBinds)
    .all<{
      product_slug: string; currency: string; country: string | null;
      vat_number: string | null; refunded_amount_cents: number;
      refund_date: string; paid_at: string | null;
    }>();
  const crsRows = crsRes.results ?? [];
  const taxRates = await resolveCourseTaxRates(crsRows, opts.money?.taxCfg);
  for (const r of crsRows) {
    const { eurMinor } = courseNetEur(
      r.refunded_amount_cents, r, taxRates, opts.money?.fxRates,
    );
    const label =
      COURSE_PRODUCT_INFO[r.product_slug]?.label ?? r.product_slug;
    report.courseEurMinor += eurMinor;
    add(label, r.refund_date, eurMinor, r.paid_at);
  }

  // ── Workshops (workshop_payments). The refunded share of the charge, run
  //    through the same settlement/VAT conversion the revenue figures use.
  const wBinds: unknown[] = [];
  const wRes = await db
    .prepare(
      `SELECT p.amount_minor, p.refunded_amount_minor, p.currency,
              p.settlement_amount_minor, p.settlement_currency, p.subtotal_minor,
              substr(p.refunded_at, 1, 10) AS refund_date, p.created_at
         FROM workshop_payments p
        WHERE p.refunded_at IS NOT NULL
          AND p.refunded_amount_minor > 0${win('p.refunded_at', wBinds)}`,
    )
    .bind(...wBinds)
    .all<{
      amount_minor: number; refunded_amount_minor: number; currency: string;
      settlement_amount_minor: number | null; settlement_currency: string | null;
      subtotal_minor: number | null; refund_date: string; created_at: string;
    }>();
  for (const p of wRes.results ?? []) {
    if (p.amount_minor <= 0) continue;
    const share = Math.min(1, p.refunded_amount_minor / p.amount_minor);
    const slim = p as unknown as PaymentRow;
    const gross = Math.round(grossEurMinor(slim) * share);
    const { net } = netEurMinor(slim, gross);
    report.workshopEurMinor += net;
    add(WORKSHOP_REFUND_LABEL, p.refund_date, net, p.created_at);
  }

  report.byLabel = [...labelMap.entries()]
    .map(([label, v]) => ({ label, count: v.count, eurMinor: v.eurMinor }))
    .sort((a, b) => b.eurMinor - a.eurMinor);
  report.daily = [...dailyMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, eurMinor]) => ({ date, eurMinor }));

  return report;
}

// ---------------------------------------------------------------------------
// Per-workshop performance: the registration → attendance → course-purchase
// funnel, one row per workshop. Course/cert purchases are attributed by email
// (engine add-ons through any workshop checkout, plus standalone
// course_registrations), so a buyer who registered for several workshops
// counts toward each of them.

export type WorkshopPerformanceRow = {
  workshopId: number;
  title: string;
  startsAtUtc: string;
  isReplay: boolean;
  status: string;
  registrations: number; // paid or coupon
  attendedLive: number;
  replayViews: number;
  noShows: number;
  attendancePct: number | null;
  bumpBuys: number;
  courseBuys: number; // 12-week (engine add-on + standalone, distinct emails)
  certBuys: number; // certification path (engine cert add-on + standalone cc-*)
  engineNetEurMinor: number; // tickets + bumps + add-ons through this workshop
  attributedCourseEurMinor: number; // standalone 12-week/cert revenue by registrant email
  totalEurMinor: number;
  // Ad spend charged to this workshop, allocated day by day: each of its
  // registrations carries the cost of a registration on the day it came in
  // (that day's spend ÷ that day's registrations). See lib/ads/allocation.ts.
  metaCostEurMinor: number | null; // all campaigns
  roas: number | null; // total revenue ÷ Meta cost (blended, all campaigns)
  // Workshop-only economics: the prospecting (TOF) spend this workshop's
  // registrations actually pulled, day by day, and revenue ÷ that cost. This is
  // the acquisition-true ROAS — income from a workshop's registrants against
  // the spend that bought those registrations on the days they registered.
  acquisitionCostEurMinor: number | null;
  workshopRoas: number | null;
  // This workshop's own cost per registration (its TOF cost ÷ its
  // registrations) — the day-weighted price of a seat here, which differs from
  // the window average when its registrations landed on cheaper/dearer days.
  costPerRegistrationEurMinor: number | null;
  conversionPct: number | null; // distinct course/cert buyers ÷ registrations
  conversionPerAttendeePct: number | null; // distinct course/cert buyers ÷ attendees (live + replay)
};

// One day of the acquisition ledger: what was spent, how many registrations it
// bought, and therefore what a registration cost that day. This per-day price
// is what each workshop's cost is built from (lib/ads/allocation.ts).
export type DailyAcquisitionCost = {
  date: string; // YYYY-MM-DD (UTC)
  registrations: number;
  adSpendEurMinor: number; // all campaigns
  acquisitionSpendEurMinor: number; // prospecting (TOF) campaigns
  // Prospecting spend ÷ registrations that day. null = spend but no
  // registrations (nothing to price); 0 = registrations that cost nothing.
  costPerRegistrationEurMinor: number | null;
};

export type WorkshopPerformanceReport = {
  rows: WorkshopPerformanceRow[];
  adSpendEurMinor: number; // all campaigns
  acquisitionSpendEurMinor: number; // prospecting (TOF) campaigns
  retargetingSpendEurMinor: number; // everything else
  totalRegistrations: number;
  // Cost per registration is charged against prospecting spend only — the
  // campaign that actually buys registrations. (Retargeting re-touches people
  // already in the funnel, so counting it would overstate acquisition cost.)
  // This window figure is the weighted average of the daily prices below —
  // total prospecting spend ÷ total registrations — which is exactly what the
  // per-workshop day-by-day costs sum back to.
  costPerRegistrationEurMinor: number | null;
  // The day-by-day ledger the per-workshop costs are built from.
  dailyCosts: DailyAcquisitionCost[];
  // Prospecting spend on days that produced no registration at all: it can't be
  // priced day-by-day, so it's spread evenly over the window's registrations.
  unattributedAcquisitionSpendEurMinor: number;
  // Workshop-only ROAS (weighted average): every euro of income that traces to
  // a workshop registrant — workshop-engine net (tickets + bumps + add-ons)
  // plus standalone 12-week/certification revenue from registrant emails,
  // counted ONCE across workshops (no per-workshop double count) — divided by
  // total prospecting (TOF) spend. This is "what the workshop funnel returns on
  // acquisition spend", distinct from the blended ROAS (all revenue ÷ all spend).
  workshopRevenueEurMinor: number;
  workshopRoas: number | null;
};

// Stored datetimes come in two shapes: ISO with "Z" (workshop times) and
// SQLite's "YYYY-MM-DD HH:MM:SS" (row timestamps, also UTC).
function parseUtcMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const ms = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? ms : null;
}

export async function computeWorkshopPerformance(
  db: D1Database,
  opts: { from?: string | null; to?: string | null; money?: MoneyOpts } = {},
): Promise<WorkshopPerformanceReport> {
  const winFrom = opts.from ?? null;
  const winTo = opts.to ? `${opts.to} 23:59:59` : null;
  const win = (col: string, binds: unknown[]): string => {
    const parts: string[] = [];
    if (winFrom) { parts.push(`${col} >= ?`); binds.push(winFrom); }
    if (winTo) { parts.push(`${col} <= ?`); binds.push(winTo); }
    return parts.length ? ' AND ' + parts.join(' AND ') : '';
  };

  const wRes = await db
    .prepare(
      `SELECT id, title, starts_at_utc, ends_at_utc, is_replay, status
         FROM workshops WHERE deleted = 0 ORDER BY starts_at_utc DESC`,
    )
    .all<{ id: number; title: string; starts_at_utc: string; ends_at_utc: string | null; is_replay: number; status: string }>();
  const workshopRows = wRes.results ?? [];

  // Completed registrations (paid or coupon) in the window. `reg_date` is the
  // UTC day the registration came in — the day whose ad spend bought it.
  const regBinds: unknown[] = [];
  const regRes = await db
    .prepare(
      `SELECT workshop_id, lower(email) AS email, attendance_status, joined_at_utc,
              substr(created_at, 1, 10) AS reg_date
         FROM workshop_registrations
        WHERE payment_status IN ('paid','coupon')${win('created_at', regBinds)}`,
    )
    .bind(...regBinds)
    .all<{
      workshop_id: number; email: string; attendance_status: string;
      joined_at_utc: string | null; reg_date: string;
    }>();

  // Bump purchases (paid) per workshop.
  const bumpBinds: unknown[] = [];
  const bumpRes = await db
    .prepare(
      `SELECT r.workshop_id, COUNT(DISTINCT pur.registration_id) AS n
         FROM workshop_purchases pur
         JOIN workshop_payments p ON p.id = pur.payment_id AND p.status = 'paid'
         JOIN workshop_registrations r ON r.id = pur.registration_id
        WHERE pur.product_type = 'bump'${win('p.created_at', bumpBinds)}
        GROUP BY r.workshop_id`,
    )
    .bind(...bumpBinds)
    .all<{ workshop_id: number; n: number }>();
  const bumpByWorkshop = new Map((bumpRes.results ?? []).map((b) => [b.workshop_id, b.n]));

  // Engine course add-on buyers (paid) with slug, per workshop.
  const addonBinds: unknown[] = [];
  const addonRes = await db
    .prepare(
      `SELECT r.workshop_id, lower(r.email) AS email, prod.slug AS slug
         FROM workshop_purchases pur
         JOIN workshop_payments p ON p.id = pur.payment_id AND p.status = 'paid'
         JOIN workshop_registrations r ON r.id = pur.registration_id
         JOIN workshop_products prod ON prod.id = pur.product_id
        WHERE pur.product_type = 'course'${win('p.created_at', addonBinds)}`,
    )
    .bind(...addonBinds)
    .all<{ workshop_id: number; email: string; slug: string }>();

  // Engine revenue (net EUR) per workshop.
  const payBinds: unknown[] = [];
  const payRes = await db
    .prepare(
      `SELECT r.workshop_id, p.amount_minor, p.refunded_amount_minor, p.currency,
              p.settlement_amount_minor, p.settlement_currency, p.subtotal_minor
         FROM workshop_payments p
         JOIN workshop_registrations r ON r.id = p.registration_id
        WHERE p.status = 'paid'${win('p.created_at', payBinds)}`,
    )
    .bind(...payBinds)
    .all<{
      workshop_id: number; amount_minor: number; refunded_amount_minor: number | null;
      currency: string;
      settlement_amount_minor: number | null; settlement_currency: string | null;
      subtotal_minor: number | null;
    }>();

  // Standalone course buyers by email: 12-week + certification path, with
  // collected EUR (installments paid only, refunds off, fallback FX). A wholly
  // refunded order isn't a purchase, so it doesn't make its registrant a buyer.
  const crsBinds: unknown[] = [];
  const crsRes = await db
    .prepare(
      `SELECT lower(email) AS email, product_slug, amount_cents, currency, country,
              vat_number, payment_plan, installments_paid, installments_total,
              refunded_amount_cents, bumps
         FROM course_registrations
        WHERE paid_at IS NOT NULL AND status NOT IN ('pending','expired')${win('paid_at', crsBinds)}`,
    )
    .bind(...crsBinds)
    .all<CourseRegRow & { email: string }>();
  const crsRows = crsRes.results ?? [];
  const crsTaxRates = await resolveCourseTaxRates(crsRows, opts.money?.taxCfg);
  const standalone = new Map<string, { tw: boolean; cert: boolean; eurMinor: number }>();
  for (const r of crsRows) {
    const isTw = r.product_slug === 'svh-12week';
    const isCert = r.product_slug === 'cc-cert' || r.product_slug === 'cc-bundle';
    if (!isTw && !isCert) continue;
    const crsSplit = collectedSplitOf(r);
    if (crsSplit.fullyRefunded) continue;
    const { eurMinor } = courseNetEur(
      crsSplit.courseMinor, r, crsTaxRates, opts.money?.fxRates,
    );
    const s = standalone.get(r.email) ?? { tw: false, cert: false, eurMinor: 0 };
    if (isTw) s.tw = true;
    if (isCert) s.cert = true;
    s.eurMinor += eurMinor;
    standalone.set(r.email, s);
  }

  // Ad spend over the window, kept **per day** — the day is the unit the cost
  // of a registration is priced in. Total drives the per-workshop Meta-cost
  // allocation + blended ROAS; the acquisition (TOF/prospecting) share drives
  // cost per registration.
  const adBinds: unknown[] = [];
  const adWhere: string[] = [];
  if (opts.from) { adWhere.push('spend_date >= ?'); adBinds.push(opts.from); }
  if (opts.to) { adWhere.push('spend_date <= ?'); adBinds.push(opts.to); }
  const adRes = await db
    .prepare(
      `SELECT spend_date, campaign, amount_eur_minor, amount_minor, currency FROM workshop_ad_spend
        ${adWhere.length ? 'WHERE ' + adWhere.join(' AND ') : ''}`,
    )
    .bind(...adBinds)
    .all<{ spend_date: string; campaign: string; amount_eur_minor: number | null; amount_minor: number; currency: string }>();
  let adSpendEurMinor = 0;
  let acquisitionSpendEurMinor = 0;
  const adByDate = new Map<string, number>();
  const acqByDate = new Map<string, number>();
  for (const a of adRes.results ?? []) {
    const eur = a.amount_eur_minor ?? (a.currency === 'EUR' ? a.amount_minor : 0);
    adSpendEurMinor += eur;
    adByDate.set(a.spend_date, (adByDate.get(a.spend_date) ?? 0) + eur);
    if (isAcquisitionCampaign(a.campaign)) {
      acquisitionSpendEurMinor += eur;
      acqByDate.set(a.spend_date, (acqByDate.get(a.spend_date) ?? 0) + eur);
    }
  }

  // ---- Aggregate per workshop ----
  type Acc = {
    regs: number; emails: Set<string>;
    live: number; replay: number; noShow: number;
    engineTw: Set<string>; engineCert: Set<string>;
    netEurMinor: number;
  };
  const accs = new Map<number, Acc>();
  const acc = (id: number): Acc => {
    let a = accs.get(id);
    if (!a) {
      a = { regs: 0, emails: new Set(), live: 0, replay: 0, noShow: 0, engineTw: new Set(), engineCert: new Set(), netEurMinor: 0 };
      accs.set(id, a);
    }
    return a;
  };
  const endMsByWorkshop = new Map<number, { endMs: number | null; isReplay: boolean }>();
  for (const w of workshopRows) {
    const startMs = parseUtcMs(w.starts_at_utc);
    const endMs = parseUtcMs(w.ends_at_utc) ?? (startMs != null ? startMs + 3600_000 : null);
    endMsByWorkshop.set(w.id, { endMs, isReplay: w.is_replay === 1 });
  }

  // Every distinct email that completed a workshop registration in the window —
  // the denominator for "did this course buyer come through a workshop?", used
  // to count standalone course revenue once (not once per workshop attended).
  const allRegEmails = new Set<string>();
  // Registrations per day per workshop — the grid the daily ad-spend allocation
  // is charged against.
  const regsByDateWorkshop = new Map<string, Map<number, number>>();
  for (const r of regRes.results ?? []) {
    const a = acc(r.workshop_id);
    a.regs += 1;
    a.emails.add(r.email);
    allRegEmails.add(r.email);
    let perDay = regsByDateWorkshop.get(r.reg_date);
    if (!perDay) { perDay = new Map(); regsByDateWorkshop.set(r.reg_date, perDay); }
    perDay.set(r.workshop_id, (perDay.get(r.workshop_id) ?? 0) + 1);
    if (r.attendance_status === 'no_show') {
      a.noShow += 1;
    } else if (r.attendance_status === 'attended') {
      const w = endMsByWorkshop.get(r.workshop_id);
      const joinedMs = parseUtcMs(r.joined_at_utc);
      // Replay view: an on-demand workshop, or a join after the live slot
      // ended. Admin-marked attendance with no join time counts as live.
      const isReplayView = w?.isReplay || (joinedMs != null && w?.endMs != null && joinedMs > w.endMs);
      if (isReplayView) a.replay += 1;
      else a.live += 1;
    }
  }
  for (const c of addonRes.results ?? []) {
    const a = acc(c.workshop_id);
    if (c.slug === '12w-course') a.engineTw.add(c.email);
    if (c.slug === 'cert-course') a.engineCert.add(c.email);
  }
  for (const p of payRes.results ?? []) {
    const slim = p as unknown as PaymentRow;
    const kept = collectedShareOf(p); // partial refunds come off (migration 0082)
    if (kept <= 0) continue;
    const gross = Math.round(grossEurMinor(slim) * kept);
    acc(p.workshop_id).netEurMinor += netEurMinor(slim, gross).net;
  }

  const totalRegistrations = [...accs.values()].reduce((s, a) => s + a.regs, 0);
  // Window-wide cost per registration = prospecting (TOF) spend ÷
  // registrations. This is the weighted average of the daily prices below, and
  // the per-workshop day-by-day costs sum back to exactly this.
  const costPerRegistrationEurMinor =
    acquisitionSpendEurMinor > 0 && totalRegistrations > 0
      ? acquisitionSpendEurMinor / totalRegistrations
      : null;

  // Day-by-day allocation: every registration carries the price of a
  // registration on the day it came in (that day's spend ÷ that day's
  // registrations), and a workshop's cost is the sum of what its own
  // registrations cost. Run twice — once for prospecting spend (the TOF cost /
  // workshop ROAS) and once for total spend (the blended Meta cost / ROAS) — so
  // both columns still reconcile with their spend totals.
  const regsByWorkshop = new Map<number, number>([...accs].map(([id, a]) => [id, a.regs]));
  const acqAllocation = allocateSpendByDay(acqByDate, regsByDateWorkshop, regsByWorkshop);
  const totalAllocation = allocateSpendByDay(adByDate, regsByDateWorkshop, regsByWorkshop);

  // The daily ledger, over every day that saw spend or a registration.
  const costDates = [...new Set([...adByDate.keys(), ...acqByDate.keys(), ...regsByDateWorkshop.keys()])].sort();
  const dailyCosts: DailyAcquisitionCost[] = costDates.map((date) => {
    let registrations = 0;
    const perDay = regsByDateWorkshop.get(date);
    if (perDay) for (const n of perDay.values()) registrations += n;
    return {
      date,
      registrations,
      adSpendEurMinor: adByDate.get(date) ?? 0,
      acquisitionSpendEurMinor: acqByDate.get(date) ?? 0,
      costPerRegistrationEurMinor: acqAllocation.costPerRegistrationByDate.get(date) ?? 0,
    };
  });

  // One row per non-deleted workshop — including those with no activity yet,
  // so the page mirrors the workshop list rather than hiding empty ones.
  const emptyAcc: Acc = { regs: 0, emails: new Set(), live: 0, replay: 0, noShow: 0, engineTw: new Set(), engineCert: new Set(), netEurMinor: 0 };
  const rows: WorkshopPerformanceRow[] = workshopRows.map((w) => {
    const a = accs.get(w.id) ?? emptyAcc;
    const courseBuyers = new Set(a.engineTw);
    const certBuyers = new Set(a.engineCert);
    let attributedEur = 0;
    for (const email of a.emails) {
      const s = standalone.get(email);
      if (!s) continue;
      if (s.tw) courseBuyers.add(email);
      if (s.cert) certBuyers.add(email);
      attributedEur += s.eurMinor;
    }
    const buyers = new Set([...courseBuyers, ...certBuyers]);
    const attended = a.live + a.replay;
    const totalEurMinor = a.netEurMinor + attributedEur;
    // Costs are day-by-day sums; a workshop with no spend on any of its
    // registration days legitimately costs 0. `null` means there was no spend
    // in the window at all, so there is nothing to charge (column reads "—").
    const metaCostEurMinor =
      adSpendEurMinor > 0 ? Math.round(totalAllocation.byWorkshop.get(w.id) ?? 0) : null;
    // Workshop-only (TOF) cost: what its registrations cost on the days they
    // came in — the acquisition euros those registrations actually pulled.
    const acquisitionCostEurMinor =
      acquisitionSpendEurMinor > 0 ? Math.round(acqAllocation.byWorkshop.get(w.id) ?? 0) : null;
    return {
      workshopId: w.id,
      title: w.title,
      startsAtUtc: w.starts_at_utc,
      isReplay: w.is_replay === 1,
      status: w.status,
      registrations: a.regs,
      attendedLive: a.live,
      replayViews: a.replay,
      noShows: a.noShow,
      attendancePct: a.regs > 0 ? (attended / a.regs) * 100 : null,
      bumpBuys: bumpByWorkshop.get(w.id) ?? 0,
      courseBuys: courseBuyers.size,
      certBuys: certBuyers.size,
      engineNetEurMinor: a.netEurMinor,
      attributedCourseEurMinor: attributedEur,
      totalEurMinor,
      metaCostEurMinor,
      roas: metaCostEurMinor != null && metaCostEurMinor > 0 ? totalEurMinor / metaCostEurMinor : null,
      acquisitionCostEurMinor,
      workshopRoas:
        acquisitionCostEurMinor != null && acquisitionCostEurMinor > 0
          ? totalEurMinor / acquisitionCostEurMinor
          : null,
      costPerRegistrationEurMinor:
        acquisitionCostEurMinor != null && a.regs > 0 ? acquisitionCostEurMinor / a.regs : null,
      conversionPct: a.regs > 0 ? (buyers.size / a.regs) * 100 : null,
      // Conversion of people who actually attended (not just registered) — the
      // next funnel step down. Denominator is live + replay attendees.
      conversionPerAttendeePct: attended > 0 ? (buyers.size / attended) * 100 : null,
    };
  });

  // Workshop-only revenue for the weighted-average ROAS: engine net across all
  // workshops (each payment counted once) + standalone course revenue from
  // emails that registered for ANY workshop (each buyer counted once, so a
  // multi-workshop buyer isn't double-counted the way per-row figures are).
  const engineNetTotal = [...accs.values()].reduce((s, a) => s + a.netEurMinor, 0);
  let attributedDistinctEurMinor = 0;
  for (const [email, s] of standalone) {
    if (allRegEmails.has(email)) attributedDistinctEurMinor += s.eurMinor;
  }
  const workshopRevenueEurMinor = engineNetTotal + attributedDistinctEurMinor;

  return {
    rows,
    adSpendEurMinor,
    acquisitionSpendEurMinor,
    retargetingSpendEurMinor: adSpendEurMinor - acquisitionSpendEurMinor,
    totalRegistrations,
    costPerRegistrationEurMinor,
    dailyCosts,
    unattributedAcquisitionSpendEurMinor: acqAllocation.unattributedEurMinor,
    workshopRevenueEurMinor,
    workshopRoas:
      acquisitionSpendEurMinor > 0 ? workshopRevenueEurMinor / acquisitionSpendEurMinor : null,
  };
}

// ---------------------------------------------------------------------------
// Completed workshop registrations (paid or coupon) per day — the acquisition
// pulse the dashboard plots next to ad spend. Buckets by created_at (UTC),
// same as every other daily figure here.

export type RegistrationsByDay = {
  days: Array<{ date: string; count: number }>;
  total: number;
};

export async function computeRegistrationsByDay(
  db: D1Database,
  opts: { from?: string | null; to?: string | null } = {},
): Promise<RegistrationsByDay> {
  const where: string[] = ["payment_status IN ('paid','coupon')"];
  const binds: unknown[] = [];
  if (opts.from) { where.push('created_at >= ?'); binds.push(opts.from); }
  if (opts.to) { where.push('created_at <= ?'); binds.push(`${opts.to} 23:59:59`); }
  const res = await db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS n
         FROM workshop_registrations
        WHERE ${where.join(' AND ')}
        GROUP BY 1 ORDER BY 1`,
    )
    .bind(...binds)
    .all<{ date: string; n: number }>();
  const days = (res.results ?? []).map((r) => ({ date: r.date, count: r.n }));
  return { days, total: days.reduce((s, d) => s + d.count, 0) };
}

// Ad spend grouped by campaign for a window, EUR-converted, tagged with its
// funnel intent — for the admin "By campaign" breakdown so the TOF/retargeting
// split is verifiable at a glance.
export type CampaignSpend = { campaign: string; kind: CampaignKind; eurMinor: number };

export async function computeAdSpendByCampaign(
  db: D1Database,
  opts: { from?: string | null; to?: string | null } = {},
): Promise<CampaignSpend[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.from) { where.push('spend_date >= ?'); binds.push(opts.from); }
  if (opts.to) { where.push('spend_date <= ?'); binds.push(opts.to); }
  const res = await db
    .prepare(
      `SELECT campaign, amount_eur_minor, amount_minor, currency FROM workshop_ad_spend
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
    )
    .bind(...binds)
    .all<{ campaign: string; amount_eur_minor: number | null; amount_minor: number; currency: string }>();
  const byCampaign = new Map<string, number>();
  for (const a of res.results ?? []) {
    const eur = a.amount_eur_minor ?? (a.currency === 'EUR' ? a.amount_minor : 0);
    const name = (a.campaign ?? '').trim();
    byCampaign.set(name, (byCampaign.get(name) ?? 0) + eur);
  }
  return [...byCampaign.entries()]
    .map(([campaign, eurMinor]) => ({ campaign, kind: campaignKind(campaign), eurMinor }))
    .sort((a, b) => b.eurMinor - a.eurMinor);
}

// ---------------------------------------------------------------------------
// Merged per-day revenue streams for charts / tables / CSV. Fills every day
// between `from` and `to` (or the observed data range) so line charts have a
// continuous x-axis.

export type StreamDay = {
  date: string;
  workshopsEurMinor: number; // workshop engine net minus masterclass share
  masterclassEurMinor: number;
  twelveWeekEurMinor: number;
  certificationEurMinor: number;
  otherCoursesEurMinor: number;
  totalEurMinor: number;
  adSpendEurMinor: number; // all campaigns
  acquisitionAdSpendEurMinor: number; // prospecting (TOF) campaigns only
};

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function mergeDailyStreams(
  workshops: StatsReport,
  courses: CourseSalesReport,
  from?: string | null,
  to?: string | null,
): StreamDay[] {
  const wk = new Map(workshops.daily.map((d) => [d.date, d]));
  const cr = new Map(courses.daily.map((d) => [d.date, d]));
  const dates = [...wk.keys(), ...cr.keys()].sort();
  const start = from ?? dates[0];
  const end = to ?? dates[dates.length - 1];
  if (!start || !end || start > end) return [];

  const out: StreamDay[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const w = wk.get(date);
    const c = cr.get(date);
    const masterclass = w?.masterclassNetEurMinor ?? 0;
    const workshopsNet = (w?.netEurMinor ?? 0) - masterclass;
    const tw = c?.twelveWeekEurMinor ?? 0;
    const cert = c?.certificationEurMinor ?? 0;
    const other = c?.otherEurMinor ?? 0;
    out.push({
      date,
      workshopsEurMinor: workshopsNet,
      masterclassEurMinor: masterclass,
      twelveWeekEurMinor: tw,
      certificationEurMinor: cert,
      otherCoursesEurMinor: other,
      totalEurMinor: workshopsNet + masterclass + tw + cert + other,
      adSpendEurMinor: w?.adSpendEurMinor ?? 0,
      acquisitionAdSpendEurMinor: w?.acquisitionAdSpendEurMinor ?? 0,
    });
    if (out.length > 3700) break; // hard cap ≈ 10 years; keeps "all time" sane
  }
  return out;
}
