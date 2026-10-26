// One refund against one charge of one order. Two doors lead here: the Refund
// forms on /admin/orders (/api/admin/refund) and Claude's refund_order tool in
// the member app (lib/app-bridge/refund.ts, through AppBridge). Both re-derive
// the order from its number; this module alone decides which charge a refund
// lands on, how much is left on it, how the gateway is asked and how the
// refund is recorded, so the two doors cannot drift.
//
// ONE CHARGE AT A TIME. A course installment plan is N separate charges at the
// gateway, but the row stores the plan TOTAL and only the FIRST charge id. A
// cycle is therefore named (a Stripe invoice id / PayPal sale id from the form,
// or its number from the app) and looked up in the ledger built from this
// order's own subscription id (installments.ts), which is both the lookup and
// the authorisation check. Without a cycle the target is the row's single
// stored charge, so for a plan the ceiling is ONE charge, never the plan total.
//
// RECORDING. Stripe's `charge.refunded` webhook is the single writer that moves
// our rows, so a Stripe refund writes nothing here but an audit event. PayPal
// has no such guarantee, so that path records its own refund, idempotently on
// the refund id.

import { logEventSafe } from '../registrations/db';
import {
  createRefund,
  listRefundsForPaymentIntent,
  refundedMinorOf,
  retrievePaymentIntent,
} from '../registrations/stripe';
import {
  getCapture,
  paypalConfigured,
  paypalRefundHint,
  refundCapture,
  refundSubscriptionCycle,
} from '../payments/paypal';
import { recordPaypalRefund } from '../payments/paypal-fulfill';
import type { UnifiedOrder } from './orders';
import {
  findOrderInstallment,
  hasInstallmentLedger,
  installmentRefundableMinor,
  listOrderInstallments,
  perChargeRefundableMinor,
  type Installment,
} from './installments';

// Who asked: the admin's form, or Claude through the member app.
export type RefundDoor = 'admin' | 'app';

export type RefundTarget = {
  provider: 'stripe' | 'paypal';
  // What the gateway reverses: a Stripe PaymentIntent, or a PayPal capture /
  // subscription sale id.
  charge: string;
  // The plan cycle, when the refund is one installment of a plan.
  installment: Installment | null;
  // What may still go back on that charge, in `currency` (what the gateway
  // charged, which is what a partial refund must be expressed in).
  remainingMinor: number;
  currency: string;
};

export type TargetAnswer =
  | { ok: true; target: RefundTarget }
  | { ok: false; message: string };

// " · installment 2" — the suffix every message about a cycle carries.
export function cycleNote(target: RefundTarget): string {
  return target.installment ? ` · installment ${target.installment.seq}` : '';
}

// Resolve the charge to refund. With an installment (its gateway id from the
// form, or its number from the app), that cycle, proven to belong to this
// order by finding it in the order's own ledger. Without one, the single
// charge the row stores.
export async function resolveRefundTarget(
  env: Env,
  order: UnifiedOrder,
  pick: { installmentId?: string | null; installmentSeq?: number | null },
  door: RefundDoor,
): Promise<TargetAnswer> {
  const provider = order.provider === 'paypal' ? 'paypal' : 'stripe';
  const wanted = pick.installmentId || (pick.installmentSeq ? `#${pick.installmentSeq}` : '');

  if (!wanted) {
    const charge = provider === 'paypal' ? order.paypalCaptureId : order.paymentIntent;
    if (!charge) {
      return {
        ok: false,
        message: provider === 'paypal' ? 'No PayPal payment to refund' : 'Order is not refundable',
      };
    }
    return {
      ok: true,
      target: {
        provider,
        charge,
        installment: null,
        remainingMinor: perChargeRefundableMinor(order),
        currency: order.originalCurrency,
      },
    };
  }

  if (!hasInstallmentLedger(order)) {
    return { ok: false, message: 'This order has no installment plan' };
  }
  let found: Awaited<ReturnType<typeof findOrderInstallment>>;
  if (pick.installmentId) {
    found = await findOrderInstallment(env, order, pick.installmentId);
  } else {
    const ledger = await listOrderInstallments(env, order);
    const hit = ledger?.rows.find((r) => r.seq === pick.installmentSeq);
    found = !ledger
      ? { ok: false, reason: 'no_plan', error: null }
      : ledger.error
        ? { ok: false, reason: 'gateway_error', error: ledger.error }
        : hit
          ? { ok: true, installment: hit }
          : { ok: false, reason: 'not_found', error: null };
  }
  if (!found.ok) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'admin.refund.failed',
      source: door,
      payload: {
        order_no: order.orderNo,
        installment: wanted,
        reason: found.reason,
        error: found.error,
      },
    });
    return {
      ok: false,
      message:
        found.reason === 'gateway_error'
          ? 'Could not read the plan from the payment provider — try again'
          : found.reason === 'not_found'
            ? 'That installment is not on this order’s plan'
            : 'This order has no installment plan',
    };
  }
  const cycle = found.installment;
  if (!cycle.refundTarget) {
    return { ok: false, message: 'No charge recorded for that installment' };
  }
  const remainingMinor = installmentRefundableMinor(cycle);
  if (remainingMinor <= 0) {
    return { ok: false, message: `Installment ${cycle.seq} is already fully refunded` };
  }
  return {
    ok: true,
    target: {
      provider,
      charge: cycle.refundTarget,
      installment: cycle,
      remainingMinor,
      // A cycle answers for itself, so an order row that disagrees with the
      // charge can't send PayPal a mismatched amount.
      currency: cycle.currency ? cycle.currency.toUpperCase() : order.originalCurrency,
    },
  };
}

