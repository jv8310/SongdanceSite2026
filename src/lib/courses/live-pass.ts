// The live pass: the weekly Q&As and the monthly deepening session, bought as
// a NUMBER of sessions — for anyone whose course no longer includes them (or
// never did). Sold by the month, counted by the session:
//
//   1 month   €52                  4 Q&As and 1 deepening session
//   3 months  3 × €52, 15% off     €132    12 Q&As and 3 deepening sessions
//   6 months  6 × €52, 25% off     €234    24 Q&As and 6 deepening sessions
//   12 months 12 × €52, 30% off    €436    48 Q&As and 12 deepening sessions
//             (the yearly pass, November 2026)
//
// A pass holds exactly that many sessions — the next ones on the member app's
// calendar from the day it starts — and access ends after the last of them
// (Jacob, October 2026). A week without a Q&A costs nobody a session, and two
// passes queue: the second picks up with the session after the first one's
// last. The sessions are counted by the member app (songdance-app,
// apps/api/src/lib/live-pass.ts), which holds the calendar; this site never
// knows which session a pass ends on, and never says so.
//
// Plus one add-on, sold only with a pass: **Extend my certification window**
// (+20% of the pass). It keeps the window to apply for certification open for
// the pass's months (1, 3, 6 or 12, counted from the day its sessions start, behind
// any earlier pass's months) — for a 9-month (certification) student whose
// window has closed, and for the CEEE 2025 cohort, who hold the course without
// the right to certify (`cert_no_certification`). Nobody else is shown it: the
// page hides it until the address says they hold the certification course, and
// the checkout refuses it otherwise.
//
// Prices are floored to whole units (5 for the krona family), so the advertised
// discount is never under-delivered and the add-on never costs more than 20%:
// €132.60 → €132, and €26.40 → €26. Other currencies scale the €52 month with the
// albums' EUR-relative ratios (albumPriceCents) and take the same discounts.
//
// A pass starts on the day it is bought — unless the buyer's course still gives
// them the live sessions: then it starts the day after those end, so nobody
// pays twice for the same session and a pass always extends what they have.
// That means the certification course (site order, or the Drip-only holders)
// or the 12 weeks of a 12-week course bought on the site (a 12-week student's
// pass picks up where the 12 weeks end; the page also offers them the 9-month
// certification course). An earlier pass does not move the start: the member
// app queues the sessions, so a pass bought while another runs is never left
// with a gap between the two.
//
// The dates are computed at checkout (shown to the buyer before they pay) and
// again when the payment lands, and written onto the order (migration 0089,
// UTC instants bounding Brussels days): `access_starts_at` = the day the pass
// begins, which the member app reads to count its sessions from;
// `access_ends_at` = the end of the pass's months, which only the
// certification-window extension uses (the member app ignores it on a paid
// pass: the pass ends with its last session).
//
// Rides the ordinary course machinery under product slugs `live-pass-1m` /
// `-3m` / `-6m` / `-12m`; the add-on is a row in the `bumps` JSON (`cert-extension`), so
// every money report already counts it.
//
// ── The monthly (October 2026) ──────────────────────────────────────────────
//
// Beside the three passes, a **monthly** that renews by itself until the buyer
// cancels: €52 the first month (the 1-month pass's price, same currencies),
// then €44 a month (see "The monthly's price" below), charged on the same day
// each month by Stripe or PayPal. It is time, not a count: while
// it runs it opens every Q&A and deepening session, and once cancelled it runs
// to the end of the month already paid for, then stops. Cancel any time, from
// the link in its confirmation email (/courses/live-pass/manage), and start
// again whenever. No certification-window add-on with it — that is sold with a
// pass, for a stretch of months known up front.
//
// It is the open-ended subscription the member app was built to read
// (songdance-app: site slug `qa-plan-deepening` → product
// `qa-extended-deepening`, "active until the end of the paid period"): one row,
// payment_plan 'subscription', installments_total 0, amount_cents = ONE month,
// installments_paid = months charged, paid_through = the end of the last month
// charged (migration 0090). See isOpenEndedPlan in installment-forecast.ts for
// how the money reports read it.
//
// The monthly's price (Jacob, October 2026): €52 the first month, then €44 —
// 15% off, the 3-month pass's rate per month, so staying is rewarded where
// people most often stop, while paying ahead stays the better deal at every
// length (3 months on the monthly €140 against the pass's €132; 6 months €272
// against €234). Cheaper renewals would undercut the 3-month pass: at €39, three
// months on the monthly is €130, less than the pass and cancellable.
//
// Both gateways bill a subscription at one recurring price, so the subscription
// is the renewal price — `amount_cents` is €44, which is what every month after
// the first charges — and the first month's €8 more rides the first charge as a
// one-off: a one-time line on Stripe's first invoice (one €52 charge), PayPal's
// setup fee (two charges in the same minute, €8 + €44, as order bumps on a plan
// already are). With the certification-window extension (November 2026, below)
// both prices are 20% more. It is a `monthly-first-month` row in `bumps`, so the row says
// what was charged; the money reports count it as the pass's own money, not as
// an order bump (isCourseTopUpSlug, stats.ts). Not PayPal's trial cycle: the
// site tells a monthly payment from a setup fee by its amount, and a €52 first
// cycle on a €44 plan would never be counted.

