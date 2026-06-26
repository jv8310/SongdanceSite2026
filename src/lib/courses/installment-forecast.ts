// Future-revenue projection for installment-plan course purchases.
//
// Turns the raw `course_registrations` rows into:
//   1. a per-calendar-month forecast of the income we still expect to collect
//      from open installment plans, split into a healthy line and an
//      "at risk" line (money sitting behind a retrying / unpaid card); and
//   2. a per-person watch list, with the Stripe subscription state flagged so
//      cancelled / unpaid / retrying plans surface for a closer eye.
//
// Data-model recap (see src/lib/courses/db.ts + the 12-week checkout):
//   payment_plan        '3x' | '6x' | '12x' | 'full'
//   amount_cents        TOTAL charged across the whole plan (per-installment
//                       = amount_cents / installments_total)
//   installments_total  number of monthly charges (e.g. 3)
//   installments_paid   how many invoices have settled so far
//   paid_at             when the FIRST installment settled — the billing anchor
//   subscription_status verbatim Stripe Subscription.status
//   status              our coarse row status ('paid' = active course, etc.)
//
// Stripe bills monthly (`interval: month`) from `paid_at`, so installment k
// (0-indexed) is due `paid_at + k` calendar months. The ones still ahead of us
// are k = installments_paid … installments_total − 1.
//
// Amounts are reported NET of VAT. The charged `amount_cents` is gross
// (tax-inclusive for EU B2C); we strip VAT the same way the workshop stats do
// — `net = gross / (1 + rate)` — using the per-country rate the page resolves
// from Quaderno. Reverse-charge B2B (a VAT number) and non-EU sales carry a 0
// rate, so net == gross there.

import { netFromGross } from '../workshops/quaderno';

export type InstallmentRow = {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  currency: string;
  country: string | null;
  vat_number: string | null;
  status: string;
  payment_plan: string;
  amount_cents: number;
  installments_paid: number;
  installments_total: number;
  // Admin-scheduled early stop (migration 0054): total installments to ever
  // charge. NULL = full plan. Caps the projection + watch list so a scheduled
  // cancellation drops the forgiven charges out of expected revenue.
  cancel_after_installment: number | null;
  paid_at: string | null;
  subscription_status: string | null;
  provider: 'stripe' | 'paypal';
  stripe_subscription_id: string | null;
  stripe_payment_intent: string | null;
  paypal_subscription_id: string | null;
  paypal_capture_id: string | null;
  // VAT rate (decimal, e.g. 0.21) the page resolves from Quaderno for this
  // row's country before calling buildForecast. 0 = no VAT / reverse charge /
  // unknown, in which case net == gross. Defaults to 0 when absent.
  taxRate?: number;
};

// Effective plan length: the admin-scheduled stop if one is set (clamped into
// [installments_paid, installments_total]), otherwise the full plan.
export function effectiveTotal(row: InstallmentRow): number {
  if (row.cancel_after_installment == null) return row.installments_total;
  return Math.max(
    row.installments_paid,
    Math.min(row.cancel_after_installment, row.installments_total),
  );
}

// Approximate EUR-per-1-unit fallback rates — same table the ad-spend import
// uses (src/pages/api/admin/workshops/ad-spend-import.ts) so the two admin
// views agree. EUR is always 1.
export const FX_TO_EUR: Record<string, number> = {
  EUR: 1, USD: 0.92, GBP: 1.17, CAD: 0.68, CHF: 1.05,
  AUD: 0.61, NZD: 0.56, NOK: 0.087, SEK: 0.088, DKK: 0.134,
};

export function toEurMinor(amountMinor: number, currency: string): number {
  const rate = FX_TO_EUR[(currency || 'EUR').toUpperCase()] ?? 1;
  return Math.round(amountMinor * rate);
}

// Gross amount of a single installment (original currency, minor units).
function grossPerInstallment(row: InstallmentRow): number {
  return Math.round(row.amount_cents / row.installments_total);
}

// Net (VAT-stripped) amount of a single installment, original currency.
function netPerInstallment(row: InstallmentRow): number {
  return netFromGross(grossPerInstallment(row), row.taxRate ?? 0).subtotalMinor;
}

// Stripe statuses that mean "keep an eye on it" — the owner's
// cancelled / unpaid / retrying, mapped onto Stripe's real enum:
//   retrying  → past_due  (card declined; Stripe is auto-retrying)
//   unpaid    → unpaid    (retries exhausted; invoice left owing)
//   cancelled → canceled  (subscription stopped)
// plus the `incomplete*` states where the very first payment never confirmed.
const ATTENTION = new Set([
  'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired',
]);
export function needsAttention(subStatus: string | null): boolean {
  return subStatus != null && ATTENTION.has(subStatus);
}

// A subscription that will issue no further invoices at all — drop it from the
// forward projection (it's still listed in the watch list as "stopped").
function isDead(row: InstallmentRow): boolean {
  return (
    row.subscription_status === 'canceled' ||
    row.subscription_status === 'incomplete_expired' ||
    row.status === 'cancelled' ||
    row.status === 'refunded' ||
    row.status === 'expired'
  );
}

