import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { logEvent } from '../../../lib/registrations/db';
import {
  deleteCourseRegistration,
  getCourseRegistrationById,
} from '../../../lib/courses/db';

export const prerender = false;

// Permanently delete a course_registrations row. Used to clean up rows
// that will never become paid: pending (rarely — we expire after 15 min),
// expired (abandoned Stripe Checkout), and cancelled. Paid / refunded
// rows are protected so financial history stays intact.
//
// The events table only FKs registration_id to the retreat `registrations`
// table, so we just log with registration_id=NULL and stash the snapshot
// (including course_registration_id) in the payload — same pattern the
// Stripe webhook uses for course events.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const form = await request.formData();
  const id = parseInt(String(form.get('course_registration_id') ?? ''), 10);
  if (!Number.isFinite(id)) {
    return new Response('Bad course_registration_id', { status: 400 });
  }
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));

  const reg = await getCourseRegistrationById(env.DB, id);
  if (!reg) {
    return new Response(null, {
      status: 302,
      headers: { Location: returnTo },
    });
  }

  if (reg.status === 'paid' || reg.status === 'refunded') {
    return new Response(
      `Refusing to delete a ${reg.status} course registration`,
      { status: 400 },
    );
  }

  await logEvent(env.DB, {
    registration_id: null,
    kind: 'admin.delete_course_registration',
    source: 'admin',
    payload: {
      deleted_at: new Date().toISOString(),
      snapshot: {
        course_registration_id: reg.id,
        email: reg.email,
        first_name: reg.first_name,
        last_name: reg.last_name,
        product_slug: reg.product_slug,
        status: reg.status,
        amount_cents: reg.amount_cents,
        currency: reg.currency,
        payment_plan: reg.payment_plan,
        installments_paid: reg.installments_paid,
        stripe_session_id: reg.stripe_session_id,
        stripe_payment_intent: reg.stripe_payment_intent,
        stripe_subscription_id: reg.stripe_subscription_id,
        source_variant: reg.source_variant,
        created_at: reg.created_at,
      },
    },
  });

  await deleteCourseRegistration(env.DB, id);

  return new Response(null, {
    status: 302,
    headers: { Location: returnTo },
  });
};

function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin/courses';
}