// The certification-window extension on the monthly (Jacob, November 2026):
// the same add-on the passes carry, +20% of each month, floored like the rest —
// €52 + €10 the first month, then €44 + €8 (€62, then €52). It keeps the window
// to apply for certification open for as long as the monthly is paid: to the
// end of the last month charged, so a cancelled monthly keeps it to the end of
// its paid month and no further. The subscription's recurring price carries it
// (`amount_cents` = €52, the first month's extra €10), and a €0
// `cert-extension` row in `bumps` marks the order (as a free pass's does), so
// every money figure already reads right and loadCertExtensions finds it. Sold
// only to someone who holds the certification course, and only when its first
// month reaches past the window they have (monthlyExtensionRefusal).

import { LIVE_PASS_MONTHLY_PROMO_MONTHS, livePassPromoPercent } from '../promo';
import { formatMoney, type SupportedCurrency } from '../workshops/currency';
import { businessDayOf, businessWindowUtc } from '../workshops/periods';
import { albumPriceCents } from '../music/product';
import { addDays, addMonths } from './cert-access';
import { parsePurchasedBumps } from './db';

export const LIVE_PASS_MONTHS = [1, 3, 6, 12] as const;
export type LivePassMonths = (typeof LIVE_PASS_MONTHS)[number];

export const LIVE_PASS_MONTHLY_EUR_CENTS = 5200;
export const LIVE_PASS_DISCOUNT_PERCENT: Record<LivePassMonths, number> = { 1: 0, 3: 15, 6: 25, 12: 30 };
export const CERT_EXTENSION_PERCENT = 20;

export const LIVE_PASS_SLUG_PREFIX = 'live-pass-';
export const CERT_EXTENSION_SLUG = 'cert-extension';
export const LIVE_PASS_DRIP_TAG = 'prod_LivePass';
export const CERT_EXTENSION_DRIP_TAG = 'prod_CertExtension';
export const LIVE_PASS_DRIP_EVENT = 'Completed live pass purchase';
export const LIVE_PASS_PAGE_PATH = '/courses/live-pass';

export const CERT_EXTENSION_LABEL = 'Extend my certification window';

// The monthly's slug is the member app's contract, not a `live-pass-` one: the
// app already maps it onto its open-ended plan, so no app change is needed.
export const LIVE_PASS_MONTHLY_SLUG = 'qa-plan-deepening';
export const LIVE_PASS_MONTHLY_LABEL = 'Live pass · monthly';
export const LIVE_PASS_MONTHLY_DRIP_TAG = 'prod_LivePassMonthly';
export const LIVE_PASS_MONTHLY_DRIP_EVENT = 'Started live pass monthly';
export const LIVE_PASS_MANAGE_PATH = '/courses/live-pass/manage';

// Every month after the first, this much under the first month's price.
export const LIVE_PASS_MONTHLY_RENEWAL_DISCOUNT_PERCENT = 15;
// The first month's extra over the renewal price, as a `bumps` row.
export const MONTHLY_FIRST_MONTH_SLUG = 'monthly-first-month';
export const MONTHLY_FIRST_MONTH_LABEL = 'First month at the full price';