// Add `n` calendar months to a UTC timestamp, clamping the day to the target
// month's length (e.g. Jan 31 + 1mo → Feb 28).
function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const daysInTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTarget));
  return target.getTime();
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const name = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ][m - 1];
  return `${name} ${y}`;
}

function startOfMonthUtc(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export type ForecastMonth = {
  key: string;        // 'YYYY-MM'
  label: string;      // 'Jun 2026'
  expectedEurMinor: number; // healthy projection
  atRiskEurMinor: number;   // portion behind a retrying/unpaid card
  totalEurMinor: number;    // expected + atRisk
  count: number;            // installments landing this month
};

export type PlanState = 'on_track' | 'at_risk' | 'stopped' | 'not_started';

export type ForecastPerson = {
  id: number;
  name: string;
  email: string;
  currency: string;
  plan: string;              // '3×' | '6×'
  installmentsPaid: number;
  installmentsTotal: number;       // full plan length (original)
  effectiveTotal: number;          // length after any scheduled early stop
  cancelAfterInstallment: number | null; // admin schedule, null = full plan
  remaining: number;               // charges still ahead (effective)
  perInstallmentMinor: number;     // NET, original currency
  perInstallmentEurMinor: number;  // NET, EUR-equivalent
  perInstallmentGrossMinor: number; // gross charge, original currency
  perInstallmentGrossEurMinor: number; // gross charge, EUR-equivalent
  taxRatePct: number;              // VAT rate applied (e.g. 21), 0 if none
  remainingMinor: number;          // NET still owed, original currency
  remainingEurMinor: number;       // NET, EUR-equivalent
  remainingGrossMinor: number;     // gross still to charge, original currency
  nextDueIso: string | null;       // next charge date (null if stopped/not started)
  subStatus: string | null;
  rowStatus: string;
  provider: 'stripe' | 'paypal';
  stripeSubscriptionId: string | null;
  stripePaymentIntent: string | null;
  paypalSubscriptionId: string | null;
  paypalCaptureId: string | null;
  state: PlanState;
  attention: boolean;
};

export type ForecastTotals = {
  expectedEurMinor: number;  // sum of healthy projection
  atRiskEurMinor: number;    // sum of at-risk projection
  totalEurMinor: number;     // expected + atRisk
  next30EurMinor: number;    // due within 30 days from `now`
  activePlans: number;       // open plans still billing
  attentionCount: number;    // plans flagged for a closer look
  installmentsAhead: number; // number of future charges projected
};

export type Forecast = {
  months: ForecastMonth[];
  people: ForecastPerson[];
  totals: ForecastTotals;
};

type Projection = { key: string; eurMinor: number; atRisk: boolean };

// Project the remaining installments of one plan into month buckets.
function projectRow(row: InstallmentRow, nowMs: number): Projection[] {
  // Bill only up to the effective (possibly admin-shortened) plan length.
  const total = effectiveTotal(row);
  const paid = row.installments_paid;
  const remaining = total - paid;
  if (row.installments_total <= 1 || remaining <= 0) return [];
  if (isDead(row)) return [];
  if (!row.paid_at) return []; // plan hasn't started — no reliable schedule

  const anchor = Date.parse(row.paid_at);
  if (!Number.isFinite(anchor)) return [];

  const perEur = toEurMinor(netPerInstallment(row), row.currency);

  const sub = row.subscription_status;
  const thisMonth = startOfMonthUtc(nowMs);

  // `unpaid` / `incomplete`: Stripe won't generate further invoices, but the
  // currently-owed one is real money to chase. Project just that single
  // overdue installment into the current month, flagged at-risk.
  if (sub === 'unpaid' || sub === 'incomplete') {
    return [{ key: monthKey(thisMonth), eurMinor: perEur, atRisk: true }];
  }

  // Otherwise (active / trialing / paused / past_due / not-yet-mirrored) the
  // schedule keeps running. `past_due` still bills on cadence — flag it, but
  // project the full remaining run. Overdue dates fold into the current month.
  const atRisk = sub === 'past_due';
  const out: Projection[] = [];
  for (let k = paid; k < total; k++) {
    const dueMs = addMonths(anchor, k);
    const bucket = dueMs < thisMonth ? thisMonth : dueMs;
    out.push({ key: monthKey(bucket), eurMinor: perEur, atRisk });
  }
  return out;
}

function fullName(row: InstallmentRow): string {
  const name = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim();
  return name || row.email;
}

function planState(row: InstallmentRow): PlanState {
  if (isDead(row)) return 'stopped';
  if (!row.paid_at) return 'not_started';
  if (needsAttention(row.subscription_status)) return 'at_risk';
  return 'on_track';
}

// Build the whole forecast. `nowMs` is injectable for testing/determinism.
export function buildForecast(
  rows: InstallmentRow[],
  nowMs: number = Date.now(),
): Forecast {
  // Only true installment plans.
  const plans = rows.filter((r) => r.installments_total > 1);

  // ── Month buckets ──
  const bucketMap = new Map<
    string,
    { expected: number; atRisk: number; count: number }
  >();
  let installmentsAhead = 0;
  for (const row of plans) {
    for (const p of projectRow(row, nowMs)) {
      const b = bucketMap.get(p.key) ?? { expected: 0, atRisk: 0, count: 0 };
      if (p.atRisk) b.atRisk += p.eurMinor;
      else b.expected += p.eurMinor;
      b.count += 1;
      bucketMap.set(p.key, b);
      installmentsAhead += 1;
    }
  }

  // Fill the gap months so the line is continuous from this month → last due.
  const months: ForecastMonth[] = [];
  if (bucketMap.size > 0) {
    const keys = [...bucketMap.keys()].sort();
    const firstKey = monthKey(startOfMonthUtc(nowMs));
    const lastKey = keys[keys.length - 1];
    let cursor = startOfMonthUtc(nowMs);
    // If the earliest projected month is before "now" (shouldn't happen — we
    // clamp — but be safe), start there instead.
    if (keys[0] < firstKey) cursor = Date.parse(`${keys[0]}-01T00:00:00Z`);
    let guard = 0;
    while (guard++ < 240) {
      const key = monthKey(cursor);
      const b = bucketMap.get(key) ?? { expected: 0, atRisk: 0, count: 0 };
      months.push({
        key,
        label: monthLabel(key),
        expectedEurMinor: b.expected,
        atRiskEurMinor: b.atRisk,
        totalEurMinor: b.expected + b.atRisk,
        count: b.count,
      });
      if (key === lastKey) break;
      cursor = addMonths(cursor, 1);
    }
  }

  // ── People watch list ──
  const horizon30 = nowMs + 30 * 86400 * 1000;
  let next30 = 0;
  const people: ForecastPerson[] = plans.map((row) => {
    const effTotal = effectiveTotal(row);
    const remaining = Math.max(0, effTotal - row.installments_paid);
    const grossMinor = grossPerInstallment(row);
    const netMinor = netPerInstallment(row);
    const state = planState(row);
    const anchor = row.paid_at ? Date.parse(row.paid_at) : NaN;
    let nextDueIso: string | null = null;
    if (
      remaining > 0 &&
      state !== 'stopped' &&
      Number.isFinite(anchor)
    ) {
      const dueMs = addMonths(anchor, row.installments_paid);
      nextDueIso = new Date(dueMs).toISOString().slice(0, 10);
      if (state === 'on_track' && dueMs <= horizon30) {
        next30 += toEurMinor(netMinor, row.currency);
      }
    }
    return {
      id: row.id,
      name: fullName(row),
      email: row.email,
      currency: row.currency,
      plan: `${row.installments_total}×`,
      installmentsPaid: row.installments_paid,
      installmentsTotal: row.installments_total,
      effectiveTotal: effTotal,
      cancelAfterInstallment: row.cancel_after_installment,
      remaining,
      perInstallmentMinor: netMinor,
      perInstallmentEurMinor: toEurMinor(netMinor, row.currency),
      perInstallmentGrossMinor: grossMinor,
      perInstallmentGrossEurMinor: toEurMinor(grossMinor, row.currency),
      taxRatePct: Math.round((row.taxRate ?? 0) * 100),
      remainingMinor: netMinor * remaining,
      remainingEurMinor: toEurMinor(netMinor * remaining, row.currency),
      remainingGrossMinor: grossMinor * remaining,
      nextDueIso,
      subStatus: row.subscription_status,
      rowStatus: row.status,
      provider: row.provider,
      stripeSubscriptionId: row.stripe_subscription_id,
      stripePaymentIntent: row.stripe_payment_intent,
      paypalSubscriptionId: row.paypal_subscription_id,
      paypalCaptureId: row.paypal_capture_id,
      state,
      attention: state === 'at_risk' || (state === 'stopped' && remaining > 0),
    };
  });

  // Sort: things that need attention first, then by soonest next charge,
  // then everything finished/stopped at the bottom.
  const order: Record<PlanState, number> = {
    at_risk: 0, on_track: 1, not_started: 2, stopped: 3,
  };
  people.sort((a, b) => {
    if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state];
    if (a.nextDueIso && b.nextDueIso) return a.nextDueIso.localeCompare(b.nextDueIso);
    if (a.nextDueIso) return -1;
    if (b.nextDueIso) return 1;
    return b.remainingEurMinor - a.remainingEurMinor;
  });

  const expected = months.reduce((s, m) => s + m.expectedEurMinor, 0);
  const atRisk = months.reduce((s, m) => s + m.atRiskEurMinor, 0);
  const activePlans = plans.filter(
    (r) =>
      !isDead(r) &&
      r.paid_at != null &&
      effectiveTotal(r) - r.installments_paid > 0,
  ).length;
  const attentionCount = people.filter((p) => p.attention).length;

  return {
    months,
    people,
    totals: {
      expectedEurMinor: expected,
      atRiskEurMinor: atRisk,
      totalEurMinor: expected + atRisk,
      next30EurMinor: next30,
      activePlans,
      attentionCount,
      installmentsAhead,
    },
  };
}
