import type { APIRoute } from 'astro';
import { getSessionEmail, readCookie, verifySession } from '../../../lib/registrations/auth';
import { askApp } from '../../../lib/admin/app-access';
import { findOrder, isRefundable, parseOrderNo } from '../../../lib/admin/orders';
import { cycleNote, issueRefund, resolveRefundTarget } from '../../../lib/admin/refund';

export const prerender = false;

// Issue a refund against any order (retreat / course / workshop) from the
// general order overview. The amount, when given, is in the order's own charge
// currency. Which charge is hit, how much is left on it and how the refund is
// recorded is decided in lib/admin/refund.ts, which Claude's refund_order tool
// in the member app goes through as well (lib/app-bridge/refund.ts).
//
// ONE INSTALLMENT AT A TIME. A course installment plan is N separate charges at
// the gateway, but the row stores the plan TOTAL and only the FIRST charge id.
// So this endpoint takes an optional `installment` — a Stripe invoice id or a
// PayPal sale id — and refunds that cycle specifically. The id is never
// trusted: it is looked up in the ledger built from this order's own
// subscription id (lib/admin/installments.ts), which is both the lookup and the
// authorisation check, and the amount is clamped to that cycle rather than to
// the plan total.
//
// Without an `installment` the target is still the row's single stored charge —
// so for a plan the ceiling is ONE charge, not the plan total. Offering the
// whole plan there is what made a "full" refund silently give back one cycle.
//
// TAKING THE COURSE AWAY TOO. A full refund closes the course in the member
// app by itself (the app's sync revokes everything from a refunded order); a
// partial one — one installment, part of a payment — leaves access alone. A
// course order's refund form therefore carries a `revoke_access` tick: once the
// gateway has taken the refund (never before, never on a failure), the app is
// asked to revoke everything it holds from that order, logged under the
// signed-in admin (lib/admin/app-access.ts). Its outcome is added to the flash.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const cookie = readCookie(request);
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, cookie))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const orderNo = String(form.get('order_no') ?? '').trim();
  const amountRaw = String(form.get('amount') ?? '').trim();
  const installmentId = String(form.get('installment') ?? '').trim();
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));
  const revokeAccess = form.get('revoke_access') === '1';

  const parsed = parseOrderNo(orderNo);
  if (!parsed) {
    return redirect(returnTo, { flash: 'refund_error', msg: 'Bad order number' });
  }

  // Re-derive the order from the source of truth so amount/currency/PI can't
  // be tampered with via the form.
  const order = await findOrder(env.DB, orderNo);
  if (!order) {
    return redirect(returnTo, { flash: 'refund_error', msg: 'Order not found' });
  }
  if (!isRefundable(order)) {
    return redirect(returnTo, {
      flash: 'refund_error',
      msg: 'Order is not refundable',
    });
  }

  const resolved = await resolveRefundTarget(env, order, { installmentId }, 'admin');
  if (!resolved.ok) {
    return redirect(returnTo, { flash: 'refund_error', msg: resolved.message });
  }
  const target = resolved.target;
  const cycle = cycleNote(target);

  // Called only once the gateway has accepted the refund: the money has moved,
  // so a failure here is a note in the flash, never "refund failed".
  const appRevokeNote = async (): Promise<string> => {
    if (!revokeAccess || order.source !== 'course') return '';
    const actor = (await getSessionEmail(env.ADMIN_SESSION_SECRET, cookie)) ?? 'admin';
    const r = await askApp(env, (app) =>
      app.revokeOrder({ email: order.email, courseRegistrationId: order.rowId, reason: `Refund on ${order.orderNo}${cycle}`, actor }),
    );
    if (!r.ok) return `. Access in the app was NOT taken away (${r.message}) — do it on their People page.`;
    if (!r.data.revoked.length) return '. The app held nothing from this order to take away.';
    return `. Taken away in the app: ${r.data.revoked.map((c) => c.label).join(', ')}.`;
  };

  // Blank amount → full refund of whatever is left ON THAT CHARGE. Otherwise
  // parse the major amount in the charge currency and clamp to it.
  let amountMinor: number | null = null;
  if (amountRaw) {
    const major = Number(amountRaw.replace(',', '.'));
    if (!Number.isFinite(major) || major <= 0) {
      return redirect(returnTo, {
        flash: 'refund_error',
        msg: 'Enter a positive amount',
      });
    }
    amountMinor = Math.round(major * 100);
    if (amountMinor > target.remainingMinor) {
      return redirect(returnTo, {
        flash: 'refund_error',
        msg: target.installment
          ? 'Amount exceeds what is left on that installment'
          : 'Amount exceeds what is left to refund on this charge',
      });
    }
  }

  const outcome = await issueRefund(env, order, target, amountMinor, { door: 'admin' });
  if (outcome.status === 'failed') {
    return redirect(returnTo, {
      flash: 'refund_error',
      msg: `${outcome.provider === 'paypal' ? 'PayPal' : 'Stripe'} refund failed — ${outcome.detail}`,
    });
  }
  const amtMajor = (outcome.amountMinor / 100).toFixed(2);
  if (outcome.status === 'unrecorded') {
    return redirect(returnTo, {
      flash: 'refund_warn',
      msg: `PayPal DID refund ${amtMajor} ${outcome.currency} for ${order.orderNo}${cycle} (refund ${outcome.refundId}) — but recording it here failed, so this page still shows the old figures. Do not refund again. ${outcome.detail}${await appRevokeNote()}`,
    });
  }
  return redirect(returnTo, {
    flash: 'refund_ok',
    msg: `${outcome.provider === 'paypal' ? 'PayPal refund' : 'Refund'} of ${amtMajor} ${outcome.currency} submitted for ${order.orderNo}${cycle}${await appRevokeNote()}`,
  });
};

function redirect(
  base: string,
  params: { flash: string; msg: string },
): Response {
  const url = new URL(base, 'https://placeholder.local');
  url.searchParams.set('flash', params.flash);
  url.searchParams.set('msg', params.msg);
  const location = url.pathname + url.search;
  return new Response(null, { status: 302, headers: { Location: location } });
}

// Only allow same-site /admin/* redirects (return_to is user-supplied).
function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin/orders';
}
