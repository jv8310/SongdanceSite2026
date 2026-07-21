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
// to `invoice.paid` (or a delivery is dropped), no later event ever bumps the
// count. Meanwhile `customer.subscription.updated` DOES flip the row's
// subscription_status to 'active', so the plan sits at 0/N, paid_at NULL, coarse
// status still pending/expired — "ACTIVE" in Stripe, "Not started" for us —
// while Stripe keeps charging the customer every month. No access, no SD-ORDER,
// no Drip, no automated recovery.
//
// WHAT IT DOES. Wired into the hourly cron (beside reconcilePaypalCourseOrders),
// each tick it finds stranded Stripe *course subscription* rows — provider
// 'stripe', a non-full plan with a subscription id, coarse status 'pending' OR
// 'expired' — in a recent window, lists each subscription's paid invoices from
// Stripe, and records every settled cycle through the SAME idempotent path the
// webhook uses (recordCourseInvoiceIfNew, guarded on the invoice id in the
// events log). ('expired' matters: expireStaleCoursePendings flips any pending
// course row to 'expired' after 15 minutes, so a stranded subscription usually
// sits in 'expired', not 'pending'.)
//
// SAFETY. It is read-only against Stripe (it never creates a charge or a
// subscription), records only invoices Stripe reports as paid, and funnels
// everything through recordCourseInvoiceIfNew — so a later-arriving webhook can
// never double-count and a genuinely abandoned checkout (no paid invoice) is a
// no-op. It respects an admin cancel/refund (never resurrects such a row), never
// performs the terminal cancelled flip itself (that's the webhook's job), and
// tolerates per-row Stripe errors so one bad row can't sink the sweep. No-ops
// entirely until STRIPE_SECRET_KEY is set. Steady state (webhook healthy) finds
// nothing.

import {
  listSubscriptionInvoices,
  retrieveSubscriptionWithLatestInvoice,
} from '../registrations/stripe';
import {
  getCourseRegistrationById,
  updateCourseSubscriptionStatus,
  type CourseRegistration,
  type SubscriptionStatus,
} from '../courses/db';
import {
  recordCourseInvoiceIfNew,
  type StripeCourseFulfillEnv,
} from '../courses/stripe-fulfill';

export type StripeReconcileEnv = StripeCourseFulfillEnv & {
  STRIPE_SECRET_KEY?: string;
};

export type StripeReconcileResult = {
  subscriptions: number; // stranded subscription rows that gained ≥1 installment
  installments: number; // total installment cycles recorded this run
};

// A subscription row leaves the stranded set (pending/expired) the moment its
// first cycle is recorded, so this window governs how far back we still look for
// one — wide (120 days) so a stall that went unnoticed for weeks is still
// recovered; the first cycle it needs always settled within days of checkout,
// regardless of plan length (3×/6×/12×). Mirrors the PayPal reconcile.
const SUB_DAYS = 120;
const DEFAULT_CAP = 25;

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

export async function reconcileStripeCourseOrders(
  env: StripeReconcileEnv,
  opts: { subDays?: number; cap?: number } = {},
): Promise<StripeReconcileResult> {
  const result: StripeReconcileResult = { subscriptions: 0, installments: 0 };
  // No-op until the Stripe key exists (mirrors the PayPal reconcile's gate).
  if (!env.STRIPE_SECRET_KEY) return result;

  const cap = Math.max(1, Math.floor(opts.cap ?? DEFAULT_CAP));
  const subMod = `-${Math.max(1, Math.floor(opts.subDays ?? SUB_DAYS))} days`;

  const rows = await strandedStripeCourseSubRows(env.DB, subMod, cap);
  for (const row of rows) {
    const subscriptionId = row.stripe_subscription_id;
    if (!subscriptionId) continue;
    try {
      const invoices = await listSubscriptionInvoices(
        env.STRIPE_SECRET_KEY,
        subscriptionId,
        { status: 'paid' },
      );
      // Money actually in the bank. Oldest first so the first-cycle side effects
      // (access + Drip + SD-ORDER) fire on the genuine first invoice exactly
      // once.
      const settled = invoices
        .filter((inv) => inv.paid || inv.status === 'paid')
        .sort((a, b) => a.created - b.created);
      if (settled.length === 0) continue;

      let recorded = 0;
      for (const inv of settled) {
        // Re-fetch each iteration so installments_paid (and thus the "was this
        // the first cycle?" test inside the recorder) is fresh across a
        // multi-cycle backlog — otherwise every cycle looks like #1.
        const fresh = await getCourseRegistrationById(env.DB, row.id);
        if (!fresh) break;
        // Respect a genuine admin cancel / refund — never resurrect it.
        if (fresh.status === 'cancelled' || fresh.status === 'refunded') break;
        const did = await recordCourseInvoiceIfNew(
          env,
          fresh,
          inv.id,
          inv.payment_intent,
        );
        if (did) {
          recorded += 1;
          result.installments += 1;
        }
      }

      if (recorded > 0) {
        result.subscriptions += 1;
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
    } catch {
      // Transient Stripe error / rate limit — leave the row for the next tick.
      // The whole sweep must never throw on one bad row.
      continue;
    }
  }

  return result;
}
