// A 100%-off course checkout has nothing to charge — Stripe Checkout cannot
// process a €0 line item. So when the owner's secret ?adiscount=100 link
// resolves to a full discount (see ./discount.ts), we fulfil the registration
// directly here, running the exact side-effects the Stripe webhook runs on a
// paid course: create the row, mark it paid, grant Drip access, and notify the
// team. The 100% level is reachable ONLY through the secret param, so a free
// link is never publicly guessable.
//
// The thanks pages resolve a registration by `stripe_session_id`, so we store a
// synthetic, unguessable token there (standing in for the absent Stripe
// session) and hand back a thanks-page URL the client redirects to — exactly
// like a paid checkout returns a Stripe URL.

import {
  createPendingCourseRegistration,
  attachStripeSessionToCourse,
  markCourseRegistrationPaid,
  getCourseRegistrationById,
  type CreatePendingCourseRegistrationInput,
} from './db';
import { pushPaidCourseRegistrationToDrip } from './paid-handler';
import { notifyCourseOrder } from '../orders/notification';
import { logEvent } from '../registrations/db';

type FreeCheckoutEnv = {
  DB: D1Database;
  PUBLIC_BASE_URL: string;
  DRIP_API_TOKEN: string;
  DRIP_ACCOUNT_ID: string;
  DRIP_COURSE_EVENT?: string;
  RESEND_API_KEY?: string;
  QUADERNO_ACCOUNT?: string;
  ORDER_NOTIFICATIONS_TO?: string;
};

export type FreeCheckoutResult = {
  checkout_url: string;
  course_registration_id: number;
};

// Fulfil a free (100%-off) course registration end to end. `input` is the same
// shape every checkout already builds; we force it to €0 / full / single
// payment regardless of what was passed, since a comp is never an installment
// plan. `thanksPath` is the course's own thanks page (e.g.
// '/courses/grief/thanks'); `originalAmountCents` is logged for the audit trail.
export async function fulfilFreeCourseRegistration(
  env: FreeCheckoutEnv,
  input: CreatePendingCourseRegistrationInput,
  opts: { thanksPath: string; originalAmountCents: number },
): Promise<FreeCheckoutResult> {
  const registrationId = await createPendingCourseRegistration(env.DB, {
    ...input,
    amount_cents: 0,
    currency: input.currency,
    payment_plan: 'full',
    installments_total: 1,
  });

  // A synthetic, unguessable stand-in for the (absent) Stripe session id, so
  // the thanks page can resolve the row by `stripe_session_id` as usual.
  const token = `free_${registrationId}_${crypto.randomUUID().slice(0, 8)}`;
  await attachStripeSessionToCourse(env.DB, registrationId, token);

  // No real payment — mark paid with a synthetic, recognisable comp intent id.
  await markCourseRegistrationPaid(env.DB, registrationId, `free-100-${registrationId}`);

  await logEvent(env.DB, {
    registration_id: null,
    kind: 'course.free_checkout.fulfilled',
    source: 'system',
    external_id: `local-course-${registrationId}`,
    payload: {
      course_registration_id: registrationId,
      product_slug: input.product_slug,
      currency: input.currency,
      original_amount_cents: opts.originalAmountCents,
      discount_percent: 100,
      source_variant: input.source_variant,
    },
  });

  // The same paid-side effects the Stripe webhook runs: Drip access (tags +
  // event) and the internal SD-ORDER notification. Both are idempotent.
  await pushPaidCourseRegistrationToDrip(env, registrationId);
  const paidReg = await getCourseRegistrationById(env.DB, registrationId);
  if (paidReg) {
    await notifyCourseOrder(env, paidReg, {
      stripePaymentIntent: paidReg.stripe_payment_intent,
      stripeSubscriptionId: null,
    });
  }

  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  return {
    checkout_url: `${baseUrl}${opts.thanksPath}?session_id=${token}`,
    course_registration_id: registrationId,
  };
}