// What is really left on a single (non-installment) charge, asked of the
// gateway. The row's own figure is only an estimate of that charge: a course
// row's amount leaves out the order bumps charged with it, and a retreat row's
// grows when the balance is paid, which is another charge. The app's door
// states the amount in its confirmation, so it reads the truth first. (An
// installment's figure comes from the ledger, which is already the gateway's.)
export async function readChargeRemaining(
  env: Env,
  order: UnifiedOrder,
  target: RefundTarget,
): Promise<TargetAnswer> {
  if (target.installment) return { ok: true, target };
  try {
    if (target.provider === 'stripe') {
      if (!env.STRIPE_SECRET_KEY) return { ok: false, message: 'Stripe is not configured' };
      const [pi, refunds] = await withTimeout(
        Promise.all([
          retrievePaymentIntent(env.STRIPE_SECRET_KEY, target.charge),
          listRefundsForPaymentIntent(env.STRIPE_SECRET_KEY, target.charge),
        ]),
        'Stripe',
      );
      return {
        ok: true,
        target: {
          ...target,
          remainingMinor: Math.max(0, pi.amountReceived - refundedMinorOf(refunds)),
          currency: pi.currency || target.currency,
        },
      };
    }
    if (!paypalConfigured(env)) return { ok: false, message: 'PayPal is not configured' };
    const capture = await withTimeout(getCapture(env, target.charge), 'PayPal');
    const taken = capture.amountMinor ?? 0;
    // PayPal names a refunded state, not a figure: what our books hold is the
    // best measure of a partial one, and PayPal refuses an over-refund anyway.
    const back =
      capture.status === 'REFUNDED'
        ? taken
        : capture.status === 'PARTIALLY_REFUNDED'
          ? order.refundedMinor
          : 0;
    return {
      ok: true,
      target: {
        ...target,
        remainingMinor: Math.max(0, taken - back),
        currency: capture.currency || target.currency,
      },
    };
  } catch (err) {
    return {
      ok: false,
      message: `Could not read the payment from ${target.provider === 'paypal' ? 'PayPal' : 'Stripe'} — try again (${gatewayDetail(err)})`,
    };
  }
}

export type RefundOutcome =
  // The gateway took the refund and our books follow (for Stripe, through the
  // webhook a moment later).
  | {
      status: 'refunded';
      provider: 'stripe' | 'paypal';
      refundId: string;
      amountMinor: number;
      currency: string;
    }
  // PayPal took the refund, but recording it here failed. The money HAS gone
  // back: nobody may read this as "nothing happened" and refund again.
  | {
      status: 'unrecorded';
      provider: 'paypal';
      refundId: string;
      amountMinor: number;
      currency: string;
      detail: string;
    }
  // The gateway refused. Nothing moved.
  | { status: 'failed'; provider: 'stripe' | 'paypal'; detail: string };

