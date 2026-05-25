import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { getRegistrationById, logEvent } from '../../../lib/registrations/db';

export const prerender = false;

// Permanently delete a registration row. Used to clean up admin-test
// rows and accidental duplicates. The audit trail in the events table
// stays — the registration_id on those events flips to NULL via the
// ON DELETE SET NULL FK, but the kind / payload remain.
//
// We snapshot the row into one final event before deleting so the
// audit trail records exactly what was removed.
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
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));

  const reg = await getRegistrationById(env.DB, registrationId);
  if (!reg) {
    return new Response(null, {
      status: 302,
      headers: { Location: returnTo },
    });
  }

  await logEvent(env.DB, {
    registration_id: registrationId,
    kind: 'admin.delete_registration',
    source: 'admin',
    payload: {
      deleted_at: new Date().toISOString(),
      snapshot: {
        id: reg.id,
        name: reg.name,
        email: reg.email,
        status: reg.status,
        tier_id: reg.tier_id,
        amount_cents: reg.amount_cents,
        currency: reg.currency,
        role: reg.role,
        stripe_session_id: reg.stripe_session_id,
        stripe_payment_intent: reg.stripe_payment_intent,
      },
    },
  });

  await env.DB.prepare('DELETE FROM registrations WHERE id = ?')
    .bind(registrationId)
    .run();

  return new Response(null, {
    status: 302,
    headers: { Location: returnTo },
  });
};

function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin';
}
