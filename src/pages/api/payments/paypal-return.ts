import type { APIRoute } from 'astro';
import {
  captureOrder,
  getSubscription,
  paypalConfigured,
  type PaypalCapture,
} from '../../../lib/payments/paypal';
import { decodeCustomId } from '../../../lib/payments/provider';
import {
  applyPaypalSubscriptionStatus,
  fulfillBalancePaypal,
  fulfillCoursePaypalOneOff,
  fulfillRetreatPaypalOneOff,
  fulfillWorkshopPaypalCapture,
  type PaypalFulfillEnv,
} from '../../../lib/payments/paypal-fulfill';
import { logEvent } from '../../../lib/registrations/db';

export const prerender = false;

// Where the buyer lands after approving on PayPal. We capture the order (or
// confirm the subscription) here — synchronously, so the thanks page can show a
// confirmed state immediately — then redirect to the dest page. The webhook is
// the async backstop; fulfillment is idempotent, so the two never collide.
//
// PayPal appends `?token=<orderId>&PayerID=…` (one-off) or
// `?subscription_id=…&ba_token=…` (subscription) to the return_url we set, which
// already carries our own `dest` (the thanks path).

function safeDest(base: string, dest: string | null): string {
  if (dest && dest.startsWith('/')) return `${base}${dest}`;
  return `${base}/`;
}

function withParam(url: string, key: string, value: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${key}=${encodeURIComponent(value)}`;
}

export const GET: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env as unknown as PaypalFulfillEnv & {
    PAYPAL_CLIENT_ID?: string;
    PAYPAL_CLIENT_SECRET?: string;
    PAYPAL_ENV?: string;
  };
  const base = (env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  const url = new URL(request.url);
  const dest = url.searchParams.get('dest');
  const orderId = url.searchParams.get('token');
  const subscriptionId = url.searchParams.get('subscription_id');
  const redirect = (extra?: [string, string]) => {
    let target = safeDest(base, dest);
    if (extra) target = withParam(target, extra[0], extra[1]);
    return new Response(null, { status: 302, headers: { Location: target } });
  };

  const ctxRaw = (locals.runtime as any)?.ctx;
  const ctx = ctxRaw
    ? { waitUntil: (p: Promise<unknown>) => ctxRaw.waitUntil(p) }
    : undefined;

  if (!paypalConfigured(env as any)) return redirect();

  try {
    // ── Subscription: confirm + mirror status. First installment is recorded
    //    by the PAYMENT.SALE.COMPLETED webhook.
    if (subscriptionId) {
      const sub = await getSubscription(env as any, subscriptionId);
      const routed = decodeCustomId(sub.customId);
      if (routed?.kind === 'course') {
        await applyPaypalSubscriptionStatus(env, subscriptionId, sub.status);
      }
      return redirect(['paypal_sub', subscriptionId]);
    }

    // ── One-off: capture + fulfill, routed by the order's custom_id.
    if (orderId) {
      let capture: PaypalCapture | null = null;
      try {
        capture = await captureOrder(env as any, orderId);
      } catch (err) {
        await logEvent(env.DB, {
          registration_id: null,
          kind: 'paypal.return.capture.failed',
          source: 'paypal',
          payload: { order_id: orderId, error: String(err) },
        });
      }
      if (capture && capture.captureStatus === 'COMPLETED') {
        const routed = decodeCustomId(capture.customId);
        if (routed?.kind === 'course') {
          await fulfillCoursePaypalOneOff(env, routed.id, capture);
        } else if (routed?.kind === 'retreat') {
          await fulfillRetreatPaypalOneOff(env, routed.id, capture);
        } else if (routed?.kind === 'balance') {
          await fulfillBalancePaypal(env, routed.id, capture);
        } else if (routed?.kind === 'workshop') {
          await fulfillWorkshopPaypalCapture(env, routed.id, capture, ctx);
        }
      }
      return redirect(['paypal_order', orderId]);
    }
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'paypal.return.error',
      source: 'paypal',
      payload: { error: String(err) },
    }).catch(() => {});
  }

  return redirect();
};