export function isLivePassMonthlySlug(slug: string | null | undefined): boolean {
  return slug === LIVE_PASS_MONTHLY_SLUG;
}

// A `bumps` row that is part of the course's own price rather than an add-on
// bought beside it: the monthly's first-month extra. Counted as the course's
// money in the reports, never as an order bump.
export function isCourseTopUpSlug(slug: string): boolean {
  return slug === MONTHLY_FIRST_MONTH_SLUG;
}

// What a live-pass `bumps` row is called on an order (SD-ORDER, Drip order,
// reports), else null.
export function livePassExtraLabel(slug: string): string | null {
  if (slug === CERT_EXTENSION_SLUG) return CERT_EXTENSION_LABEL;
  if (slug === MONTHLY_FIRST_MONTH_SLUG) return MONTHLY_FIRST_MONTH_LABEL;
  return null;
}

// The monthly's first-month extra recorded on a row (0 when none).
export function monthlyFirstMonthExtraCents(bumps: string | null | undefined): number {
  return parsePurchasedBumps(bumps ?? null)
    .filter((b) => b.slug === MONTHLY_FIRST_MONTH_SLUG)
    .reduce((sum, b) => sum + Math.max(0, b.amount_cents), 0);
}

export function livePassSlug(months: LivePassMonths): `live-pass-${number}m` {
  return `live-pass-${months}m`;
}

export function isLivePassSlug(slug: string | null | undefined): boolean {
  return !!slug && livePassMonthsOf(slug) !== null;
}

export function livePassMonthsOf(slug: string | null | undefined): LivePassMonths | null {
  const m = /^live-pass-(\d+)m$/.exec(slug ?? '');
  const n = m ? Number(m[1]) : NaN;
  return (LIVE_PASS_MONTHS as readonly number[]).includes(n) ? (n as LivePassMonths) : null;
}

export function parseLivePassMonths(raw: unknown): LivePassMonths | null {
  const n = Number(raw);
  return (LIVE_PASS_MONTHS as readonly number[]).includes(n) ? (n as LivePassMonths) : null;
}

// What a pass holds: 4 Q&As and 1 deepening session a month. The member app
// counts the same numbers (packages/shared/src/products.ts, livePassSessions).
export const LIVE_PASS_SESSIONS_PER_MONTH = { qa: 4, deepening: 1 } as const;

export function livePassSessions(months: LivePassMonths): { qa: number; deepening: number } {
  return { qa: LIVE_PASS_SESSIONS_PER_MONTH.qa * months, deepening: LIVE_PASS_SESSIONS_PER_MONTH.deepening * months };
}

// "12 Q&As and 3 deepening sessions" — always in numerals.
export function livePassContents(months: LivePassMonths): string {
  const { qa, deepening } = livePassSessions(months);
  return `${qa} Q&As and ${deepening} deepening session${deepening === 1 ? '' : 's'}`;
}

export function livePassLabel(months: LivePassMonths): string {
  return months === 1 ? 'Live pass · 1 month' : `Live pass · ${months} months`;
}

// "Live pass · 3 months" for a live-pass slug, else null — for the label maps.
export function livePassLabelForSlug(slug: string): string | null {
  if (isLivePassMonthlySlug(slug)) return LIVE_PASS_MONTHLY_LABEL;
  const months = livePassMonthsOf(slug);
  return months ? livePassLabel(months) : null;
}

// ── Prices ──────────────────────────────────────────────────────────────────

function stepCents(currency: SupportedCurrency): number {
  return (currency === 'NOK' || currency === 'SEK' || currency === 'DKK' ? 5 : 1) * 100;
}

function floorTo(cents: number, step: number): number {
  return Math.floor(cents / step) * step;
}

// One month at the full price, in a market.
export function livePassMonthlyCents(currency: SupportedCurrency): number {
  return albumPriceCents(LIVE_PASS_MONTHLY_EUR_CENTS, currency);
}

// The certification-window extension on a month of the monthly: 20% of that
// month, floored (never more than 20%).
function monthlyExtensionOn(monthCents: number, currency: SupportedCurrency): number {
  return floorTo((monthCents * CERT_EXTENSION_PERCENT) / 100, stepCents(currency));
}

