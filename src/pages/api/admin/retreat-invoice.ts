import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { getRegistrationById } from '../../../lib/registrations/db';
import {
  createRetreatInvoice,
  settledBalanceCents,
  type RetreatInvoiceKind,
} from '../../../lib/orders/retreat-invoice';

export const prerender = false;

// Raise the Quaderno invoice for a retreat payment by hand.
//
// The automatic path covers the case the button exists for — a booking taken
// through "Pay by bank transfer" and confirmed with "Transfer received — mark
// paid", and a balance settled from the Balance-due table. This is for the
// ones that fall outside it: a booking that was marked paid before that
// existed, a guest who abandoned a Stripe checkout and wired the money
// instead, a PayPal payment (PayPal has no Quaderno connector), or an
// automatic attempt that hit a Quaderno error.
//
// It is deliberately a button and not a rule: only a person can know that a
// given payment did NOT come through Stripe, and inventing a second invoice
// for money the Stripe→Quaderno connector already invoiced is the one outcome
// worse than having none. Refuses a row that already carries an invoice id,
// so pressing it twice cannot double-invoice.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const registrationId = parseInt(String(form.get('registration_id') ?? ''), 10);
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));
  const kind: RetreatInvoiceKind =
    String(form.get('kind') ?? 'booking') === 'balance' ? 'balance' : 'booking';
  if (!Number.isFinite(registrationId)) {
    return new Response('Bad registration_id', { status: 400 });
  }

  const reg = await getRegistrationById(env.DB, registrationId);
  if (!reg) return new Response('Registration not found', { status: 404 });

  // A balance invoice covers the remainder only, and by the time a balance is
  // settled markBalancePaid has folded it into amount_cents — so read the sum
  // back out of the events log (every settling path records it).
  const amountCents =
    kind === 'balance'
      ? await settledBalanceCents(env.DB, registrationId)
      : reg.amount_cents;
  if (kind === 'balance' && !amountCents) {
    const sep = returnTo.includes('?') ? '&' : '?';
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${returnTo}${sep}inv_failed=1&inv_error=balance-amount-unknown`,
      },
    });
  }

  const result = await createRetreatInvoice(env, registrationId, {
    kind,
    amountCents: amountCents ?? undefined,
    by: 'admin',
  });

  const params = new URLSearchParams();
  if (result.ok === true) {
    params.set('inv_created', '1');
    if (result.number) params.set('inv_number', result.number);
    if (!result.paid) params.set('inv_unpaid', '1');
  } else if (result.ok === false) {
    params.set('inv_failed', '1');
    params.set('inv_error', result.error.slice(0, 300));
  } else {
    params.set('inv_failed', '1');
    params.set('inv_error', result.skipped);
  }

  const sep = returnTo.includes('?') ? '&' : '?';
  return new Response(null, {
    status: 302,
    headers: { Location: `${returnTo}${sep}${params.toString()}` },
  });
};

// Only allow same-site /admin/* redirects to defend against an open redirect:
// `return_to` from the form is otherwise free user input.
function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin';
}
