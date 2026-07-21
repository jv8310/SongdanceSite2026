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
  type CourseRegistration,
  recordInstallmentPaid,
} from './db';
import { logEvent } from '../registrations/db';
import {
  pushPaidCourseRegistrationToDrip,
  type CoursePaidHandlerEnv,
} from './paid-handler';
import { notifyCourseOrder, type OrderEnv } from '../orders/notification';

// The union of everything the fulfilment side effects need: the Drip handoff
// (CoursePaidHandlerEnv) and the SD-ORDER notification (OrderEnv). The worker's
// full `Env` satisfies both, so callers just pass `env`.
export type StripeCourseFulfillEnv = CoursePaidHandlerEnv & OrderEnv;

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
  return true;
}
