// Safety-net reconcile for Stripe course installment plans — the Stripe sibling
// of src/lib/payments/paypal-reconcile.ts.
//
// WHY THIS EXISTS. A Stripe course installment subscription's cycles are
// recorded by the `invoice.paid` webhook, with a single backstop at
// `checkout.session.completed` (the webhook reads the subscription's
// latest_invoice and records it if it's already paid). Both can miss the first
// charge: the checkout backstop only fires once, at completion — if the opening
// invoice hadn't settled *at that instant* (an async method like SEPA debit, or
// a few seconds' delay) it records nothing; and if the endpoint isn't subscribed
// to `invoice.paid` (or a delivery is dropped, or the endpoint's pinned API
// version renders an invoice shape the handler can't route), no later event ever
// bumps the count. Meanwhile `customer.subscription.updated` DOES flip the row's
// subscription_status to 'active', so the plan sits at 0/N, paid_at NULL, coarse
// status still pending/expired — "ACTIVE" in Stripe, "Not started" for us —
// while Stripe keeps charging the customer every month.
//
// THE SAME HOLE OPENS MID-PLAN, and that one was live until July 2026: the
// sweep only ever looked at rows stuck at 0/N. A plan whose FIRST cycle was
// recorded (by the checkout backstop) and whose later cycles were not sits at
// status 'paid', so nothing re-checked it — a €349×3 certification plan showed
// "1/3 paid · 2 left" on the future-revenue page, and counted a third of its
// revenue in the sales digests, while Stripe had charged all three. This sweep
// therefore covers BOTH: stranded rows (0/N, pending/expired) and open plans
// whose next installment is overdue.
//
// IT ALSO REPAIRS THE SCHEDULE. An installment plan is bounded by a `cancel_at`
// on the subscription, and that timestamp has to sit exactly on the billing
// boundary after the last installment: inside the final period, Stripe prorates
// that invoice (the plans created before the fix were charging ~30-50% of the
// final installment); past the boundary, it bills one more time. Every open plan
// we touch gets its cancel_at re-pinned to `billing_cycle_anchor + N months`
// (N = the effective plan length, honouring an admin-scheduled early stop), so
// live plans created under the old math are corrected before their final
// invoice is generated.
//
// SAFETY. Read-only against Stripe except for that cancel_at repair (which can
// only ever move the stop TO the correct boundary — it never extends a plan
// beyond its agreed number of charges, and never touches a subscription Stripe
// reports as canceled). It records only invoices Stripe reports as paid, and
// funnels everything through recordCourseInvoiceIfNew (guarded on the invoice id
// in the events log) — so a later-arriving webhook can never double-count and a
// genuinely abandoned checkout is a no-op. It respects an admin cancel/refund
// (never resurrects such a row: a refunded row is skipped outright, and a
// cancelled one is only counted up, never granted access), never performs the
// terminal cancelled flip itself (that's the webhook's job), and tolerates
// per-row Stripe errors so one bad row can't sink the sweep. No-ops entirely
// until STRIPE_SECRET_KEY is set. Steady state (webhook healthy) finds nothing.

import {
  addMonthsUnix,
  listSubscriptionInvoices,
  retrieveSubscriptionWithLatestInvoice,
  setSubscriptionCancelAt,
  setSubscriptionCancelAtPeriodEnd,
} from '../registrations/stripe';
import {
  getCourseRegistrationById,
  updateCourseSubscriptionStatus,
  type CourseRegistration,
  type SubscriptionStatus,
} from '../courses/db';
import { effectiveTotal } from '../courses/installment-forecast';
import {
  recordCourseInvoiceIfNew,
  type StripeCourseFulfillEnv,
} from '../courses/stripe-fulfill';
import { logEvent } from '../registrations/db';

export type StripeReconcileEnv = StripeCourseFulfillEnv & {
  STRIPE_SECRET_KEY?: string;
};

export type StripeReconcileResult = {
  subscriptions: number; // plans that gained ≥1 installment this run
  installments: number; // total installment cycles recorded this run
  schedulesRepaired: number; // plans whose cancel_at was re-pinned
};

