import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import {
  logEvent,
  markRegistrationPaid,
} from '../../../lib/registrations/db';
import { pushPaidRegistrationToDrip } from '../../../lib/registrations/paid-handler';

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
  await logEvent(env.DB, {
    registration_id: registrationId,
    kind: 'admin.mark_paid',
    source: 'admin',
    payload: {},
  });

  await pushPaidRegistrationToDrip(env, registrationId);

  return new Response(null, {
    status: 302,
    headers: { Location: '/admin/registrations' },
  });
};
