// The live pass on /admin/stats (October 2026): the monthlies — how many renew,
// what they bring in a month, which are behind or ending, and each one by name
// with a link to its order (where it is cancelled) — and the passes sold in the
// page's window, by length, with the certification-window add-on.
//
// Read from D1 alone, no gateway calls, so the page stays fast. That decides one
// thing: a Stripe monthly cancelled at period end keeps its row `paid` and its
// subscription `active` until the paid month runs out, so "ending" is read off
// the site's own `live_pass.monthly.cancelled` / `.resumed` events (the buyer's
// manage link and the admin's order page both write them). A cancel made in the
// Stripe dashboard is not seen until the month ends; the order page, which asks
// the gateway, always is.
//
// Money is net of VAT in EUR, converted the way every other course figure on the
// page is (courseNetEur in stats.ts), so this box adds up with the rest.

import { brusselsToday, businessDayOf, businessWindowUtc } from '../workshops/periods';
import { courseNetEur, resolveCourseTaxRates, type MoneyOpts } from '../workshops/stats';
import { getFxRatesToEur } from '../admin/fx';
import { parsePurchasedBumps } from './db';
import { addMonths } from './installment-forecast';
import {
  CERT_EXTENSION_SLUG,
  LIVE_PASS_MONTHLY_SLUG,
  LIVE_PASS_MONTHS,
  livePassContents,
  livePassMonthsOf,
  livePassSlug,
  monthlyFirstMonthExtraCents,
  type LivePassMonths,
} from './live-pass';
import { monthlyPaidThroughDay } from './live-pass-monthly';

export type MonthlyStanding = 'behind' | 'renews' | 'ending';

export type LivePassMonthlyRow = {
  id: number;
  name: string;
  email: string;
  provider: 'stripe' | 'paypal';
  startedOn: string; // Brussels day of the first payment
  monthsCharged: number;
  priceMinor: number; // what each renewal charges, in its own currency
  currency: string;
  through: string | null; // the next renewal, or the last day open once cancelled
  standing: MonthlyStanding;
};

export type LivePassStats = {
  monthly: {
    renewing: number;
    behind: number;
    ending: number;
    monthlyEurMinor: number; // what the renewing ones bring in a month
    started: number; // in the window
    cancelled: number; // in the window, on the site
    stopped: number; // in the window, by a renewal the gateway gave up on
    charges: number; // in the window
    cashEurMinor: number; // in the window, refunds off
    rows: LivePassMonthlyRow[]; // every monthly still open, whatever the window
  };
  passes: {
    byLength: Array<{ months: LivePassMonths; contents: string; count: number; eurMinor: number }>;
    count: number;
    eurMinor: number;
    extensionCount: number;
    extensionEurMinor: number;
  };
};

type MonthlyDbRow = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  provider: string | null;
  status: string;
  subscription_status: string | null;
  amount_cents: number;
  currency: string | null;
  country: string | null;
  vat_number: string | null;
  bumps: string | null;
  installments_paid: number;
  paid_at: string | null;
  paid_through: string | null;
  refunded_amount_cents: number | null;
  refunded_at: string | null;
};

type PassDbRow = {
  product_slug: string;
  amount_cents: number;
  currency: string | null;
  country: string | null;
  vat_number: string | null;
  bumps: string | null;
  refunded_amount_cents: number | null;
};

const ENDED_SUB = ['canceled', 'incomplete_expired'];
const STANDING_ORDER: Record<MonthlyStanding, number> = { behind: 0, renews: 1, ending: 2 };
const DAY_MS = 86_400_000;

