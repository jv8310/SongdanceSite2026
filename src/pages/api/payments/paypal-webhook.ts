import type { APIRoute } from 'astro';
import { eventExists, logEvent, logEventSafe } from '../../../lib/registrations/db';
import {
  captureOrder,
  captureSettlement,
  getOrder,
  verifyPaypalWebhook,
  type PaypalCapture,
} from '../../../lib/payments/paypal';
import { decodeCustomId } from '../../../lib/payments/provider';
import {
  applyPaypalSubscriptionStatus,
  fulfillBalancePaypal,
  fulfillCoursePaypalOneOff,
  fulfillRetreatPaypalOneOff,
  fulfillWorkshopPaypalCapture,
  recordCoursePaypalSubscriptionSale,
  recordPaypalRefund,
  type PaypalFulfillEnv,
} from '../../../lib/payments/paypal-fulfill';
import { getCourseRegistrationByPaypalSubscription } from '../../../lib/courses/db';

export const prerender = false;

// Route a one-off capture to the right table by its "<kind>:<id>" custom_id.
async function fulfillOneOff(
  env: PaypalFulfillEnv,
  capture: PaypalCapture,
  ctx?: { waitUntil?: (p: Promise<unknown>) => void },
): Promise<void> {
  const routed = decodeCustomId(capture.customId);
  if (!routed) return;
  if (routed.kind === 'course') {
    await fulfillCoursePaypalOneOff(env, routed.id, capture);
  } else if (routed.kind === 'retreat') {
    await fulfillRetreatPaypalOneOff(env, routed.id, capture);
  } else if (routed.kind === 'balance') {
    await fulfillBalancePaypal(env, routed.id, capture);
  } else if (routed.kind === 'workshop') {
    await fulfillWorkshopPaypalCapture(env, routed.id, capture, ctx);
  }
}