// A subscription row leaves the stranded set (pending/expired) the moment its
// first cycle is recorded, so this window governs how far back we still look for
// one — wide (120 days) so a stall that went unnoticed for weeks is still
// recovered; the first cycle it needs always settled within days of checkout,
// regardless of plan length (3×/6×/12×). Mirrors the PayPal reconcile.
const SUB_DAYS = 120;
// Open plans are chased for as long as one can run plus slack: a 12× plan
// started 13 months ago may still owe its last charge.
const OPEN_DAYS = 500;
const DEFAULT_CAP = 25;
// How late an installment must be before we spend a Stripe call on it. Stripe
// bills within an hour or so of the anchor and the webhook records it
// immediately; a couple of days' grace keeps a healthy plan out of the sweep
// while still catching a stall on the next tick.
const OVERDUE_GRACE_DAYS = 2;
// cancel_at within this many seconds of the correct boundary is left alone
// (clock/rounding noise, not drift).
const SCHEDULE_TOLERANCE_S = 120;

// Stripe's live Subscription.status enum — the values we're willing to mirror
// onto the row. (We deliberately never let the sweep apply 'canceled' /
// 'incomplete_expired' terminal flips; that's the webhook's job.)
const MIRRORABLE_STATUSES = new Set<SubscriptionStatus>([
  'incomplete',
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'paused',
]);

async function strandedStripeCourseSubRows(
  db: D1Database,
  dayModifier: string,
  cap: number,
): Promise<CourseRegistration[]> {
  // provider = 'stripe' is essential: unpaid PayPal rows also land in these
  // statuses and must never be polled against Stripe. Recording is safe on
  // either status (recordInstallmentPaid flips it to 'paid'), and a genuinely
  // abandoned row simply has no paid Stripe invoice to find.
  const res = await db
    .prepare(
      `SELECT * FROM course_registrations
        WHERE provider = 'stripe'
          AND status IN ('pending', 'expired')
          AND payment_plan <> 'full'
          AND stripe_subscription_id IS NOT NULL
          AND created_at >= datetime('now', ?)
        ORDER BY created_at ASC
        LIMIT ?`,
    )
    .bind(dayModifier, cap)
    .all<CourseRegistration>();
  return res.results ?? [];
}

// Open plans: at least one installment recorded, at least one still owed. Cheap
// (one indexed query, no Stripe calls) — the overdue test that decides whether
// a row is worth polling happens in JS, against the same calendar-month
// schedule the forecast projects.
async function openStripeCoursePlanRows(
  db: D1Database,
  dayModifier: string,
): Promise<CourseRegistration[]> {
  const res = await db
    .prepare(
      `SELECT * FROM course_registrations
        WHERE provider = 'stripe'
          AND status IN ('paid', 'cancelled')
          AND installments_total > 1
          AND installments_paid > 0
          AND installments_paid < installments_total
          AND stripe_subscription_id IS NOT NULL
          AND paid_at IS NOT NULL
          AND created_at >= datetime('now', ?)
        ORDER BY paid_at ASC`,
    )
    .bind(dayModifier)
    .all<CourseRegistration>();
  return res.results ?? [];
}

// Is the next installment on this plan late enough to be worth a Stripe call?
// Installment k (0-indexed) falls due `paid_at + k months`, so the next one is
// at index installments_paid.
function nextInstallmentOverdue(row: CourseRegistration, nowMs: number): boolean {
  if (row.installments_paid >= effectiveTotal(row)) return false;
  const anchor = row.paid_at ? Date.parse(row.paid_at) : NaN;
  if (!Number.isFinite(anchor)) return false;
  const dueUnix = addMonthsUnix(
    Math.floor(anchor / 1000),
    row.installments_paid,
  );
  return dueUnix * 1000 + OVERDUE_GRACE_DAYS * 86400_000 <= nowMs;
}