// Ask the gateway for the refund and record it. `amountMinor` null = whatever
// is left on that charge (the gateway's own "full"); otherwise it must already
// be checked against `target.remainingMinor`. `requestKey` makes a repeat of
// the same request the same refund at the gateway (Idempotency-Key /
// PayPal-Request-Id), never a second one.
export async function issueRefund(
  env: Env,
  order: UnifiedOrder,
  target: RefundTarget,
  amountMinor: number | null,
  opts: { door: RefundDoor; actor?: string; note?: string; requestKey?: string },
): Promise<RefundOutcome> {
  const installment = target.installment?.id ?? null;
  const asked = {
    ...(opts.actor ? { actor: opts.actor } : {}),
    ...(opts.note ? { note: opts.note } : {}),
    ...(opts.requestKey ? { request_key: opts.requestKey } : {}),
  };

  if (target.provider === 'paypal') {
    const currency = target.currency;
    // THE GATEWAY CALL STANDS ALONE. Everything after it runs against money
    // that has already moved, so only this try may answer "failed".
    // `via` says which PayPal endpoint actually took the refund — worth
    // knowing while the deprecated v1 path is still there as a fallback.
    let refund: { id: string; status: string; amountMinor: number | null; via?: 'capture' | 'sale' };
    try {
      refund = order.paypalSubscriptionId
        ? await refundSubscriptionCycle({
            env,
            saleId: target.charge,
            amountMinor,
            currency,
            noteToPayer: `Refund for ${order.orderNo}`,
            customId: order.orderNo,
            requestId: opts.requestKey,
          })
        : await refundCapture({
            env,
            captureId: target.charge,
            amountMinor,
            currency,
            noteToPayer: `Refund for ${order.orderNo}`,
            customId: order.orderNo,
            requestId: opts.requestKey,
          });
    } catch (err) {
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'admin.refund.failed',
        source: opts.door,
        payload: {
          order_no: order.orderNo,
          provider: 'paypal',
          capture_id: target.charge,
          installment,
          amount_minor: amountMinor,
          currency,
          error: String(err),
          ...asked,
        },
      });
      return { status: 'failed', provider: 'paypal', detail: gatewayDetail(err) };
    }

    // PayPal has moved the money. From here on nothing may report a plain
    // failure: "PayPal refund failed" would be read as "nothing happened" and
    // the next press would hand the same cycle back a second time. Bookkeeping
    // trouble is a WARNING that names the refund and says not to retry.
    const delta = refund.amountMinor ?? amountMinor ?? target.remainingMinor;
    let bookkeepingError: string | null = null;
    try {
      await recordPaypalRefund(env, {
        refundId: refund.id,
        captureId: target.charge,
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
      source: opts.door,
      external_id: `paypal-refund-${refund.id}`,
      payload: {
        order_no: order.orderNo,
        source: order.source,
        row_id: order.rowId,
        provider: 'paypal',
        capture_id: target.charge,
        installment,
        refund_id: refund.id,
        amount_minor: delta,
        currency,
        full: amountMinor == null,
        via: refund.via ?? 'capture',
        record_error: bookkeepingError,
        ...asked,
      },
    });
    return bookkeepingError
      ? { status: 'unrecorded', provider: 'paypal', refundId: refund.id, amountMinor: delta, currency, detail: bookkeepingError }
      : { status: 'refunded', provider: 'paypal', refundId: refund.id, amountMinor: delta, currency };
  }

  // The Stripe side splits the same way: the gateway call alone may answer
  // "failed", because a refund Stripe accepted is money already on its way back.
  let refund: { id: string; amount: number; currency: string };
  try {
    refund = await createRefund({
      secretKey: env.STRIPE_SECRET_KEY,
      paymentIntent: target.charge,
      amountMinor,
      reason: 'requested_by_customer',
      metadata: {
        order_no: order.orderNo,
        source: order.source,
        ...(installment ? { installment } : {}),
        ...(opts.door === 'app' && opts.actor ? { requested_by: `app:${opts.actor}`.slice(0, 200) } : {}),
      },
      idempotencyKey: opts.requestKey,
    });
  } catch (err) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'admin.refund.failed',
      source: opts.door,
      payload: {
        order_no: order.orderNo,
        provider: 'stripe',
        payment_intent: target.charge,
        installment,
        amount_minor: amountMinor,
        error: String(err),
        ...asked,
      },
    });
    return { status: 'failed', provider: 'stripe', detail: gatewayDetail(err) };
  }

  // Our row is written by the `charge.refunded` webhook — the single writer —
  // so there is no bookkeeping here to fail, only this note.
  await logEventSafe(env.DB, {
    registration_id: order.source === 'retreat' ? order.rowId : null,
    kind: 'admin.refund.requested',
    source: opts.door,
    external_id: `refund-${refund.id}`,
    payload: {
      order_no: order.orderNo,
      source: order.source,
      row_id: order.rowId,
      payment_intent: target.charge,
      installment,
      refund_id: refund.id,
      amount_minor: refund.amount,
      currency: refund.currency,
      full: amountMinor == null,
      ...asked,
    },
  });
  return {
    status: 'refunded',
    provider: 'stripe',
    refundId: refund.id,
    amountMinor: refund.amount,
    currency: refund.currency.toUpperCase(),
  };
}

// The admin has no log viewer, so "see logs" was a dead end — a refund that
// failed said only that it had. Put the gateway's own words on screen instead,
// flattened to something a redirect URL can carry.
//
// The plain sentence goes FIRST. PayPal buries the actionable half at the end
// of a long description ("…please check to see if you have sufficient funds"),
// which is precisely what the trim below cuts off, so leading with the hint is
// what makes the banner worth reading.
export function gatewayDetail(err: unknown): string {
  const raw = String(err instanceof Error ? err.message : err)
    .replace(/\s+/g, ' ')
    .trim();
  const hint = paypalRefundHint(err);
  if (!raw) return hint ?? 'no detail from the gateway';
  return hint ? `${hint} (${trim(raw, 300)})` : trim(raw, 400);
}

function trim(raw: string, max: number): string {
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}

// A gateway that hangs must not hang the caller (the same 8s cap the ledger uses).
function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), 8000)),
  ]);
}
