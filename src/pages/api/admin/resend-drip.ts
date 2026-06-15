import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { getRegistrationById, logEvent } from '../../../lib/registrations/db';
import { pushPaidRegistrationToDrip } from '../../../lib/registrations/paid-handler';

export const prerender = false;

// Re-fire the Drip side-effects for an already-paid registration: upsert the
// subscriber and re-send the "Completed retreat registration" event (the
// trigger for Drip's confirmation + follow-up workflows). Use it when the
// original push went to a wrong/placeholder address that's since been
// corrected, or when Drip never received the event.
//
// It does NOT change the registration's status — for an unpaid row, use the
// "Mark paid + Drip" button (/api/admin/mark-paid) instead, which flips the
// status and pushes to Drip in one step. Idempotent: Drip dedupes the event
// server-side, so re-running is safe.
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

  const reg = await getRegistrationById(env.DB, registrationId);
  if (!reg) {
    return new Response('Registration not found', { status: 404 });
  }
  // The Drip event is "Completed retreat registration" — only meaningful for a
  // paid booking. Refuse to (re)assert it for a non-paid row.
  if (reg.status !== 'paid') {
    return new Response('Registration is not paid — use Mark paid + Drip', {
      status: 400,
    });
  }

  await pushPaidRegistrationToDrip(env, registrationId);
  await logEvent(env.DB, {
    registration_id: registrationId,
    kind: 'admin.resend_drip',
    source: 'admin',
    payload: { email: reg.email },
  });

  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));
  return new Response(null, {
    status: 302,
    headers: { Location: returnTo },
  });
};

// Only allow same-site /admin/* redirects to defend against an open redirect:
// `return_to` from the form is otherwise free user input.
function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin';
}
