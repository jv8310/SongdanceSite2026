import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getRegistrationById } from '../../../../lib/registrations/db';
import { sendBalanceInvite } from '../../../../lib/registrations/balance';

export const prerender = false;

// Admin: email one deposit-payer a Stripe link for their remaining balance.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const registrationId = parseInt(String(form.get('registration_id') ?? ''), 10);
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));
  if (!Number.isFinite(registrationId)) {
    return new Response('Bad registration_id', { status: 400 });
  }

  const reg = await getRegistrationById(env.DB, registrationId);
  if (!reg) return new Response('Registration not found', { status: 404 });

  const result = await sendBalanceInvite(env, reg, new URL(request.url).origin);

  const params = new URLSearchParams();
  if (result.ok) params.set('bal_sent', '1');
  else {
    params.set('bal_failed', '1');
    params.set('bal_error', result.error);
  }
  const sep = returnTo.includes('?') ? '&' : '?';
  return new Response(null, {
    status: 302,
    headers: { Location: `${returnTo}${sep}${params.toString()}` },
  });
};

function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin';
}