// The monthly's first month: one month at the full price (with the
// certification-window extension, 20% more).
export function livePassMonthlyFirstCents(currency: SupportedCurrency, withExtension = false): number {
  const month = livePassMonthlyCents(currency);
  return withExtension ? month + monthlyExtensionOn(month, currency) : month;
}

// The monthly from its second month on: 15% off, floored like the passes (with
// the certification-window extension, 20% more).
export function livePassMonthlyRenewalCents(currency: SupportedCurrency, withExtension = false): number {
  const month = floorTo(
    (livePassMonthlyCents(currency) * (100 - LIVE_PASS_MONTHLY_RENEWAL_DISCOUNT_PERCENT)) / 100,
    stepCents(currency),
  );
  return withExtension ? month + monthlyExtensionOn(month, currency) : month;
}

// The monthly during the site sale (Black Friday 2026): the sale's percent off
// its first two months — the first month's own price, then the renewal price —
// and the usual price from the third. Null outside a sale. Exact to the minor
// unit, not floored: Stripe takes the percent itself (a coupon), PayPal bills
// these two figures as cycles of their own, and the page prints them.
export type LivePassMonthlyPromo = {
  percent: number;
  months: number;
  first_cents: number;
  second_cents: number;
};

export function livePassMonthlyPromo(
  currency: SupportedCurrency,
  nowMs: number = Date.now(),
  // With the certification-window extension: the percent comes off the prices
  // that carry it, as the coupon takes it off the whole invoice.
  withExtension = false,
): LivePassMonthlyPromo | null {
  const percent = livePassPromoPercent(nowMs);
  if (!percent) return null;
  const off = (cents: number) => Math.round((cents * (100 - percent)) / 100);
  return {
    percent,
    months: LIVE_PASS_MONTHLY_PROMO_MONTHS,
    first_cents: off(livePassMonthlyFirstCents(currency, withExtension)),
    second_cents: off(livePassMonthlyRenewalCents(currency, withExtension)),
  };
}

// What a monthly agreed during a sale really charges for its first two months:
// the order row is written like any monthly's (the reports read it so), and the
// sale is on the checkout's own event, by the order's id. Null for a monthly
// outside a sale. For the emails and the manage page, which name the prices.
export async function monthlySaleForOrder(
  db: D1Database,
  reg: { id: number; amount_cents: number; bumps: string | null },
): Promise<{ percent: number; first_cents: number; second_cents: number } | null> {
  try {
    const row = await db
      .prepare(`SELECT payload FROM events WHERE external_id IN (?1, ?2) LIMIT 1`)
      .bind(`local-course-${reg.id}-monthly`, `local-course-pp-${reg.id}-monthly`)
      .first<{ payload: string | null }>();
    const percent = Number((row?.payload ? JSON.parse(row.payload) : null)?.promo_percent ?? 0);
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) return null;
    const off = (cents: number) => Math.round((cents * (100 - percent)) / 100);
    return {
      percent,
      first_cents: off(reg.amount_cents + monthlyFirstMonthExtraCents(reg.bumps)),
      second_cents: off(reg.amount_cents),
    };
  } catch {
    return null;
  }
}

// The pass at its usual price: discounted for its length and floored to a whole
// unit.
export function livePassRegularCents(months: LivePassMonths, currency: SupportedCurrency): number {
  const full = livePassMonthlyCents(currency) * months;
  return floorTo((full * (100 - LIVE_PASS_DISCOUNT_PERCENT[months])) / 100, stepCents(currency));
}

// The pass as it is charged at this moment: its usual price, less the site
// sale's percent while one runs (Black Friday 2026: 20%, promo.ts), floored
// again so the percent is never under-delivered. The page and the checkout both
// read this, so the figure shown is the figure charged.
export function livePassPriceCents(
  months: LivePassMonths,
  currency: SupportedCurrency,
  nowMs: number = Date.now(),
): number {
  const regular = livePassRegularCents(months, currency);
  const promo = livePassPromoPercent(nowMs);
  return promo ? floorTo((regular * (100 - promo)) / 100, stepCents(currency)) : regular;
}

