import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { logEventSafe } from '../../../lib/registrations/db';
import { createRefund } from '../../../lib/registrations/stripe';
import { refundCapture, refundSubscriptionCycle } from '../../../lib/payments/paypal';
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
  // What the GATEWAY charged, which is what a partial refund must be expressed
  // in. Normally the order's own currency; a cycle answers for itself, so an
  // order row that disagrees with the charge can't send PayPal a mismatched
  // amount.
  let chargeCurrency = order.originalCurrency;

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
      await logEventSafe(env.DB, {
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
    if (cycle.currency) chargeCurrency = cycle.currency.toUpperCase();
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

  // ── PayPal refund. A subscription cycle is refunded through the v2 captures
  //    endpoint (refundSubscriptionCycle knows why, and keeps the deprecated v1
  //    sale path behind it); a one-off capture goes straight to v2.
  //    Unlike Stripe (webhook is the single writer), we record the refund here
  //    too — idempotent on the refund id, so a later webhook never re-counts it.
  if (order.provider === 'paypal') {
    if (!paypalTarget) {
      return redirect(returnTo, { flash: 'refund_error', msg: 'No PayPal payment to refund' });
    }
    const currency = chargeCurrency;

    // THE GATEWAY CALL STANDS ALONE. Everything after it runs against money
    // that has already moved, so only this try may answer "failed" — see the
    // note below.
    // `via` says which PayPal endpoint actually took the refund — worth
    // knowing while the deprecated v1 path is still there as a fallback.
    let refund: {
      id: string;
      status: string;
      amountMinor: number | null;
      via?: 'capture' | 'sale';
    };
    try {
      refund = order.paypalSubscriptionId
        ? await refundSubscriptionCycle({
            env,
            saleId: paypalTarget,
            amountMinor,
            currency,
            noteToPayer: `Refund for ${order.orderNo}`,
            customId: order.orderNo,
          })
        : await refundCapture({
            env,
            captureId: paypalTarget,
            amountMinor,
            currency,
            noteToPayer: `Refund for ${order.orderNo}`,
            customId: order.orderNo,
          });
    } catch (err) {
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'admin.refund.failed',
        source: 'admin',
        payload: {
          order_no: order.orderNo,
          provider: 'paypal',
          capture_id: paypalTarget,
          installment: installmentId || null,
          amount_minor: amountMinor,
          currency,
          error: String(err),
        },
      });
      return redirect(returnTo, {
        flash: 'refund_error',
        msg: `PayPal refund failed — ${gatewayDetail(err)}`,
      });
    }

    // PayPal has moved the money. From here on nothing may report a plain
    // failure: "PayPal refund failed" would be read as "nothing happened" and
    // the next press would hand the same cycle back a second time. Bookkeeping
    // trouble is a WARNING that names the refund and says not to retry.
    const delta = refund.amountMinor ?? amountMinor ?? remaining;
    const amtMajor = (delta / 100).toFixed(2);
    let bookkeepingError: string | null = null;
    try {
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
    } catch (err) {
      bookkeepingError = gatewayDetail(err);
    }
    await logEventSafe(env.DB, {
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
        via: refund.via ?? 'capture',
        record_error: bookkeepingError,
      },
    });
    if (bookkeepingError) {
      return redirect(returnTo, {
        flash: 'refund_warn',
        msg: `PayPal DID refund ${amtMajor} ${currency} for ${order.orderNo}${cycleNote} (refund ${refund.id}) — but recording it here failed, so this page still shows the old figures. Do not refund again. ${bookkeepingError}`,
      });
    }
    return redirect(returnTo, {
      flash: 'refund_ok',
      msg: `PayPal refund of ${amtMajor} ${currency} submitted for ${order.orderNo}${cycleNote}`,
    });
  }

  if (!stripeTarget) {
    return redirect(returnTo, { flash: 'refund_error', msg: 'Order is not refundable' });
  }

  // The Stripe side splits the same way: the gateway call alone may answer
  // "failed", because a refund Stripe accepted is money already on its way back.
  let refund: { id: string; amount: number; currency: string };
  try {
    refund = await createRefund({
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
  } catch (err) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'admin.refund.failed',
      source: 'admin',
      payload: {
        order_no: order.orderNo,
        provider: 'stripe',
        payment_intent: stripeTarget,
        installment: installmentId || null,
        amount_minor: amountMinor,
        error: String(err),
      },
    });
    return redirect(returnTo, {
      flash: 'refund_error',
      msg: `Stripe refund failed — ${gatewayDetail(err)}`,
    });
  }

  // Our row is written by the `charge.refunded` webhook — the single writer —
  // so there is no bookkeeping here to fail, only this note.
  await logEventSafe(env.DB, {
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
};

// The admin has no log viewer, so "see logs" was a dead end — a refund that
// failed said only that it had. Put the gateway's own words on screen instead,
// flattened to something a redirect URL can carry.
function gatewayDetail(err: unknown): string {
  const raw = String(err instanceof Error ? err.message : err)
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return 'no detail from the gateway';
  return raw.length > 300 ? `${raw.slice(0, 299)}…` : raw;
}

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