// Record every settled cycle Stripe knows about that we haven't. Returns how
// many this call added.
async function recordSettledInvoices(
  env: StripeReconcileEnv,
  row: CourseRegistration,
  subscriptionId: string,
): Promise<number> {
  const invoices = await listSubscriptionInvoices(
    env.STRIPE_SECRET_KEY as string,
    subscriptionId,
    { status: 'paid' },
  );
  // Money actually in the bank. Oldest first so the first-cycle side effects
  // (access + Drip + SD-ORDER) fire on the genuine first invoice exactly once.
  const settled = invoices
    .filter((inv) => inv.paid || inv.status === 'paid')
    .sort((a, b) => a.created - b.created);
  if (settled.length === 0) return 0;

  let recorded = 0;
  for (const inv of settled) {
    // Re-fetch each iteration so installments_paid (and thus the "was this the
    // first cycle?" test inside the recorder) is fresh across a multi-cycle
    // backlog — otherwise every cycle looks like #1.
    const fresh = await getCourseRegistrationById(env.DB, row.id);
    if (!fresh) break;
    // Respect a genuine admin refund — never resurrect it. A 'cancelled' row is
    // allowed to count up (that's how a plan that ended mid-flight records the
    // charges it did take, and how a naturally-completed plan misfiled as
    // cancelled gets its true count) but recordInstallmentPaid preserves the
    // cancelled status, and the caller only ever hands us rows that already
    // have ≥1 installment, so no access is ever granted from here.
    if (fresh.status === 'refunded') break;
    if (fresh.status === 'cancelled' && fresh.installments_paid === 0) break;
    const did = await recordCourseInvoiceIfNew(
      env,
      fresh,
      inv.id,
      inv.payment_intent,
    );
    if (did) recorded += 1;
  }
  return recorded;
}

// Does this cancel_at look like one of the two timestamps the old (buggy)
// scheduling math produced?
//
// This test is what makes the repair safe to run unattended. A cancel_at we
// don't recognise may be a deliberate stop the owner set by hand in the Stripe
// dashboard, and pushing that one out to the plan's full length would re-enable
// charges they cancelled. So we only ever correct a timestamp that is
// recognisably the bug:
//
//   • checkout   — `subscription created + ((N-1)×30 + 15) days`, set by the
//     webhook from its own clock a beat after the subscription was created
//     (hence the generous upper tolerance);
//   • admin stop — `paid_at + (total-1) months + 15 days`, the same "a fortnight
//     after the last charge" idea in installment-cancel.ts.
//
// Both sit ~10-16 days inside the final billing period, nowhere near the correct
// boundary, so the tolerance windows can't collide with a healthy schedule.
function looksLikeLegacyCancelAt(
  cancelAt: number,
  anchorUnix: number,
  paidAtUnix: number | null,
  fullTotal: number,
  effTotal: number,
): boolean {
  const near = (base: number) => cancelAt >= base - 60 && cancelAt <= base + 1800;
  if (near(anchorUnix + ((fullTotal - 1) * 30 + 15) * 86400)) return true;
  if (
    paidAtUnix != null &&
    near(addMonthsUnix(paidAtUnix, effTotal - 1) + 15 * 86400)
  ) {
    return true;
  }
  return false;
}

// Re-pin the subscription's cancel_at to the billing boundary after the plan's
// last installment. Returns true if Stripe was actually changed.
async function repairSchedule(
  env: StripeReconcileEnv,
  row: CourseRegistration,
  subscriptionId: string,
): Promise<boolean> {
  const fresh = (await getCourseRegistrationById(env.DB, row.id)) ?? row;
  const total = effectiveTotal(fresh);
  if (fresh.installments_total <= 1) return false;
  if (fresh.status === 'refunded') return false;

  const sub = await retrieveSubscriptionWithLatestInvoice(
    env.STRIPE_SECRET_KEY as string,
    subscriptionId,
  );
  // Nothing to schedule on a subscription that has already stopped, and never
  // touch one the owner has explicitly told Stripe to end at the period end.
  if (sub.status === 'canceled' || sub.status === 'incomplete_expired') {
    return false;
  }
  if (sub.cancel_at_period_end) return false;
  if (!sub.billing_cycle_anchor) return false;

  // The plan has taken everything it owes. If Stripe already has a stop
  // scheduled, leave it exactly as it is — it will end on its own, and moving
  // a live subscription's end date buys nothing once the money is in. Only a
  // plan with no stop at all needs one, at the current period end
  // (proration-free, and valid where a past timestamp would be rejected).
  if (fresh.installments_paid >= total) {
    if (sub.cancel_at != null) return false;
    await setSubscriptionCancelAtPeriodEnd(
      env.STRIPE_SECRET_KEY as string,
      subscriptionId,
    );
    return true;
  }

  const correct = addMonthsUnix(sub.billing_cycle_anchor, total);
  if (correct <= Math.floor(Date.now() / 1000) + 60) return false;
  if (sub.cancel_at != null) {
    if (Math.abs(sub.cancel_at - correct) <= SCHEDULE_TOLERANCE_S) return false;
    // Only correct a stop we can positively identify as the old math's — see
    // looksLikeLegacyCancelAt. Anything else is left for a human.
    const paidAtUnix = fresh.paid_at ? Math.floor(Date.parse(fresh.paid_at) / 1000) : null;
    if (
      !looksLikeLegacyCancelAt(
        sub.cancel_at,
        sub.billing_cycle_anchor,
        Number.isFinite(paidAtUnix as number) ? paidAtUnix : null,
        fresh.installments_total,
        total,
      )
    ) {
      return false;
    }
  }
  await setSubscriptionCancelAt(
    env.STRIPE_SECRET_KEY as string,
    subscriptionId,
    correct,
  );
  await logEvent(env.DB, {
    registration_id: null,
    kind: 'course.subscription.cancel_at.repaired',
    source: 'system',
    payload: {
      course_registration_id: fresh.id,
      subscription_id: subscriptionId,
      was: sub.cancel_at,
      now: correct,
      installments_total: total,
    },
  });
  return true;
}