// Parse the capture/sale id a refund resource points back to.
function refundTargetId(resource: any): string | null {
  if (resource?.sale_id) return resource.sale_id; // v1 sale refund
  const up = (resource?.links as Array<{ rel?: string; href?: string }>)?.find(
    (l) => l.rel === 'up',
  )?.href;
  if (up) {
    const m = up.match(/\/(?:captures|sale)\/([^/?]+)/);
    if (m) return m[1];
  }
  return null;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env as unknown as PaypalFulfillEnv & {
    PAYPAL_CLIENT_ID?: string;
    PAYPAL_CLIENT_SECRET?: string;
    PAYPAL_ENV?: string;
    PAYPAL_WEBHOOK_ID?: string;
  };
  const ctxRaw = (locals.runtime as any)?.ctx;
  const ctx = ctxRaw
    ? { waitUntil: (p: Promise<unknown>) => ctxRaw.waitUntil(p) }
    : undefined;

  const body = await request.text();

  const verification = await verifyPaypalWebhook(env as any, request.headers, body);
  if (!verification.verified) {
    // Leave a server-side breadcrumb for a REAL PayPal delivery that failed
    // verification (has a transmission id) — a bad/missing PAYPAL_WEBHOOK_ID or
    // an app mismatch otherwise 400s every event with no trace but PayPal's own
    // dashboard. Best-effort + guarded so random unsigned POSTs can't spam the log.
    const transmissionId = request.headers.get('paypal-transmission-id');
    if (transmissionId) {
      let evt: { id?: string; event_type?: string } = {};
      try {
        evt = JSON.parse(body) as { id?: string; event_type?: string };
      } catch {
        /* body not JSON — reason will be bad_json */
      }
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'paypal.webhook.verify_failed',
        source: 'paypal',
        // Keyed on PayPal's stable event id (constant across delivery retries;
        // the transmission id changes per attempt) so a retried failure logs
        // one row, not one per retry. logEventSafe swallows the dup-key throw.
        external_id: `paypal-verify-failed-${evt.id ?? transmissionId}`,
        payload: {
          reason: verification.reason,
          event_id: evt.id ?? null,
          event_type: evt.event_type ?? null,
          transmission_id: transmissionId,
          webhook_id_present: !!(env as any).PAYPAL_WEBHOOK_ID,
        },
      });
    }
    // Still 400 so PayPal keeps retrying — once the secret is fixed, the retry
    // (or a manual Resend) delivers and fulfils through the normal path.
    return new Response('Bad signature', { status: 400 });
  }

  const event = JSON.parse(body) as {
    id: string;
    event_type: string;
    resource: any;
  };

  // Idempotency: skip events we've already processed.
  if (await eventExists(env.DB, event.id)) {
    return new Response('OK (duplicate)', { status: 200 });
  }
  await logEvent(env.DB, {
    registration_id: null,
    kind: event.event_type,
    source: 'paypal',
    external_id: event.id,
    payload: event.resource,
  });

  const type = event.event_type;
  const resource = event.resource ?? {};

  try {
    // ── Buyer approved an order but may not have hit our return endpoint.
    //    Capture it ourselves and fulfill (backstop for a closed tab).
    if (type === 'CHECKOUT.ORDER.APPROVED') {
      const orderId = resource.id as string;
      if (orderId) {
        let capture: PaypalCapture;
        try {
          capture = await captureOrder(env as any, orderId);
        } catch {
          capture = await getOrder(env as any, orderId);
        }
        if (capture.captureId && capture.captureStatus === 'COMPLETED') {
          await fulfillOneOff(env, capture, ctx);
        }
      }
      return new Response('OK', { status: 200 });
    }

    // ── One-off capture completed (card/PayPal balance). Main confirmation
    //    path if the return endpoint didn't fulfill.
    if (type === 'PAYMENT.CAPTURE.COMPLETED') {
      const amountMinor = resource?.amount?.value
        ? Math.round(parseFloat(resource.amount.value) * 100)
        : null;
      const capture: PaypalCapture = {
        orderId: resource?.supplementary_data?.related_ids?.order_id ?? '',
        status: 'COMPLETED',
        captureId: resource.id ?? null,
        captureStatus: resource.status ?? 'COMPLETED',
        amountMinor,
        currency: resource?.amount?.currency_code ?? null,
        customId: resource.custom_id ?? null,
        payerEmail: null,
        // The webhook resource IS a capture, so it carries the same
        // seller_receivable_breakdown the captured order does.
        ...captureSettlement(resource, amountMinor),
      };
      await fulfillOneOff(env, capture, ctx);
      return new Response('OK', { status: 200 });
    }

    // ── Subscription cycle settled → record an installment. The sale amount
    //    (v1 sale: amount.total, major units) routes it — a plan's order-bump
    //    setup fee settles as its own sale on the same subscription and must
    //    not bump the installment counter.
    if (type === 'PAYMENT.SALE.COMPLETED') {
      const subscriptionId = resource.billing_agreement_id as
        | string
        | undefined;
      const saleId = resource.id as string | undefined;
      if (subscriptionId && saleId) {
        const courseReg = await getCourseRegistrationByPaypalSubscription(
          env.DB,
          subscriptionId,
        );
        if (courseReg) {
          const saleMinor = resource?.amount?.total
            ? Math.round(parseFloat(resource.amount.total) * 100)
            : null;
          await recordCoursePaypalSubscriptionSale(
            env,
            courseReg,
            saleId,
            saleId,
            saleMinor,
          );
        }
      }
      return new Response('OK', { status: 200 });
    }

    // ── Subscription lifecycle → mirror status (normalised to Stripe vocab).
    if (
      type === 'BILLING.SUBSCRIPTION.ACTIVATED' ||
      type === 'BILLING.SUBSCRIPTION.UPDATED' ||
      type === 'BILLING.SUBSCRIPTION.SUSPENDED' ||
      type === 'BILLING.SUBSCRIPTION.CANCELLED' ||
      type === 'BILLING.SUBSCRIPTION.EXPIRED'
    ) {
      const subscriptionId = resource.id as string | undefined;
      const status = (resource.status as string | undefined) ?? '';
      if (subscriptionId) {
        await applyPaypalSubscriptionStatus(env, subscriptionId, status);
      }
      return new Response('OK', { status: 200 });
    }

    // ── A failed installment: log only; access stays granted (manual call).
    if (type === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED') {
      const subscriptionId = resource.id as string | undefined;
      if (subscriptionId) {
        const courseReg = await getCourseRegistrationByPaypalSubscription(
          env.DB,
          subscriptionId,
        );
        if (courseReg) {
          await logEvent(env.DB, {
            registration_id: null,
            kind: 'paypal.course.installment.failed',
            source: 'paypal',
            external_id: `${event.id}.failed`,
            payload: {
              course_registration_id: courseReg.id,
              subscription_id: subscriptionId,
            },
          });
        }
      }
      return new Response('OK', { status: 200 });
    }

    // ── Refunds (one-off capture refund + subscription sale refund).
    if (
      type === 'PAYMENT.CAPTURE.REFUNDED' ||
      type === 'PAYMENT.SALE.REFUNDED'
    ) {
      const refundId = resource.id as string | undefined;
      const captureId = refundTargetId(resource);
      if (refundId && captureId) {
        await recordPaypalRefund(env, {
          refundId,
          captureId,
          amountMinor: resource?.amount?.value
            ? Math.round(parseFloat(resource.amount.value) * 100)
            : resource?.amount?.total
              ? Math.round(parseFloat(resource.amount.total) * 100)
              : null,
          currency:
            resource?.amount?.currency_code ?? resource?.amount?.currency ?? null,
        });
      }
      return new Response('OK', { status: 200 });
    }
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'paypal.webhook.error',
      source: 'paypal',
      external_id: `${event.id}.error`,
      payload: { event_type: type, error: String(err) },
    });
    // 200 so PayPal doesn't hammer retries on a poison event; we've logged it.
    return new Response('OK (logged error)', { status: 200 });
  }

  return new Response('OK', { status: 200 });
};
