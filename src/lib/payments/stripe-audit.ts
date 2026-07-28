// Installment audit — every Stripe course payment plan, checked against Stripe.
//
// The reconcile (stripe-reconcile.ts) FIXES what it can reach. This answers the
// separate question: is what Stripe actually charged what the plan was sold
// for, and does our mirror agree? It is strictly read-only — it reports, and
// the owner decides what to do about a discrepancy.
//
// It exists because two failures on the same plan are individually silent and
// only visible side by side:
//
//   • UNDER-CHARGED — Stripe collected less than the plan's per-installment
//     amount for a cycle. That's what a mis-scheduled `cancel_at` did: landing
//     inside the final billing period, it made Stripe prorate the last invoice
//     down to the days before the cancellation (a €349 installment settling at
//     €157.62 — 14 days of a 31-day period). The money is simply not there, and
//     nothing in our own data shows it: our row multiplies the per-installment
//     amount by the count.
//   • UNRECORDED — Stripe charged a cycle we never wrote down, so the
//     future-revenue page still lists it as owed and the sales digests
//     under-report the cash actually collected.
//
// Both are computed per plan from Stripe's own paid invoices. A first invoice
// that also carried one-off order bumps is *larger* than one installment, so
// only shortfalls are reported (an over-amount is never flagged as a problem).
//
// It also reports webhook health: how many `invoice.paid` events the endpoint
// has actually delivered versus how many installments were recorded. Zero
// delivered events over a window in which plans have been billing means the
// endpoint isn't subscribed to `invoice.paid` at all — the root cause behind
// every stalled plan, and not otherwise visible from inside the app.

import {
  addMonthsUnix,
  listSubscriptionInvoices,
  retrieveSubscriptionWithLatestInvoice,
} from '../registrations/stripe';
import {
  type CourseRegistration,
} from '../courses/db';
import { effectiveTotal } from '../courses/installment-forecast';

export type StripeAuditEnv = {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
} & Record<string, unknown>;

export type PlanAudit = {
  id: number;
  name: string;
  email: string;
  plan: string; // '3×'
  currency: string;
  status: string;
  subscriptionStatus: string | null;
  subscriptionId: string;
  // Our mirror vs Stripe.
  recorded: number; // installments_paid on the row
  settled: number; // paid invoices Stripe reports
  expectedTotal: number; // effective plan length
  perInstallmentMinor: number; // gross, plan currency
  chargedMinor: number; // sum of Stripe's paid invoices
  expectedChargedMinor: number; // per-installment × settled invoices
  shortfallMinor: number; // sum of per-cycle shortfalls (proration)
  shortInvoices: Array<{
    id: string;
    number: string | null;
    date: string;
    paidMinor: number;
    expectedMinor: number;
  }>;
  // Schedule health.
  cancelAt: number | null;
  correctCancelAt: number | null;
  scheduleOk: boolean;
  issues: string[]; // 'unrecorded' | 'undercharged' | 'schedule'
  error?: string;
};

export type WebhookHealth = {
  windowDays: number;
  invoicePaidEvents: number; // invoice.paid deliveries logged
  installmentsRecorded: number; // course.installment.recorded events
  unlinkedInvoices: number; // invoice.paid we could not route
  subscriptionEvents: number; // customer.subscription.* deliveries
};

export type InstallmentAudit = {
  configured: boolean;
  plans: PlanAudit[];
  checked: number;
  withIssues: number;
  totalShortfallByCurrency: Record<string, number>;
  unrecordedInstallments: number;
  webhook: WebhookHealth;
};

const WINDOW_DAYS = 500;
const HEALTH_WINDOW_DAYS = 90;

