// Direct PayPal Business gateway — the second payment provider alongside
// Stripe. Raw `fetch` against the PayPal REST API, no SDK, mirroring the shape
// of src/lib/registrations/stripe.ts.
//
//   • One-off payments  → Orders API v2 (create → buyer approves → capture).
//   • Installment plans → Subscriptions API: a fixed `total_cycles = N` monthly
//     billing plan that completes after exactly N charges (the PayPal-native
//     equivalent of the Stripe cancel_at trick — no juggling needed).
//
// Gated: paypalConfigured(env) is false until PAYPAL_CLIENT_ID +
// PAYPAL_CLIENT_SECRET are set, so this ships inert. PAYPAL_ENV switches between
// the sandbox and live hosts. PAYPAL_WEBHOOK_ID verifies inbound webhooks.
//
// Quaderno note: PayPal has its own Quaderno connector (like Stripe's). Quaderno
// reads the transaction's item names + buyer info to build the invoice, so every
// order/subscription here carries descriptive `items[].name` / plan names and the
// payer's name + email + country — mirroring what we send Stripe.

import type { SubscriptionStatus } from '../courses/db';

export type PaypalEnv = {
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_ENV?: string;
  PAYPAL_WEBHOOK_ID?: string;
};

const LIVE_BASE = 'https://api-m.paypal.com';
const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';

// Whether the direct PayPal gateway is wired up. Both id + secret required.
// This is the RUNTIME guard (secrets exist at request time) — use it in API
// endpoints / webhooks / the return handler.
export function paypalConfigured(env: PaypalEnv): boolean {
  return !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
}

// Whether to OFFER the "Pay with PayPal" button in the UI. Gated on a public
// var (like STRIPE_ENABLE_PAYPAL) rather than the secrets, because the register
// forms live on statically-prerendered pages: their frontmatter runs at BUILD
// time, where Cloudflare secrets don't exist but wrangler `vars` do. So gating
// the button on paypalConfigured() would bake it out of the static HTML even
// when the secrets are set at runtime. The server still enforces
// paypalConfigured() before charging, so a button shown without secrets just
// returns a friendly "pay by card" error rather than a broken charge.
export function paypalOffered(env: { PAYPAL_ENABLED?: string }): boolean {
  return env?.PAYPAL_ENABLED === 'true';
}

export function paypalBase(env: PaypalEnv): string {
  return (env.PAYPAL_ENV ?? 'live').toLowerCase() === 'sandbox'
    ? SANDBOX_BASE
    : LIVE_BASE;
}

// ── OAuth2 access token (client_credentials) ──────────────────────────────
// Cached per-isolate keyed on client id; Workers reuse isolates so this saves a
// round-trip on most requests. We refresh a minute before expiry to be safe.
type TokenCacheEntry = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenCacheEntry>();

async function getAccessToken(env: PaypalEnv): Promise<string> {
  if (!paypalConfigured(env)) {
    throw new Error('PayPal not configured (missing client id/secret)');
  }
  const id = env.PAYPAL_CLIENT_ID!;
  const secret = env.PAYPAL_CLIENT_SECRET!;
  const cacheKey = `${paypalBase(env)}:${id}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const basic = btoa(`${id}:${secret}`);
  const res = await fetch(`${paypalBase(env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(`PayPal oauth: ${body.error_description ?? res.status}`);
  }
  tokenCache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3000) * 1000,
  });
  return body.access_token;
}

