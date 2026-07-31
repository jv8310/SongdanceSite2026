import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import {
  assignRoomOnPaid,
  getRegistrationById,
  logEvent,
  markRegistrationPaid,
} from '../../../lib/registrations/db';
import { settleWaitlistOnPaid } from '../../../lib/registrations/waitlist';
import { pushPaidRegistrationToDrip } from '../../../lib/registrations/paid-handler';
import { notifyRetreatOrder } from '../../../lib/orders/notification';

export const prerender = false;

// Admin fallback for when the Stripe webhook didn't fire (or for the
// admin €1 test path): flip the registration to 'paid' and run the same
// Drip side-effects the webhook would have. Idempotent — re-running on
// an already-paid row is a no-op except for re-firing the Drip event,
// which Drip itself dedupes server-side.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const form = await request.formData();
  const registrationId = parseInt(String(form.get('registration_id') ?? ''), 10);
  if (!Number.isFinite(registrationId)) {
    return new Response('Bad registration_id', { status: 400 });
  }

  await markRegistrationPaid(
    env.DB,
    registrationId,
    `manual-${registrationId}`,
  );
  // Place the guest in a cabin now they're marked paid (no-op if the row
  // already has a room — e.g. a seeded/held booking).
  await assignRoomOnPaid(env.DB, registrationId);
  // If this booking came off the waiting list, close that entry (and release
  // the place it was holding). No-op for an ordinary booking.
  await settleWaitlistOnPaid(env.DB, registrationId);
  await logEvent(env.DB, {
    registration_id: registrationId,
    kind: 'admin.mark_paid',
    source: 'admin',
    payload: {},
  });

  await pushPaidRegistrationToDrip(env, registrationId);

  // Internal SD-ORDER notification (idempotent: a no-op if the webhook
  // already sent it for this order).
  const reg = await getRegistrationById(env.DB, registrationId);
  if (reg) {
    await notifyRetreatOrder(env, reg, {
      stripePaymentIntent: reg.stripe_payment_intent,
    });
  }

  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));
  return new Response(null, {
    status: 302,
    headers: { Location: returnTo },
  });
};

// Only allow same-site /admin/* redirects to defend against an open
// redirect: a `return_to` from the form is otherwise free user input.
function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin';
}