function fullName(r: CourseRegistration): string {
  return `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || r.email;
}

// Every Stripe installment plan that has ever charged, newest first. A plan
// with no subscription id has nothing to audit against.
async function auditableRows(db: D1Database): Promise<CourseRegistration[]> {
  const res = await db
    .prepare(
      `SELECT * FROM course_registrations
        WHERE provider = 'stripe'
          AND installments_total > 1
          AND stripe_subscription_id IS NOT NULL
          AND created_at >= datetime('now', ?)
        ORDER BY paid_at DESC, created_at DESC`,
    )
    .bind(`-${WINDOW_DAYS} days`)
    .all<CourseRegistration>();
  return res.results ?? [];
}

async function countEvents(
  db: D1Database,
  kinds: string[],
  days: number,
): Promise<number> {
  const placeholders = kinds.map(() => '?').join(', ');
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM events
        WHERE kind IN (${placeholders})
          AND created_at >= datetime('now', ?)`,
    )
    .bind(...kinds, `-${days} days`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function webhookHealth(db: D1Database): Promise<WebhookHealth> {
  const [invoicePaidEvents, installmentsRecorded, unlinkedInvoices, subscriptionEvents] =
    await Promise.all([
      countEvents(db, ['invoice.paid'], HEALTH_WINDOW_DAYS),
      countEvents(db, ['course.installment.recorded'], HEALTH_WINDOW_DAYS),
      countEvents(db, ['course.invoice.unlinked'], HEALTH_WINDOW_DAYS),
      countEvents(
        db,
        ['customer.subscription.updated', 'customer.subscription.deleted'],
        HEALTH_WINDOW_DAYS,
      ),
    ]);
  return {
    windowDays: HEALTH_WINDOW_DAYS,
    invoicePaidEvents,
    installmentsRecorded,
    unlinkedInvoices,
    subscriptionEvents,
  };
}

export async function auditStripeInstallmentPlans(
  env: StripeAuditEnv,
  opts: { cap?: number } = {},
): Promise<InstallmentAudit> {
  const webhook = await webhookHealth(env.DB);
  if (!env.STRIPE_SECRET_KEY) {
    return {
      configured: false,
      plans: [],
      checked: 0,
      withIssues: 0,
      totalShortfallByCurrency: {},
      unrecordedInstallments: 0,
      webhook,
    };
  }

  const cap = Math.max(1, Math.floor(opts.cap ?? 200));
  const rows = (await auditableRows(env.DB)).slice(0, cap);
  const plans: PlanAudit[] = [];

  for (const row of rows) {
    const subscriptionId = row.stripe_subscription_id as string;
    const total = effectiveTotal(row);
    const perInstallment = Math.round(row.amount_cents / row.installments_total);
    const base: PlanAudit = {
      id: row.id,
      name: fullName(row),
      email: row.email,
      plan: `${row.installments_total}×`,
      currency: (row.currency || 'EUR').toUpperCase(),
      status: row.status,
      subscriptionStatus: row.subscription_status,
      subscriptionId,
      recorded: row.installments_paid,
      settled: 0,
      expectedTotal: total,
      perInstallmentMinor: perInstallment,
      chargedMinor: 0,
      expectedChargedMinor: 0,
      shortfallMinor: 0,
      shortInvoices: [],
      cancelAt: null,
      correctCancelAt: null,
      scheduleOk: true,
      issues: [],
    };

    try {
      const invoices = (
        await listSubscriptionInvoices(env.STRIPE_SECRET_KEY, subscriptionId, {
          status: 'paid',
        })
      )
        .filter((inv) => inv.paid || inv.status === 'paid')
        .sort((a, b) => a.created - b.created);

      base.settled = invoices.length;
      base.chargedMinor = invoices.reduce((s, inv) => s + inv.amount_paid, 0);
      base.expectedChargedMinor = perInstallment * invoices.length;

      // Per-cycle shortfall. Only under-payment counts: invoice 1 legitimately
      // carries any one-off order bumps bought at checkout, so it can be larger
      // than one installment without anything being wrong.
      for (const inv of invoices) {
        const short = perInstallment - inv.amount_paid;
        if (short > 1) {
          base.shortfallMinor += short;
          base.shortInvoices.push({
            id: inv.id,
            number: inv.number,
            date: new Date(inv.created * 1000).toISOString().slice(0, 10),
            paidMinor: inv.amount_paid,
            expectedMinor: perInstallment,
          });
        }
      }
      if (base.shortfallMinor > 0) base.issues.push('undercharged');
      if (base.settled > base.recorded) base.issues.push('unrecorded');

      // Schedule: cancel_at must sit exactly on the boundary after the last
      // installment. Only meaningful while the plan still has charges to come.
      const sub = await retrieveSubscriptionWithLatestInvoice(
        env.STRIPE_SECRET_KEY,
        subscriptionId,
      );
      base.subscriptionStatus = sub.status;
      base.cancelAt = sub.cancel_at;
      const live =
        sub.status !== 'canceled' && sub.status !== 'incomplete_expired';
      if (live && sub.billing_cycle_anchor && base.settled < total) {
        const correct = addMonthsUnix(sub.billing_cycle_anchor, total);
        base.correctCancelAt = correct;
        base.scheduleOk =
          !sub.cancel_at_period_end && sub.cancel_at != null
            ? Math.abs(sub.cancel_at - correct) <= 120
            : sub.cancel_at_period_end
              ? // A period-end stop is exact by construction, but it only
                // allows one more charge — right only on the final cycle.
                base.settled >= total - 1
              : false;
        if (!base.scheduleOk) base.issues.push('schedule');
      }
    } catch (err) {
      base.error = String(err).slice(0, 200);
    }

    plans.push(base);
  }

  const totalShortfallByCurrency: Record<string, number> = {};
  let unrecordedInstallments = 0;
  for (const p of plans) {
    if (p.shortfallMinor > 0) {
      totalShortfallByCurrency[p.currency] =
        (totalShortfallByCurrency[p.currency] ?? 0) + p.shortfallMinor;
    }
    unrecordedInstallments += Math.max(0, p.settled - p.recorded);
  }

  // Problems first, then the plans that are fine.
  plans.sort((a, b) => {
    if (a.issues.length !== b.issues.length) return b.issues.length - a.issues.length;
    return b.shortfallMinor - a.shortfallMinor;
  });

  return {
    configured: true,
    plans,
    checked: plans.length,
    withIssues: plans.filter((p) => p.issues.length > 0 || p.error).length,
    totalShortfallByCurrency,
    unrecordedInstallments,
    webhook,
  };
}