// The certification-window add-on: 20% of the pass it rides on, floored.
export function certExtensionPriceCents(
  months: LivePassMonths,
  currency: SupportedCurrency,
  nowMs: number = Date.now(),
): number {
  return floorTo((livePassPriceCents(months, currency, nowMs) * CERT_EXTENSION_PERCENT) / 100, stepCents(currency));
}

export type LivePassOffer = {
  months: LivePassMonths;
  currency: SupportedCurrency;
  price_cents: number;
  full_cents: number; // months × the monthly price, before the discount
  discount_percent: number;
  extension_cents: number;
  // The site sale, while one runs: its percent (0 outside it) and the price to
  // strike through beside the charged one — the pass's usual price during the
  // sale, months × the monthly price otherwise.
  promo_percent: number;
  was_cents: number;
};

export function livePassOffer(
  months: LivePassMonths,
  currency: SupportedCurrency,
  nowMs: number = Date.now(),
): LivePassOffer {
  const promo = livePassPromoPercent(nowMs);
  const full = livePassMonthlyCents(currency) * months;
  return {
    months,
    currency,
    price_cents: livePassPriceCents(months, currency, nowMs),
    full_cents: full,
    discount_percent: LIVE_PASS_DISCOUNT_PERCENT[months],
    extension_cents: certExtensionPriceCents(months, currency, nowMs),
    promo_percent: promo,
    was_cents: promo ? livePassRegularCents(months, currency) : full,
  };
}

export function livePassPriceLabel(months: LivePassMonths, currency: SupportedCurrency): string {
  return formatMoney(livePassPriceCents(months, currency), currency);
}

// ── The period ──────────────────────────────────────────────────────────────

// startsOn: the day the pass begins — the member app counts its sessions from
// here. endsOn: the last day of its months, counted from startsOn or from the
// day after an earlier pass's months, whichever is later — what the
// certification-window extension runs to. Both YYYY-MM-DD Brussels, inclusive.
export type LivePassPeriod = { startsOn: string; endsOn: string };

// The rule, as a pure function. `busyUntil` holds the last day of what already
// gives the buyer live sessions through a course (inclusive Brussels days): the
// pass starts the day after the latest of them, or today when they are all
// behind. `passesUntil` holds the last day of their earlier passes' months:
// those never move the start (the member app queues the sessions), only where
// this pass's own months — and so an extension bought with it — begin.
export function livePassPeriod(input: {
  today: string;
  months: LivePassMonths;
  busyUntil: Array<string | null | undefined>;
  passesUntil?: Array<string | null | undefined>;
}): LivePassPeriod {
  const after = (from: string, untils: Array<string | null | undefined>) => {
    let day = from;
    for (const until of untils) {
      if (!until) continue;
      const next = addDays(until, 1);
      if (next > day) day = next;
    }
    return day;
  };
  const startsOn = after(input.today, input.busyUntil);
  const monthsFrom = after(startsOn, input.passesUntil ?? []);
  return { startsOn, endsOn: addDays(addMonths(monthsFrom, input.months), -1) };
}

// The UTC instants written onto the order: the first moment of the first day
// and the first moment after the last day, both in Brussels.
export function livePassInstants(p: LivePassPeriod): { startsAt: string; endsAt: string } {
  const w = businessWindowUtc(p.startsOn, p.endsOn);
  return { startsAt: w.start as string, endsAt: w.end as string };
}

// ── Reading paid passes ─────────────────────────────────────────────────────

export type PaidLivePass = {
  id: number;
  email: string;
  months: LivePassMonths;
  certExtension: boolean;
  startsOn: string;
  endsOn: string;
  paidOn: string;
};

type PassRow = {
  id: number;
  email: string;
  product_slug: string;
  bumps: string | null;
  paid_at: string | null;
  created_at: string;
  access_starts_at?: string | null;
  access_ends_at?: string | null;
};

export function hasCertExtension(bumps: string | null | undefined): boolean {
  return parsePurchasedBumps(bumps ?? null).some((b) => b.slug === CERT_EXTENSION_SLUG);
}

