// Shared, idempotent fulfilment for a Stripe course installment invoice.
//
// This is the single place that turns "a Stripe invoice for a course
// subscription has settled" into our side effects: bump installments_paid,
// grant access on the first cycle, hand off to Drip, and send the internal
// SD-ORDER notification. Both the Stripe webhook (invoice.paid +
// checkout.session.completed backstop) AND the hourly safety-net reconcile
// (src/lib/payments/stripe-reconcile.ts) call it, so recognition converges
// no matter which path sees the money first.
//
// Idempotency is keyed on the Stripe invoice id: we log a
// `course.installment.recorded` event with the invoice id as `external_id`
// the first time, and every later caller for the same invoice becomes a
// no-op. That guard is what makes the webhook and the reconcile safe to both
// run against the same charge.

import {
  getCourseRegistrationById,
  type CourseRegistration,
  recordInstallmentPaid,
} from './db';
import { effectiveTotal } from './installment-forecast';
import { logEvent } from '../registrations/db';
import {
  pushPaidCourseRegistrationToDrip,
  type CoursePaidHandlerEnv,
} from './paid-handler';
import { setSubscriptionCancelAtPeriodEnd } from '../registrations/stripe';
import { notifyCourseOrder, type OrderEnv } from '../orders/notification';

// The union of everything the fulfilment side effects need: the Drip handoff
// (CoursePaidHandlerEnv) and the SD-ORDER notification (OrderEnv). The worker's
// full `Env` satisfies both, so callers just pass `env`.
export type StripeCourseFulfillEnv = CoursePaidHandlerEnv &
  OrderEnv & { STRIPE_SECRET_KEY?: string };

// The plan just took its last installment — tell Stripe to stop at the end of
// the period it's now in. This is the proration-free stop (a cancel_at
// timestamp can only be exact if it lands precisely on the billing boundary;
// `cancel_at_period_end` is that boundary by definition), and it makes the
// plan's end correct even for a subscription whose scheduled cancel_at was
// never set or was set wrong. Best-effort: the money is already recorded, and
// the scheduled cancel_at plus the hourly reconcile's schedule repair both
// still bound the plan if this call fails.
async function stopSubscriptionAtPeriodEnd(
  env: StripeCourseFulfillEnv,
  courseRegId: number,
): Promise<void> {
  const reg = await getCourseRegistrationById(env.DB, courseRegId);
  if (!reg || reg.provider === 'paypal') return;
  if (!reg.stripe_subscription_id || !env.STRIPE_SECRET_KEY) return;
  if (reg.installments_total <= 1) return;
  if (reg.installments_paid < effectiveTotal(reg)) return;
  if (
    reg.subscription_status === 'canceled' ||
    reg.subscription_status === 'incomplete_expired'
  ) {
    return;
  }
  try {
    await setSubscriptionCancelAtPeriodEnd(
      env.STRIPE_SECRET_KEY,
      reg.stripe_subscription_id,
    );
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'course.subscription.completed',
      source: 'system',
      external_id: `course-plan-complete-${reg.stripe_subscription_id}`,
      payload: {
        course_registration_id: reg.id,
        subscription_id: reg.stripe_subscription_id,
        installments_paid: reg.installments_paid,
        installments_total: reg.installments_total,
      },
    });
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'course.subscription.completed.failed',
      source: 'system',
      payload: {
        course_registration_id: reg.id,
        subscription_id: reg.stripe_subscription_id,
        error: String(err),
      },
    });
  }
}

// Dedup-on-invoice-id wrapper around recordInstallmentPaid. Both `invoice.paid`
// and the `checkout.session.completed` subscription backstop (and now the
// hourly reconcile) can land on the same first invoice; we log a
// `course.installment.recorded` event with the Stripe invoice id as
// `external_id` so the second caller becomes a no-op. Returns true if this call
// actually bumped the count.
export async function recordCourseInvoiceIfNew(
  env: StripeCourseFulfillEnv,
  courseReg: CourseRegistration,
  invoiceId: string,
  paymentIntent: string | null,
): Promise<boolean> {
  const already = await env.DB
    .prepare(
      `SELECT 1 AS one FROM events
        WHERE kind = 'course.installment.recorded'
          AND external_id = ?`,
    )
    .bind(invoiceId)
    .first<{ one: number }>();
  if (already) return false;

  const wasFirstPayment = courseReg.installments_paid === 0;
  await recordInstallmentPaid(env.DB, courseReg.id, paymentIntent);
  await logEvent(env.DB, {
    registration_id: null,
    kind: 'course.installment.recorded',
    source: 'system',
    external_id: invoiceId,
    payload: {
      course_registration_id: courseReg.id,
      invoice_id: invoiceId,
      payment_intent: paymentIntent,
    },
  });
  if (wasFirstPayment) {
    await pushPaidCourseRegistrationToDrip(env, courseReg.id);
    // Internal SD-ORDER notification (idempotent; never blocks fulfilment).
    await notifyCourseOrder(env, courseReg, {
      stripePaymentIntent: paymentIntent,
      stripeSubscriptionId: courseReg.stripe_subscription_id,
    });
  }
  // If that was the plan's final installment, close the subscription at the
  // period boundary (no proration, no further charge). Re-reads the row so the
  // just-incremented count is the one we test.
  await stopSubscriptionAtPeriodEnd(env, courseReg.id);
  return true;
}
