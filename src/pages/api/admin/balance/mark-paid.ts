import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  getRegistrationById,
  logEvent,
  markBalancePaid,
} from '../../../../lib/registrations/db';
import { recordRetreatOrder } from '../../../../lib/registrations/paid-handler';

export const prerender = false;

// Admin: settle a deposit-payer's remaining balance by hand — the other half of
// the balance email, which asks guests to transfer to the Songdance account and
// reply once they have. There is no webhook for a bank transfer, so this is the
// path that closes those bookings.
//
// It does exactly what the Stripe/PayPal balance handlers do when the money
// lands (stripe-webhook.ts `payment_kind=balance`, paypal-fulfill.ts
// `fulfillBalancePaypal`): roll the balance into amount_cents, lift the Drip
// ecommerce order from deposit to full, and log it. The registration is already
// 'paid' from the deposit, so no Drip "Completed registration" event is
// re-fired and no SD-ORDER goes out — same as those two paths.
//
// Idempotent: markBalancePaid adds nothing once balance_due_cents is 0, and an
// already-settled row is refused outright so a double-click can't log twice.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const registrationId = parseInt(String(form.get('registration_id') ?? ''), 10);
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));
  const method = String(form.get('method') ?? 'bank-transfer').slice(0, 40);
  if (!Number.isFinite(registrationId)) {
    return new Response('Bad registration_id', { status: 400 });
  }

  const reg = await getRegistrationById(env.DB, registrationId);
  if (!reg) return new Response('Registration not found', { status: 404 });

  const balance = reg.balance_due_cents ?? 0;
  const error =
    reg.status !== 'paid'
      ? 'not-paid'
      : reg.balance_paid_at
        ? 'already-settled'
        : balance <= 0
          ? 'no-balance'
          : null;

  if (!error) {
    await markBalancePaid(env.DB, registrationId);
    // Lift the Drip order to the now-full amount_cents (idempotent; no event).
    await recordRetreatOrder(env, registrationId);
    await logEvent(env.DB, {
      registration_id: registrationId,
      kind: 'registration.balance.paid',
      source: 'admin',
      payload: { method, balance_cents: balance, marked_by: 'admin' },
    });
  }

  const params = new URLSearchParams();
  if (error) {
    params.set('bal_mark_failed', '1');
    params.set('bal_error', error);
  } else {
    params.set('bal_marked', '1');
  }
  const sep = returnTo.includes('?') ? '&' : '?';
  return new Response(null, {
    status: 302,
    headers: { Location: `${returnTo}${sep}${params.toString()}` },
  });
};

// Only allow same-site /admin/* redirects to defend against an open redirect:
// a `return_to` from the form is otherwise free user input.
function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin';
}
