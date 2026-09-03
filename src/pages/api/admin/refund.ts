import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { logEvent } from '../../../lib/registrations/db';
import { createRefund } from '../../../lib/registrations/stripe';
import { refundCapture, refundSale } from '../../../lib/payments/paypal';
import { recordPaypalRefund } from '../../../lib/payments/paypal-fulfill';
import {
  findOrder,
  isRefundable,
  parseOrderNo,
} from '../../../lib/admin/orders';
import {
  findOrderInstallment,
  hasInstallmentLedger,
  installmentRefundableMinor,
  perChargeRefundableMinor,
} from '../../../lib/admin/installments';

export const prerender = false;

// Issue a refund against any order (retreat / course / workshop) from the
// general order overview. The amount, when given, is in the order's own charge
// currency. We only ask Stripe to move the money here — the existing
// `charge.refunded` webhook is the single writer that flips our DB rows to
// 'refunded' and accumulates the refunded amount, so the two never double-count.
// (PayPal has no equivalent guarantee, so that path records its own refund,
// idempotently on the refund id.)
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
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const orderNo = String(form.get('order_no') ?? '').trim();
  const amountRaw = String(form.get('amount') ?? '').trim();
  const installmentId = String(form.get('installment') ?? '').trim();
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));

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

  // Resolve which charge to refund. With an `installment`, that cycle — proven
  // to belong to this order by finding it in the order's own ledger. Without
  // one, the single charge the row stores.
  let stripeTarget = order.paymentIntent;
  let paypalTarget = order.paypalCaptureId;
  let remaining = perChargeRefundableMinor(order);
  let cycleNote = '';

  if (installmentId) {
    if (!hasInstallmentLedger(order)) {
      return redirect(returnTo, {
        flash: 'refund_error',
        msg: 'This order has no installment plan',
      });
    }
    const found = await findOrderInstallment(env, order, installmentId);
    if (!found.ok) {
      const msg =
        found.reason === 'gateway_error'
          ? 'Could not read the plan from the payment provider — try again'
          : found.reason === 'not_found'
            ? 'That installment is not on this order’s plan'
            : 'This order has no installment plan';
      await logEvent(env.DB, {
        registration_id: null,
        kind: 'admin.refund.failed',
        source: 'admin',
        payload: {
          order_no: order.orderNo,
          installment: installmentId,
          reason: found.reason,
          error: found.error,
        },
      });
      return redirect(returnTo, { flash: 'refund_error', msg });
    }
    const cycle = found.installment;
    if (!cycle.refundTarget) {
      return redirect(returnTo, {
        flash: 'refund_error',
        msg: 'No charge recorded for that installment',
      });
    }
    if (order.provider === 'paypal') {
      paypalTarget = cycle.refundTarget;
    } else {
      stripeTarget = cycle.refundTarget;
    }
    remaining = installmentRefundableMinor(cycle);
    cycleNote = ` · installment ${cycle.seq}`;
    if (remaining <= 0) {
      return redirect(returnTo, {
        flash: 'refund_error',
        msg: `Installment ${cycle.seq} is already fully refunded`,
      });
    }
  }

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
    if (amountMinor > remaining) {
      return redirect(returnTo, {
        flash: 'refund_error',
        msg: installmentId
          ? 'Amount exceeds what is left on that installment'
          : 'Amount exceeds what is left to refund on this charge',
      });
    }
  }

  // ── PayPal refund. Subscription installments are v1 "sale" objects (refund
  //    via the sale endpoint); one-off captures use the v2 captures endpoint.
  //    Unlike Stripe (webhook is the single writer), we record the refund here
  //    too — idempotent on the refund id, so a later webhook never re-counts it.
  if (order.provider === 'paypal') {
    if (!paypalTarget) {
      return redirect(returnTo, { flash: 'refund_error', msg: 'No PayPal payment to refund' });
    }
    try {
      const currency = order.originalCurrency;
      const refund = order.paypalSubscriptionId
        ? await refundSale({
            env,
            saleId: paypalTarget,
            amountMinor,
            currency,
            noteToPayer: `Refund for ${order.orderNo}`,
          })
        : await refundCapture({
            env,
            captureId: paypalTarget,
            amountMinor,
            currency,
            noteToPayer: `Refund for ${order.orderNo}`,
            customId: order.orderNo,
          });
      const delta = refund.amountMinor ?? amountMinor ?? remaining;
      await recordPaypalRefund(env as any, {
        refundId: refund.id,
        captureId: paypalTarget,
        amountMinor: delta,
        currency,
        // Cycle 2+ of a plan isn't the sale stored on the row, so name the row
        // outright — otherwise the refund lands as `paypal.refund.unmatched`
        // and the money goes back without our books moving.
        subscriptionId: order.paypalSubscriptionId,
        courseRegistrationId: order.source === 'course' ? order.rowId : null,
      });
      await logEvent(env.DB, {
        registration_id: order.source === 'retreat' ? order.rowId : null,
        kind: 'admin.refund.requested',
        source: 'admin',
        external_id: `paypal-refund-${refund.id}`,
        payload: {
          order_no: order.orderNo,
          source: order.source,
          row_id: order.rowId,
          provider: 'paypal',
          capture_id: paypalTarget,
          installment: installmentId || null,
          refund_id: refund.id,
          amount_minor: delta,
          currency,
          full: amountMinor == null,
        },
      });
      const amtMajor = (delta / 100).toFixed(2);
      return redirect(returnTo, {
        flash: 'refund_ok',
        msg: `PayPal refund of ${amtMajor} ${currency} submitted for ${order.orderNo}${cycleNote}`,
      });
    } catch (err) {
      await logEvent(env.DB, {
        registration_id: null,
        kind: 'admin.refund.failed',
        source: 'admin',
        payload: {
          order_no: order.orderNo,
          provider: 'paypal',
          installment: installmentId || null,
          error: String(err),
        },
      });
      return redirect(returnTo, { flash: 'refund_error', msg: 'PayPal refund failed — see logs' });
    }
  }

  if (!stripeTarget) {
    return redirect(returnTo, { flash: 'refund_error', msg: 'Order is not refundable' });
  }

  try {
    const refund = await createRefund({
      secretKey: env.STRIPE_SECRET_KEY,
      paymentIntent: stripeTarget,
      amountMinor,
      reason: 'requested_by_customer',
      metadata: {
        order_no: order.orderNo,
        source: order.source,
        ...(installmentId ? { installment: installmentId } : {}),
      },
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
        payment_intent: stripeTarget,
        installment: installmentId || null,
        refund_id: refund.id,
        amount_minor: refund.amount,
        currency: refund.currency,
        full: amountMinor == null,
      },
    });

    const amtMajor = (refund.amount / 100).toFixed(2);
    return redirect(returnTo, {
      flash: 'refund_ok',
      msg: `Refund of ${amtMajor} ${refund.currency.toUpperCase()} submitted for ${order.orderNo}${cycleNote}`,
    });
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'admin.refund.failed',
      source: 'admin',
      payload: {
        order_no: order.orderNo,
        installment: installmentId || null,
        error: String(err),
      },
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