export async function reconcileStripeCourseOrders(
  env: StripeReconcileEnv,
  opts: { subDays?: number; cap?: number } = {},
): Promise<StripeReconcileResult> {
  const result: StripeReconcileResult = {
    subscriptions: 0,
    installments: 0,
    schedulesRepaired: 0,
  };
  // No-op until the Stripe key exists (mirrors the PayPal reconcile's gate).
  if (!env.STRIPE_SECRET_KEY) return result;

  const cap = Math.max(1, Math.floor(opts.cap ?? DEFAULT_CAP));
  const subMod = `-${Math.max(1, Math.floor(opts.subDays ?? SUB_DAYS))} days`;
  const nowMs = Date.now();

  // ── Pass 1: plans stuck at 0/N (never recognised at all) ──
  for (const row of await strandedStripeCourseSubRows(env.DB, subMod, cap)) {
    const subscriptionId = row.stripe_subscription_id;
    if (!subscriptionId) continue;
    try {
      const recorded = await recordSettledInvoices(env, row, subscriptionId);
      if (recorded > 0) {
        result.subscriptions += 1;
        result.installments += recorded;
        // Mirror the live subscription status onto the row (cosmetic — the
        // money is already recorded). Only the non-terminal states; leave the
        // cancelled/expired flip to the webhook so we never cancel a plan.
        try {
          const sub = await retrieveSubscriptionWithLatestInvoice(
            env.STRIPE_SECRET_KEY,
            subscriptionId,
          );
          const status = sub.status as SubscriptionStatus;
          if (MIRRORABLE_STATUSES.has(status)) {
            await updateCourseSubscriptionStatus(env.DB, subscriptionId, status);
          }
        } catch {
          // Status mirror is cosmetic; the money is already recorded.
        }
      }
      if (await repairSchedule(env, row, subscriptionId)) {
        result.schedulesRepaired += 1;
      }
    } catch {
      // Transient Stripe error / rate limit — leave the row for the next tick.
      // The whole sweep must never throw on one bad row.
      continue;
    }
  }

  // ── Pass 2: open plans whose next installment is overdue ──
  // These are the mid-plan stalls: money charged by Stripe, never recorded
  // here. A healthy plan is filtered out before any Stripe call.
  const openMod = `-${OPEN_DAYS} days`;
  const openRows = (await openStripeCoursePlanRows(env.DB, openMod))
    .filter((row) => nextInstallmentOverdue(row, nowMs))
    .slice(0, cap);
  for (const row of openRows) {
    const subscriptionId = row.stripe_subscription_id;
    if (!subscriptionId) continue;
    try {
      const recorded = await recordSettledInvoices(env, row, subscriptionId);
      if (recorded > 0) {
        result.subscriptions += 1;
        result.installments += recorded;
      }
      if (await repairSchedule(env, row, subscriptionId)) {
        result.schedulesRepaired += 1;
      }
    } catch {
      continue;
    }
  }

  return result;
}
