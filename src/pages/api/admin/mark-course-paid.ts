import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { logEvent } from '../../../lib/registrations/db';
import {
  getCourseRegistrationById,
  markCourseRegistrationPaid,
  recordInstallmentPaid,
} from '../../../lib/courses/db';
import { pushPaidCourseRegistrationToDrip } from '../../../lib/courses/paid-handler';
import { notifyCourseOrder } from '../../../lib/orders/notification';

export const prerender = false;

// Admin fallback for course rows that didn't auto-flip to paid via the
// Stripe webhook (e.g. when invoice.paid wasn't subscribed at the time of
// purchase). For 3x subscription rows we bump installments_paid by 1 so
// the count reflects the first installment that already ran on Stripe;
// for full-pay rows we just flip the status. Re-running on an already
// paid row is a no-op apart from re-firing the Drip event, which Drip
// itself dedupes.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const form = await request.formData();
  const courseRegistrationId = parseInt(
    String(form.get('course_registration_id') ?? ''),
    10,
  );
  if (!Number.isFinite(courseRegistrationId)) {
    return new Response('Bad course_registration_id', { status: 400 });
  }

  const reg = await getCourseRegistrationById(env.DB, courseRegistrationId);
  if (!reg) {
    return new Response('Not found', { status: 404 });
  }

  if (reg.installments_total > 1 && reg.installments_paid === 0) {
    // Installment plan: bump installments_paid from 0 to 1 so the admin view
    // reflects the first installment Stripe has already charged.
    await recordInstallmentPaid(
      env.DB,
      reg.id,
      reg.stripe_payment_intent ?? `manual-course-${reg.id}`,
    );
  } else if (reg.status !== 'paid') {
    await markCourseRegistrationPaid(
      env.DB,
      reg.id,
      reg.stripe_payment_intent ?? `manual-course-${reg.id}`,
    );
  }

  await logEvent(env.DB, {
    registration_id: null,
    kind: 'admin.course_mark_paid',
    source: 'admin',
    payload: { course_registration_id: reg.id },
  });

  await pushPaidCourseRegistrationToDrip(env, reg.id);

  // Internal SD-ORDER notification (idempotent: a no-op if the webhook
  // already sent it for this order). Re-fetch for the up-to-date row.
  const paidReg = (await getCourseRegistrationById(env.DB, reg.id)) ?? reg;
  await notifyCourseOrder(env, paidReg, {
    stripePaymentIntent: paidReg.stripe_payment_intent,
    stripeSubscriptionId: paidReg.stripe_subscription_id,
  });

  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));
  return new Response(null, {
    status: 302,
    headers: { Location: returnTo },
  });
};

function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin';
}
