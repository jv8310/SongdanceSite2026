import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { logEvent } from '../../../lib/registrations/db';
import { createRefund } from '../../../lib/registrations/stripe';
import {
  isRefundable,
  listAllOrders,
  parseOrderNo,
  refundableMinor,
} from '../../../lib/admin/orders';

export const prerender = false;

// Issue a Stripe refund against any order (retreat / course / workshop) from
// the general order overview. The amount, when given, is in the order's own
// charge currency. We only ask Stripe to move the money here — the existing
// `charge.refunded` webhook is the single writer that flips our DB rows to
// 'refunded' and accumulates the refunded amount, so the two never double-count.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const orderNo = String(form.get('order_no') ?? '').trim();
  const amountRaw = String(form.get('amount') ?? '').trim();
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));

  const parsed = parseOrderNo(orderNo);
  if (!parsed) {
    return redirect(returnTo, { flash: 'refund_error', msg: 'Bad order number' });
  }

  // Re-derive the order from the source of truth so amount/currency/PI can't
  // be tampered with via the form.
  const orders = await listAllOrders(env.DB);
  const order = orders.find((o) => o.orderNo === orderNo);
  if (!order) {
    return redirect(returnTo, { flash: 'refund_error', msg: 'Order not found' });
  }
  if (!isRefundable(order) || !order.paymentIntent) {
    return redirect(returnTo, {
      flash: 'refund_error',
      msg: 'Order is not refundable',
    });
  }

  const remaining = refundableMinor(order);

  // Blank amount → full refund of whatever is left. Otherwise parse the major
  // amount in the charge currency and clamp to the remaining balance.
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
    if (amountMinor > remaining) {
      return redirect(returnTo, {
        flash: 'refund_error',
        msg: 'Amount exceeds what is left to refund',
      });
    }
  }

  try {
    const refund = await createRefund({
      secretKey: env.STRIPE_SECRET_KEY,
      paymentIntent: order.paymentIntent,
      amountMinor,
      reason: 'requested_by_customer',
      metadata: { order_no: order.orderNo, source: order.source },
    });

    await logEvent(env.DB, {
      registration_id: order.source === 'retreat' ? order.rowId : null,
      kind: 'admin.refund.requested',
      source: 'admin',
      external_id: `refund-${refund.id}`,
      payload: {
        order_no: order.orderNo,
        source: order.source,
        row_id: order.rowId,
        payment_intent: order.paymentIntent,
        refund_id: refund.id,
        amount_minor: refund.amount,
        currency: refund.currency,
        full: amountMinor == null,
      },
    });

    const amtMajor = (refund.amount / 100).toFixed(2);
    return redirect(returnTo, {
      flash: 'refund_ok',
      msg: `Refund of ${amtMajor} ${refund.currency.toUpperCase()} submitted for ${order.orderNo}`,
    });
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'admin.refund.failed',
      source: 'admin',
      payload: { order_no: order.orderNo, error: String(err) },
    });
    return redirect(returnTo, {
      flash: 'refund_error',
      msg: 'Stripe refund failed — see logs',
    });
  }
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