export async function computeLivePassStats(
  db: D1Database,
  opts: { from?: string | null; to?: string | null; money?: MoneyOpts } = {},
): Promise<LivePassStats> {
  const from = opts.from ?? null;
  const to = opts.to ?? null;
  const inWindow = (day: string) => !!day && (!from || day >= from) && (!to || day <= to);
  const fxRates = opts.money?.fxRates ?? (await getFxRatesToEur(db));
  const today = brusselsToday();

  const monthlies =
    (
      await db
        .prepare(
          `SELECT * FROM course_registrations
            WHERE product_slug = ? AND status NOT IN ('pending','expired') AND installments_paid > 0`,
        )
        .bind(LIVE_PASS_MONTHLY_SLUG)
        .all<MonthlyDbRow>()
    ).results ?? [];

  const bounds = businessWindowUtc(from, to);
  const passWhere = [
    `product_slug IN (${LIVE_PASS_MONTHS.map(() => '?').join(',')})`,
    'paid_at IS NOT NULL',
    "status NOT IN ('pending','expired')",
  ];
  const passBinds: unknown[] = LIVE_PASS_MONTHS.map(livePassSlug);
  if (bounds.start) { passWhere.push('paid_at >= ?'); passBinds.push(bounds.start); }
  if (bounds.end) { passWhere.push('paid_at < ?'); passBinds.push(bounds.end); }
  const passes =
    (
      await db
        .prepare(
          `SELECT product_slug, amount_cents, currency, country, vat_number, bumps, refunded_amount_cents
             FROM course_registrations WHERE ${passWhere.join(' AND ')}`,
        )
        .bind(...passBinds)
        .all<PassDbRow>()
    ).results ?? [];

  // Cancels and resumes made on the site, oldest first, so the last one wins.
  const events =
    (
      await db
        .prepare(
          `SELECT kind, payload_json, created_at FROM events
            WHERE kind IN ('live_pass.monthly.cancelled','live_pass.monthly.resumed','live_pass.monthly.stopped')
            ORDER BY id`,
        )
        .all<{ kind: string; payload_json: string | null; created_at: string }>()
    ).results ?? [];

  const taxRates = await resolveCourseTaxRates([...monthlies, ...passes], opts.money?.taxCfg);
  const net = (minor: number, row: { country: string | null; vat_number: string | null; currency: string | null }) =>
    courseNetEur(minor, row, taxRates, fxRates).eurMinor;

  const lastAction = new Map<number, string>();
  const cancelledIds = new Set<number>();
  const stoppedIds = new Set<number>();
  for (const e of events) {
    let id = 0;
    try {
      id = Number(JSON.parse(e.payload_json ?? '{}').course_registration_id) || 0;
    } catch {}
    if (!id) continue;
    if (e.kind === 'live_pass.monthly.stopped') {
      if (inWindow(businessDayOf(e.created_at))) stoppedIds.add(id);
      continue;
    }
    lastAction.set(id, e.kind);
    if (e.kind === 'live_pass.monthly.cancelled' && inWindow(businessDayOf(e.created_at))) cancelledIds.add(id);
  }

  const monthly: LivePassStats['monthly'] = {
    renewing: 0,
    behind: 0,
    ending: 0,
    monthlyEurMinor: 0,
    started: 0,
    cancelled: cancelledIds.size,
    stopped: stoppedIds.size,
    charges: 0,
    cashEurMinor: 0,
    rows: [],
  };

  for (const r of monthlies) {
    const startedOn = businessDayOf(r.paid_at);
    if (inWindow(startedOn)) monthly.started += 1;

    // Each month on the calendar schedule the gateways bill on, the first one
    // carrying the first month's extra; refunds come off on the day they went back.
    const saleMs = r.paid_at ? Date.parse(r.paid_at.includes('T') ? r.paid_at : `${r.paid_at.replace(' ', 'T')}Z`) : NaN;
    if (Number.isFinite(saleMs)) {
      const extra = monthlyFirstMonthExtraCents(r.bumps);
      for (let k = 0; k < r.installments_paid; k++) {
        if (!inWindow(businessDayOf(addMonths(saleMs, k) + (saleMs % DAY_MS)))) continue;
        monthly.charges += 1;
        monthly.cashEurMinor += net(r.amount_cents + (k === 0 ? extra : 0), r);
      }
    }
    if ((r.refunded_amount_cents ?? 0) > 0 && r.refunded_at && inWindow(businessDayOf(r.refunded_at))) {
      monthly.cashEurMinor -= net(r.refunded_amount_cents ?? 0, r);
    }

    const through = monthlyPaidThroughDay(r);
    const closed = r.status !== 'paid' || ENDED_SUB.includes(r.subscription_status ?? '');
    let standing: MonthlyStanding | null;
    if (closed) {
      // PayPal is cancelled at once and the row with it; the paid month still runs.
      standing = r.status === 'cancelled' && through && through > today ? 'ending' : null;
    } else if (lastAction.get(r.id) === 'live_pass.monthly.cancelled') {
      standing = 'ending'; // Stripe, cancelled at period end
    } else if (r.subscription_status === 'past_due' || r.subscription_status === 'unpaid') {
      standing = 'behind';
    } else {
      standing = 'renews';
    }
    if (!standing) continue;

    if (standing === 'renews') {
      monthly.renewing += 1;
      monthly.monthlyEurMinor += net(r.amount_cents, r);
    } else if (standing === 'behind') {
      monthly.behind += 1;
    } else {
      monthly.ending += 1;
    }
    monthly.rows.push({
      id: r.id,
      name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || r.email,
      email: r.email,
      provider: r.provider === 'paypal' ? 'paypal' : 'stripe',
      startedOn,
      monthsCharged: r.installments_paid,
      priceMinor: r.amount_cents,
      currency: (r.currency || 'EUR').toUpperCase(),
      through,
      standing,
    });
  }
  monthly.cashEurMinor = Math.max(0, monthly.cashEurMinor);
  monthly.rows.sort(
    (a, b) => STANDING_ORDER[a.standing] - STANDING_ORDER[b.standing] || (a.through ?? '').localeCompare(b.through ?? ''),
  );

  // Passes: the pass and its add-on, a refund off the pass first (as the money
  // reports take it), so the two never count the same euro.
  const lengths = new Map<LivePassMonths, { count: number; eurMinor: number }>(
    LIVE_PASS_MONTHS.map((m) => [m, { count: 0, eurMinor: 0 }]),
  );
  const out: LivePassStats['passes'] = {
    byLength: [],
    count: 0,
    eurMinor: 0,
    extensionCount: 0,
    extensionEurMinor: 0,
  };
  for (const p of passes) {
    const months = livePassMonthsOf(p.product_slug);
    if (!months) continue;
    const ext = parsePurchasedBumps(p.bumps)
      .filter((b) => b.slug === CERT_EXTENSION_SLUG)
      .reduce((s, b) => s + Math.max(0, b.amount_cents), 0);
    const refund = Math.max(0, p.refunded_amount_cents ?? 0);
    const passEur = net(Math.max(0, p.amount_cents - refund), p);
    const extEur = net(Math.max(0, ext - Math.max(0, refund - p.amount_cents)), p);
    const l = lengths.get(months)!;
    l.count += 1;
    l.eurMinor += passEur;
    out.count += 1;
    out.eurMinor += passEur + extEur;
    if (ext > 0) {
      out.extensionCount += 1;
      out.extensionEurMinor += extEur;
    }
  }
  out.byLength = LIVE_PASS_MONTHS.map((m) => ({ months: m, contents: livePassContents(m), ...lengths.get(m)! }));

  return { monthly, passes: out };
}