// Authenticated JSON request helper. Throws a descriptive Error on non-2xx.
async function ppFetch<T>(
  env: PaypalEnv,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const token = await getAccessToken(env);
  const res = await fetch(`${paypalBase(env)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as any) : {};
  if (!res.ok) {
    const msg = data?.message || data?.error_description || `HTTP ${res.status}`;
    const detail = data?.details
      ? ` ${JSON.stringify(data.details)}`
      : data?.name
        ? ` (${data.name})`
        : '';
    throw new Error(`PayPal ${method} ${path}: ${msg}${detail}`);
  }
  return data as T;
}

// PayPal amounts are MAJOR units as 2dp strings ("650.00"). None of the
// configured currencies (EUR/USD/CAD/GBP/CHF/NOK/SEK/DKK/AUD/NZD) are
// zero-decimal, so 2dp is always correct here.
export function minorToPaypalAmount(amountMinor: number): string {
  return (Math.round(amountMinor) / 100).toFixed(2);
}

function linkHref(
  links: Array<{ rel?: string; href?: string }> | undefined,
  rel: string,
): string | null {
  return links?.find((l) => l.rel === rel)?.href ?? null;
}

// ── Orders API v2 (one-off payments) ──────────────────────────────────────

export type PaypalItem = {
  name: string; // <=127 chars; Quaderno reads this as the invoice line name
  description?: string; // <=127
  amountMinor: number; // unit price, minor units
  quantity?: number; // default 1
  // PayPal item category. DIGITAL_GOODS for courses (eservice), PHYSICAL_GOODS
  // for retreat tickets (a physical event). Defaults to DIGITAL_GOODS.
  category?: 'DIGITAL_GOODS' | 'PHYSICAL_GOODS' | 'DONATION';
};

export type PaypalPayer = {
  email?: string;
  firstName?: string;
  lastName?: string;
  countryCode?: string; // ISO-2
};

export type CreateOrderInput = {
  env: PaypalEnv;
  currency: string; // ISO-4217 (upper)
  items: PaypalItem[];
  customId: string; // routing key, e.g. 'course:123' (<=127)
  description?: string; // purchase-unit description (<=127); Quaderno reads it
  softDescriptor?: string; // statement descriptor (<=22)
  invoiceId?: string; // optional unique merchant reference
  returnUrl: string;
  cancelUrl: string;
  brandName?: string;
  payer?: PaypalPayer;
  requestId?: string; // PayPal-Request-Id idempotency key
};

export type PaypalCapture = {
  orderId: string;
  status: string; // order status: COMPLETED / APPROVED / …
  captureId: string | null;
  captureStatus: string | null; // COMPLETED / PENDING / DECLINED …
  amountMinor: number | null;
  currency: string | null;
  customId: string | null;
  payerEmail: string | null;
};

type PaypalOrderResource = {
  id: string;
  status: string;
  links?: Array<{ rel?: string; href?: string }>;
  purchase_units?: Array<{
    custom_id?: string;
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        custom_id?: string;
        amount?: { value?: string; currency_code?: string };
      }>;
    };
  }>;
  payer?: { email_address?: string };
};

// Create an order and return its id + the buyer-facing approve URL.
export async function createOrder(
  input: CreateOrderInput,
): Promise<{ id: string; approveUrl: string }> {
  const currency = input.currency.toUpperCase();
  const items = input.items.map((it) => ({
    name: it.name.slice(0, 127),
    ...(it.description ? { description: it.description.slice(0, 127) } : {}),
    quantity: String(it.quantity ?? 1),
    unit_amount: {
      currency_code: currency,
      value: minorToPaypalAmount(it.amountMinor),
    },
    category: it.category ?? 'DIGITAL_GOODS',
  }));
  const totalMinor = input.items.reduce(
    (sum, it) => sum + it.amountMinor * (it.quantity ?? 1),
    0,
  );
  const totalValue = minorToPaypalAmount(totalMinor);

  const requestBody = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        custom_id: input.customId.slice(0, 127),
        ...(input.description
          ? { description: input.description.slice(0, 127) }
          : {}),
        ...(input.softDescriptor
          ? { soft_descriptor: input.softDescriptor.slice(0, 22) }
          : {}),
        ...(input.invoiceId ? { invoice_id: input.invoiceId.slice(0, 127) } : {}),
        amount: {
          currency_code: currency,
          value: totalValue,
          breakdown: {
            item_total: { currency_code: currency, value: totalValue },
          },
        },
        items,
      },
    ],
    ...(input.payer
      ? {
          payer: {
            ...(input.payer.email ? { email_address: input.payer.email } : {}),
            ...(input.payer.firstName || input.payer.lastName
              ? {
                  name: {
                    given_name: input.payer.firstName ?? '',
                    surname: input.payer.lastName ?? '',
                  },
                }
              : {}),
            ...(input.payer.countryCode
              ? { address: { country_code: input.payer.countryCode } }
              : {}),
          },
        }
      : {}),
    application_context: {
      ...(input.brandName ? { brand_name: input.brandName } : {}),
      landing_page: 'NO_PREFERENCE',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
    },
  };

  const order = await ppFetch<PaypalOrderResource>(
    input.env,
    'POST',
    '/v2/checkout/orders',
    requestBody,
    input.requestId ? { 'PayPal-Request-Id': input.requestId } : undefined,
  );
  const approveUrl = linkHref(order.links, 'approve') ?? linkHref(order.links, 'payer-action');
  if (!approveUrl) {
    throw new Error('PayPal create order: no approve link returned');
  }
  return { id: order.id, approveUrl };
}

function extractCapture(order: PaypalOrderResource): PaypalCapture {
  const pu = order.purchase_units?.[0];
  const cap = pu?.payments?.captures?.[0];
  return {
    orderId: order.id,
    status: order.status,
    captureId: cap?.id ?? null,
    captureStatus: cap?.status ?? null,
    amountMinor: cap?.amount?.value
      ? Math.round(parseFloat(cap.amount.value) * 100)
      : null,
    currency: cap?.amount?.currency_code ?? null,
    customId: cap?.custom_id ?? pu?.custom_id ?? null,
    payerEmail: order.payer?.email_address ?? null,
  };
}

// Capture an approved order. Idempotent-ish: if PayPal reports the order was
// already captured, we re-read it and return the existing capture instead of
// throwing, so the return endpoint + webhook backstop never collide.
export async function captureOrder(
  env: PaypalEnv,
  orderId: string,
): Promise<PaypalCapture> {
  try {
    const order = await ppFetch<PaypalOrderResource>(
      env,
      'POST',
      `/v2/checkout/orders/${orderId}/capture`,
      {},
    );
    return extractCapture(order);
  } catch (err) {
    if (/ORDER_ALREADY_CAPTURED/i.test(String(err))) {
      return getOrder(env, orderId);
    }
    throw err;
  }
}

export async function getOrder(
  env: PaypalEnv,
  orderId: string,
): Promise<PaypalCapture> {
  const order = await ppFetch<PaypalOrderResource>(
    env,
    'GET',
    `/v2/checkout/orders/${orderId}`,
  );
  return extractCapture(order);
}

// ── Subscriptions API (installment plans) ─────────────────────────────────

export type CreateSubscriptionInput = {
  env: PaypalEnv;
  // Human label for the product/plan — Quaderno reads the product + plan name
  // for the invoice line, so pass the course title here.
  productName: string;
  productDescription?: string;
  planName: string; // e.g. "12-Week Course — 3-month plan"
  monthlyAmountMinor: number;
  currency: string; // ISO-4217 (upper)
  installmentCount: number; // total_cycles, e.g. 3
  customId: string; // routing key, e.g. 'course:123'
  returnUrl: string;
  cancelUrl: string;
  brandName?: string;
  subscriber?: PaypalPayer;
  requestId?: string;
  // One-off charge taken at subscription start (PayPal's plan setup_fee) — the
  // PayPal equivalent of a Stripe one-time line item on the first invoice. Used
  // for order bumps bought alongside an installment plan. Omit / 0 for none.
  setupFeeMinor?: number;
};

// Create product → plan → subscription, returning the subscription id + the
// buyer-facing approve URL. Product + plan are created fresh each checkout
// (PayPal requires a plan_id; amounts vary per currency/discount, so a shared
// catalog plan wouldn't fit). Volume here is low (checkout-time only).
export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<{ subscriptionId: string; approveUrl: string }> {
  const currency = input.currency.toUpperCase();

  const product = await ppFetch<{ id: string }>(
    input.env,
    'POST',
    '/v1/catalogs/products',
    {
      name: input.productName.slice(0, 127),
      ...(input.productDescription
        ? { description: input.productDescription.slice(0, 256) }
        : {}),
      type: 'SERVICE',
      category: 'EDUCATIONAL_AND_TEXTBOOKS',
    },
  );

  const plan = await ppFetch<{ id: string }>(
    input.env,
    'POST',
    '/v1/billing/plans',
    {
      product_id: product.id,
      name: input.planName.slice(0, 127),
      status: 'ACTIVE',
      billing_cycles: [
        {
          frequency: { interval_unit: 'MONTH', interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: input.installmentCount, // finite → completes after N
          pricing_scheme: {
            fixed_price: {
              value: minorToPaypalAmount(input.monthlyAmountMinor),
              currency_code: currency,
            },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        // A non-zero setup_fee is charged once when the subscription is
        // activated (the order bump). CONTINUE means a setup-fee hiccup never
        // blocks the plan itself.
        ...(input.setupFeeMinor && input.setupFeeMinor > 0
          ? {
              setup_fee: {
                value: minorToPaypalAmount(input.setupFeeMinor),
                currency_code: currency,
              },
            }
          : {}),
        setup_fee_failure_action: 'CONTINUE',
        payment_failure_threshold: 2,
      },
    },
  );

  const sub = await ppFetch<{
    id: string;
    status: string;
    links?: Array<{ rel?: string; href?: string }>;
  }>(
    input.env,
    'POST',
    '/v1/billing/subscriptions',
    {
      plan_id: plan.id,
      custom_id: input.customId.slice(0, 127),
      ...(input.subscriber
        ? {
            subscriber: {
              ...(input.subscriber.email
                ? { email_address: input.subscriber.email }
                : {}),
              ...(input.subscriber.firstName || input.subscriber.lastName
                ? {
                    name: {
                      given_name: input.subscriber.firstName ?? '',
                      surname: input.subscriber.lastName ?? '',
                    },
                  }
                : {}),
            },
          }
        : {}),
      application_context: {
        ...(input.brandName ? { brand_name: input.brandName } : {}),
        shipping_preference: 'NO_SHIPPING',
        user_action: 'SUBSCRIBE_NOW',
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    },
    input.requestId ? { 'PayPal-Request-Id': input.requestId } : undefined,
  );

  const approveUrl = linkHref(sub.links, 'approve');
  if (!approveUrl) {
    throw new Error('PayPal create subscription: no approve link returned');
  }
  return { subscriptionId: sub.id, approveUrl };
}

export type PaypalSubscription = {
  id: string;
  status: string; // APPROVAL_PENDING / APPROVED / ACTIVE / SUSPENDED / CANCELLED / EXPIRED
  customId: string | null;
  cyclesCompleted: number | null;
};

export async function getSubscription(
  env: PaypalEnv,
  subscriptionId: string,
): Promise<PaypalSubscription> {
  const sub = await ppFetch<{
    id: string;
    status: string;
    custom_id?: string;
    billing_info?: {
      cycle_executions?: Array<{
        tenure_type?: string;
        cycles_completed?: number;
      }>;
    };
  }>(env, 'GET', `/v1/billing/subscriptions/${subscriptionId}`);
  const regular = sub.billing_info?.cycle_executions?.find(
    (c) => c.tenure_type === 'REGULAR',
  );
  return {
    id: sub.id,
    status: sub.status,
    customId: sub.custom_id ?? null,
    cyclesCompleted: regular?.cycles_completed ?? null,
  };
}

// A settled (or refunded) cycle payment on a subscription. `id` is the sale
// transaction id — the SAME value the PAYMENT.SALE.COMPLETED webhook delivers as
// `resource.id` — so recording off this list produces the identical events-log
// idempotency key as the webhook path, and the two converge without double-count.
export type PaypalSubscriptionTransaction = {
  id: string;
  status: string; // COMPLETED / DENIED / PARTIALLY_REFUNDED / REFUNDED / PENDING
  amountMinor: number | null;
  currency: string | null;
  time: string | null; // RFC-3339
};

// List a subscription's transactions (Subscriptions API v1). `start_time` and
// `end_time` are REQUIRED by PayPal (RFC-3339 with a trailing Z) — omitting them
// is a VALIDATION_ERROR, not "return everything". Used by the reconcile sweep to
// recover cycles a missed/unverified webhook never recorded.
export async function listSubscriptionTransactions(
  env: PaypalEnv,
  subscriptionId: string,
  startTimeIso: string,
  endTimeIso: string,
): Promise<PaypalSubscriptionTransaction[]> {
  const qs = `start_time=${encodeURIComponent(startTimeIso)}&end_time=${encodeURIComponent(endTimeIso)}`;
  const res = await ppFetch<{
    transactions?: Array<{
      id?: string;
      status?: string;
      amount_with_breakdown?: {
        gross_amount?: { value?: string; currency_code?: string };
      };
      time?: string;
    }>;
  }>(env, 'GET', `/v1/billing/subscriptions/${subscriptionId}/transactions?${qs}`);
  return (res.transactions ?? [])
    .filter((t) => t.id)
    .map((t) => ({
      id: t.id!,
      status: (t.status ?? '').toUpperCase(),
      amountMinor: t.amount_with_breakdown?.gross_amount?.value
        ? Math.round(parseFloat(t.amount_with_breakdown.gross_amount.value) * 100)
        : null,
      currency: t.amount_with_breakdown?.gross_amount?.currency_code ?? null,
      time: t.time ?? null,
    }));
}

export async function cancelSubscription(
  env: PaypalEnv,
  subscriptionId: string,
  reason = 'Cancelled by Songdance',
): Promise<void> {
  await ppFetch(
    env,
    'POST',
    `/v1/billing/subscriptions/${subscriptionId}/cancel`,
    { reason },
  );
}

// Map a PayPal subscription status onto the Stripe vocabulary stored in
// course_registrations.subscription_status, so the course detail badge + the
// future-revenue forecast (both written for Stripe enums) stay provider-
// agnostic. EXPIRED means the finite plan completed all N cycles — the same
// terminal state Stripe reaches via cancel_at, so it maps to 'canceled'.
export function normalizePaypalSubStatus(status: string): SubscriptionStatus {
  switch ((status || '').toUpperCase()) {
    case 'ACTIVE':
    case 'APPROVED':
      return 'active';
    case 'APPROVAL_PENDING':
      return 'incomplete';
    case 'SUSPENDED':
      return 'past_due';
    case 'CANCELLED':
    case 'EXPIRED':
      return 'canceled';
    default:
      return 'incomplete';
  }
}

// ── Refunds (Payments API v2) ─────────────────────────────────────────────

export async function refundCapture(input: {
  env: PaypalEnv;
  captureId: string;
  amountMinor?: number | null; // omit for a full refund
  currency?: string | null; // required when amountMinor is given
  noteToPayer?: string;
  customId?: string;
  requestId?: string;
}): Promise<{ id: string; status: string; amountMinor: number | null }> {
  const body: Record<string, unknown> = {};
  if (input.amountMinor != null && input.currency) {
    body.amount = {
      value: minorToPaypalAmount(input.amountMinor),
      currency_code: input.currency.toUpperCase(),
    };
  }
  if (input.noteToPayer) body.note_to_payer = input.noteToPayer.slice(0, 255);
  if (input.customId) body.custom_id = input.customId.slice(0, 127);

  const refund = await ppFetch<{
    id: string;
    status: string;
    amount?: { value?: string };
  }>(
    input.env,
    'POST',
    `/v2/payments/captures/${input.captureId}/refund`,
    body,
    input.requestId ? { 'PayPal-Request-Id': input.requestId } : undefined,
  );
  return {
    id: refund.id,
    status: refund.status,
    amountMinor: refund.amount?.value
      ? Math.round(parseFloat(refund.amount.value) * 100)
      : null,
  };
}

// Refund a subscription cycle payment (a v1 "sale" object — installment
// charges fire PAYMENT.SALE.COMPLETED, refunded via the v1 sale endpoint, not
// the v2 captures endpoint). Used when refunding a PayPal installment plan.
export async function refundSale(input: {
  env: PaypalEnv;
  saleId: string;
  amountMinor?: number | null;
  currency?: string | null;
  noteToPayer?: string;
}): Promise<{ id: string; status: string; amountMinor: number | null }> {
  const body: Record<string, unknown> = {};
  if (input.amountMinor != null && input.currency) {
    body.amount = {
      total: minorToPaypalAmount(input.amountMinor),
      currency: input.currency.toUpperCase(),
    };
  }
  if (input.noteToPayer) body.description = input.noteToPayer.slice(0, 255);
  const refund = await ppFetch<{
    id: string;
    state?: string;
    status?: string;
    amount?: { total?: string };
  }>(input.env, 'POST', `/v1/payments/sale/${input.saleId}/refund`, body);
  return {
    id: refund.id,
    status: refund.status ?? refund.state ?? 'completed',
    amountMinor: refund.amount?.total
      ? Math.round(parseFloat(refund.amount.total) * 100)
      : null,
  };
}

// ── Webhook signature verification ────────────────────────────────────────
// PayPal's recommended path: POST the transmission headers + the parsed event
// back to /v1/notifications/verify-webhook-signature with our webhook id.
// Returns true only on verification_status === 'SUCCESS'. Fails closed.
export async function verifyPaypalWebhook(
  env: PaypalEnv,
  headers: Headers,
  rawBody: string,
): Promise<boolean> {
  if (!env.PAYPAL_WEBHOOK_ID) return false;
  const h = (name: string) => headers.get(name) ?? '';
  const transmissionId = h('paypal-transmission-id');
  const transmissionTime = h('paypal-transmission-time');
  const transmissionSig = h('paypal-transmission-sig');
  const certUrl = h('paypal-cert-url');
  const authAlgo = h('paypal-auth-algo');
  if (!transmissionId || !transmissionSig || !certUrl) return false;

  let webhookEvent: unknown;
  try {
    webhookEvent = JSON.parse(rawBody);
  } catch {
    return false;
  }

  try {
    const res = await ppFetch<{ verification_status?: string }>(
      env,
      'POST',
      '/v1/notifications/verify-webhook-signature',
      {
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: env.PAYPAL_WEBHOOK_ID,
        webhook_event: webhookEvent,
      },
    );
    return res.verification_status === 'SUCCESS';
  } catch {
    return false;
  }
}
