import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { getRegistrationById } from '../../../lib/registrations/db';
import {
  invoiceRetreatBalance,
  invoiceRetreatBooking,
} from '../../../lib/registrations/retreat-invoice';

export const prerender = false;

// Admin: raise the Quaderno invoice for a retreat payment that never reached a
// gateway — recovery for bookings confirmed before the two "Mark paid" buttons
// started doing it themselves (see lib/registrations/retreat-invoice.ts).
//
// Deliberately narrow, because the danger here is a DUPLICATE invoice: a
// Stripe/PayPal payment is invoiced by Quaderno's own connector, silently and
// without telling us its id, so raising a second one by hand would bill the
// guest twice on paper. The `which` from the form only chooses between the two
// cases; each one re-checks its own preconditions against the row
// (invoiceRetreatBooking refuses anything that isn't a bank_transfer booking;
// the balance path needs a real balance actually settled by hand), and both
// are idempotent on an events claim. Nothing about the amount, the tax or the
// eligibility is taken from the request.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const registrationId = parseInt(String(form.get('registration_id') ?? ''), 10);
  const which = String(form.get('which') ?? 'booking') === 'balance' ? 'balance' : 'booking';
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));
  if (!Number.isFinite(registrationId)) {
    return new Response('Bad registration_id', { status: 400 });
  }

  const reg = await getRegistrationById(env.DB, registrationId);
  if (!reg) return new Response('Registration not found', { status: 404 });

  const result =
    which === 'balance'
      ? // A settled balance has already been rolled into amount_cents and its
        // balance_due_cents zeroed, so the amount owed is recovered from the
        // settlement itself rather than from the (now empty) column.
        await invoiceRetreatBalance(env, reg, await settledBalanceCents(env.DB, reg.id))
      : await invoiceRetreatBooking(env, reg);

  const params = new URLSearchParams();
  if (result.ok === true) {
    params.set('inv_created', '1');
    if (result.number) params.set('inv_number', result.number);
  } else if (result.ok === false) {
    params.set('inv_failed', '1');
    params.set('inv_error', result.error.slice(0, 200));
  } else {
    params.set('inv_skipped', '1');
    params.set('inv_error', result.reason);
  }

  const sep = returnTo.includes('?') ? '&' : '?';
  return new Response(null, {
    status: 302,
    headers: { Location: `${returnTo}${sep}${params.toString()}` },
  });
};

// What the hand-settled balance was, read back from the event the balance
// "Mark paid" button wrote. Returns 0 when this registration's balance was
// never settled by hand — which makes the invoice call a no-op, so a gateway
// balance can never be invoiced twice.
async function settledBalanceCents(db: D1Database, registrationId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT payload_json FROM events
        WHERE registration_id = ?
          AND kind = 'registration.balance.paid'
          AND source = 'admin'
        ORDER BY id DESC LIMIT 1`,
    )
    .bind(registrationId)
    .first<{ payload_json: string | null }>();
  if (!row?.payload_json) return 0;
  try {
    const payload = JSON.parse(row.payload_json) as { balance_cents?: unknown };
    const cents = Number(payload.balance_cents);
    return Number.isFinite(cents) && cents > 0 ? cents : 0;
  } catch {
    return 0;
  }
}

// Only allow same-site /admin/* redirects to defend against an open redirect:
// a `return_to` from the form is otherwise free user input.
function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin';
}