function toPaidPass(r: PassRow): PaidLivePass | null {
  const months = livePassMonthsOf(r.product_slug);
  if (!months) return null;
  const paidOn = businessDayOf(r.paid_at ?? r.created_at);
  // The stored period, when the payment wrote one; otherwise (paid before
  // migration 0089, or the write failed) the plain rule from the paid day.
  let startsOn: string;
  let endsOn: string;
  if (r.access_starts_at && r.access_ends_at) {
    startsOn = businessDayOf(r.access_starts_at);
    endsOn = addDays(businessDayOf(r.access_ends_at), -1);
  } else {
    ({ startsOn, endsOn } = livePassPeriod({ today: paidOn, months, busyUntil: [] }));
  }
  return {
    id: r.id,
    email: r.email.trim().toLowerCase(),
    months,
    certExtension: hasCertExtension(r.bumps),
    startsOn,
    endsOn,
    paidOn,
  };
}

// Every paid pass (one address, or everyone), oldest first. Reads the period
// columns when they exist; a preview runs against the live D1 before migration
// 0089 is applied, so their absence falls back to the plain rule.
export async function listPaidLivePasses(db: D1Database, email?: string): Promise<PaidLivePass[]> {
  const slugs = LIVE_PASS_MONTHS.map(livePassSlug);
  const ph = slugs.map(() => '?').join(',');
  const byEmail = email ? ' AND lower(email) = ?' : '';
  const binds = [...slugs, ...(email ? [email.trim().toLowerCase()] : [])];
  const query = (cols: string) =>
    db
      .prepare(
        `SELECT id, email, product_slug, bumps, paid_at, created_at${cols}
           FROM course_registrations
          WHERE status = 'paid' AND product_slug IN (${ph})${byEmail}
          ORDER BY COALESCE(paid_at, created_at), id`,
      )
      .bind(...binds)
      .all<PassRow>();
  let rows: PassRow[];
  try {
    rows = (await query(', access_starts_at, access_ends_at')).results ?? [];
  } catch {
    rows = (await query('')).results ?? [];
  }
  return rows.map(toPaidPass).filter((p): p is PaidLivePass => p !== null);
}

// The last day of each address's latest certification extension: the end of
// that pass's months, or — for a monthly taken with the extension — the last
// day of the month it has paid for.
export async function loadCertExtensions(db: D1Database, email?: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const keep = (who: string, day: string) => {
    const prev = out.get(who);
    if (!prev || day > prev) out.set(who, day);
  };
  for (const p of await listPaidLivePasses(db, email)) {
    if (p.certExtension) keep(p.email, p.endsOn);
  }
  // The monthlies: every one that has taken a payment, running or cancelled.
  // paid_through is the first moment after the paid month (migration 0090); a
  // preview before it has no column to read and counts none.
  const byEmail = email ? ' AND lower(email) = ?' : '';
  const monthlies = await db
    .prepare(
      `SELECT email, bumps, paid_through FROM course_registrations
        WHERE product_slug = ? AND installments_paid > 0 AND status IN ('paid','cancelled')
          AND paid_through IS NOT NULL AND bumps LIKE ?${byEmail}`,
    )
    .bind(LIVE_PASS_MONTHLY_SLUG, `%${CERT_EXTENSION_SLUG}%`, ...(email ? [email.trim().toLowerCase()] : []))
    .all<{ email: string; bumps: string | null; paid_through: string }>()
    .catch(() => ({ results: [] as Array<{ email: string; bumps: string | null; paid_through: string }> }));
  for (const m of monthlies.results ?? []) {
    if (!hasCertExtension(m.bumps)) continue;
    keep(m.email.trim().toLowerCase(), addDays(businessDayOf(m.paid_through), -1));
  }
  return out;
}

// Write the period onto the order. Never throws: before migration 0089 there
// is nowhere to write it, and readers fall back to the paid day.
export async function recordLivePassPeriod(db: D1Database, id: number, p: LivePassPeriod): Promise<boolean> {
  const { startsAt, endsAt } = livePassInstants(p);
  try {
    await db
      .prepare(`UPDATE course_registrations SET access_starts_at = ?, access_ends_at = ? WHERE id = ?`)
      .bind(startsAt, endsAt, id)
      .run();
    return true;
  } catch {
    return false;
  }
}
