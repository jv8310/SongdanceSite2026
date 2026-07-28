const STRIPE_BASE = 'https://api.stripe.com/v1';

type StripeLineItem = {
  name: string;
  description?: string;
  amount_cents: number;
  currency: string;
  quantity: number;
  // Stripe Product metadata copied onto the underlying Product when the
  // line item is created. Quaderno's Stripe sync reads this `tax_class`
  // entry to decide how to tax the invoice (e.g. 'eservice' = electronic
  // service, destination-based VAT for EU consumers).
  product_metadata?: Record<string, string>;
};

export type CreateCheckoutSessionInput = {
  secretKey: string;
  // Use either a pre-created Customer id (preferred when we attached a
  // tax_id_data for B2B) or just the email (Stripe will create a Customer
  // itself on completion).
  customer?: string;
  customer_email?: string;
  success_url: string;
  cancel_url: string;
  line_items: StripeLineItem[];
  metadata: Record<string, string>;
  // Description copied onto the underlying PaymentIntent / Charge. Read
  // by the Quaderno-Stripe sync as the invoice line item name (otherwise
  // Quaderno falls back to its configured default, which is the merchant
  // name "SONGDANCE").
  payment_intent_description?: string;
  idempotency_key?: string;
  // Append PayPal to the offered payment methods (one-off payments only).
  // Caller decides via paypalEnabled(env); see the note there for why this
  // is gated rather than always-on.
  enablePaypal?: boolean;
  // Collect a shipping address on the Checkout page (a physical add-on rides
  // the order, e.g. the post-workshop Song Deck gift). Stripe requires the
  // allowed countries enumerated explicitly — pass ISO-2 codes.
  shipping_countries?: string[];
};

export type CreateCustomerInput = {
  secretKey: string;
  email: string;
  name?: string;
  phone?: string;
  // ISO-2 country of the customer (used by Stripe for tax/method filtering).
  country?: string;
  // Free-text descriptor — appears on the Stripe dashboard.
  description?: string;
  tax_id?: {
    // Stripe's tax_id types — see https://stripe.com/docs/api/customer_tax_ids
    type: 'eu_vat' | 'gb_vat';
    value: string;
  };
  metadata?: Record<string, string>;
  // Stable per registration so a retry reuses the same Stripe customer instead
  // of minting a fresh one each attempt — which both accumulates duplicate
  // customers and, because the new customer id lands in the Checkout Session
  // body, would otherwise trip Stripe's idempotency check on the session retry.
  idempotencyKey?: string;
};

// Create a Stripe Customer ahead of the Checkout session so that B2B VAT
// numbers can be attached server-side (via tax_id_data). The Quaderno-Stripe
// integration reads these tax_ids off the Stripe customer to produce the
// invoice with the right "reverse-charge / customer VAT" treatment.
// Note: tax_id_data is a free Stripe feature — it does NOT require Stripe Tax.
export async function createCustomer(input: CreateCustomerInput): Promise<{ id: string }> {
  const form = new URLSearchParams();
  form.set('email', input.email);
  if (input.name) form.set('name', input.name);
  if (input.phone) form.set('phone', input.phone);
  if (input.country) form.set('address[country]', input.country);
  if (input.description) form.set('description', input.description);
  if (input.tax_id) {
    form.set('tax_id_data[0][type]', input.tax_id.type);
    form.set('tax_id_data[0][value]', input.tax_id.value);
  }
  if (input.metadata) {
    Object.entries(input.metadata).forEach(([k, v]) =>
      form.set(`metadata[${k}]`, v),
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey;

  const res = await fetch(`${STRIPE_BASE}/customers`, {
    method: 'POST',
    headers,
    body: form,
  });
  const body = (await res.json()) as
    | { id: string }
    | { error: { message: string } };
  if (!res.ok || 'error' in body) {
    const msg = 'error' in body ? body.error.message : 'Stripe error';
    throw new Error(`Stripe customers: ${msg}`);
  }
  return body;
}

// Map an ISO-2 country code to the Stripe tax_id type appropriate for a VAT
// number registered there. Returns null for countries Stripe doesn't have a
// recognised "VAT-style" type for — in that case we still store the value in
// our own DB but don't push it to Stripe.
const EU_VAT_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU',
  'IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK',
]);
export function stripeTaxIdTypeFor(
  country: string,
): 'eu_vat' | 'gb_vat' | null {
  const c = country.toUpperCase();
  if (EU_VAT_COUNTRIES.has(c)) return 'eu_vat';
  if (c === 'GB') return 'gb_vat';
  return null;
}

// Whether to offer PayPal in Stripe Checkout. Gated behind STRIPE_ENABLE_PAYPAL
// ("true" to turn on) so the code can ship inert: PayPal only appears once it's
// BOTH activated in the Stripe Dashboard (Settings → Payment methods) AND this
// flag is set. Listing an un-activated method makes Stripe reject the session,
// so do not flip this on before enabling PayPal in the Dashboard.
export function paypalEnabled(env: { STRIPE_ENABLE_PAYPAL?: string }): boolean {
  return env.STRIPE_ENABLE_PAYPAL === 'true';
}

// ── Stripe POST helper: transient retry + idempotency-conflict recovery ─────
//
// A single fetch to Stripe turns any momentary blip — a 429 rate-limit, a
// Stripe 5xx, a dropped connection between the Worker and api.stripe.com — into
// a user-facing "We couldn't start checkout" error. Because every mutating call
// routed through here carries an Idempotency-Key, retrying the SAME request is
// safe (Stripe replays the first result rather than acting twice), so we retry
// transient failures a few times with a short backoff.
//
// Separately, Stripe REJECTS an Idempotency-Key reused with a DIFFERENT request
// body (HTTP 400, error.type "idempotency_error"). Our checkout keys are stable
// per registration+total, but the body legitimately varies between attempts — a
// page reload mints a fresh meta_event_id, and the buyer may switch
// country/timezone before retrying (e.g. after cancelling on Stripe and landing
// back on ?canceled=1). That reused key then fails the very retry the error told
// them to make. So on an idempotency_error we retry ONCE with a fresh key: a new
// Checkout Session is created (an unused one simply expires — no double charge).
const STRIPE_MAX_TRANSIENT_ATTEMPTS = 3;
// Per-attempt ceiling. A half-open connection to Stripe (no RST, just silence)
// would otherwise ride the Worker's wall-clock budget to exhaustion; instead we
// abort and let the retry loop try again.
const STRIPE_ATTEMPT_TIMEOUT_MS = 8000;

function stripeBackoffMs(attempt: number): number {
  return Math.min(1200, 200 * attempt) + Math.floor(Math.random() * 150);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stripePostForm(
  path: string,
  form: URLSearchParams,
  opts: { secretKey: string; idempotencyKey?: string; context: string },
): Promise<Record<string, any>> {
  // Serialize once so the body can be safely re-sent across retries.
  const bodyStr = form.toString();
  let idempotencyKey = opts.idempotencyKey;
  let conflictRetried = false;
  let transientAttempts = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    let res: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), STRIPE_ATTEMPT_TIMEOUT_MS);
      try {
        res = await fetch(`${STRIPE_BASE}${path}`, {
          method: 'POST',
          headers,
          body: bodyStr,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      // Network-level failure or per-attempt timeout (reset / TLS / DNS / hang).
      // Safe to retry — same key.
      transientAttempts++;
      if (transientAttempts < STRIPE_MAX_TRANSIENT_ATTEMPTS) {
        await sleep(stripeBackoffMs(transientAttempts));
        continue;
      }
      throw new Error(
        `Stripe ${opts.context}: network error after ${transientAttempts} attempts: ${String(err)}`,
      );
    }

    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (res.ok && body && !('error' in body)) return body as Record<string, any>;

    const stripeError =
      body && typeof body === 'object' && 'error' in body ? (body as any).error : null;

    // Reused idempotency key with a changed body → retry once with a fresh key.
    if (
      res.status === 400 &&
      stripeError?.type === 'idempotency_error' &&
      idempotencyKey &&
      !conflictRetried
    ) {
      conflictRetried = true;
      idempotencyKey = `${idempotencyKey}-r${crypto.randomUUID().slice(0, 8)}`;
      continue;
    }

    // Transient upstream failure → retry with the SAME key (idempotent, so no
    // duplicate): 429 rate-limit, Stripe 5xx, or 409 (a concurrent request under
    // the same key is still in flight — it finishes and the retry replays it).
    if (res.status === 429 || res.status === 409 || res.status >= 500) {
      transientAttempts++;
      if (transientAttempts < STRIPE_MAX_TRANSIENT_ATTEMPTS) {
        await sleep(stripeBackoffMs(transientAttempts));
        continue;
      }
    }

    const msg = stripeError?.message ?? `HTTP ${res.status}`;
    throw new Error(`Stripe ${opts.context}: ${msg}`);
  }
}

export async function createCheckoutSession(input: CreateCheckoutSessionInput) {
  if (!input.customer && !input.customer_email) {
    throw new Error('createCheckoutSession: provide customer or customer_email');
  }
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', input.success_url);
  form.set('cancel_url', input.cancel_url);
  if (input.customer) {
    form.set('customer', input.customer);
    // Stripe needs to know which fields it may overwrite on our customer when
    // the buyer edits them on Checkout. Address is the one we care about.
    form.set('customer_update[address]', 'auto');
  } else if (input.customer_email) {
    form.set('customer_email', input.customer_email);
  }
  form.set('payment_intent_data[capture_method]', 'automatic');
  if (input.payment_intent_description) {
    form.set(
      'payment_intent_data[description]',
      input.payment_intent_description,
    );
  }
  form.set('billing_address_collection', 'required');
  // Shipping address (physical add-on riding the order). Stripe wants the
  // allowed countries enumerated one by one — and, when the session reuses a
  // pre-created customer, explicit permission to write the collected address
  // onto that customer.
  if (input.shipping_countries?.length) {
    if (input.customer) form.set('customer_update[shipping]', 'auto');
    input.shipping_countries.forEach((code, i) =>
      form.set(`shipping_address_collection[allowed_countries][${i}]`, code),
    );
  }
  // We intentionally do NOT set tax_id_collection — we collect the VAT
  // number on our own form (and attach it to the Customer above for B2B),
  // so we don't make the buyer re-type it on Stripe.
  // Payment methods. `card` works in every currency; the EU-local methods
  // (Bancontact, iDEAL, SEPA debit, Sofort) are EUR-only, and Stripe REJECTS
  // the whole session if an explicitly-listed method doesn't support the
  // session currency. Workshops are multi-currency (USD, GBP, CAD, …), so we
  // only offer the EUR-only methods when the session is actually in EUR —
  // otherwise a USD/GBP/… buyer would get a hard checkout failure. Within EUR,
  // Stripe still filters by the billing country (Bancontact → BE, iDEAL → NL).
  // PayPal is appended only when the caller opts in (paypalEnabled) — and it
  // must also be activated in the Stripe Dashboard, otherwise Stripe rejects
  // the whole session. It supports non-EUR currencies, so it's not gated on
  // EUR. It's offered on one-off payments only; the installment path
  // (createSubscriptionCheckoutSession) deliberately omits it because
  // PayPal-via-Stripe can't authorise recurring debits.
  const sessionCurrency = (input.line_items[0]?.currency ?? 'eur').toLowerCase();
  const methods = ['card'];
  if (sessionCurrency === 'eur') {
    methods.push('bancontact', 'ideal', 'sepa_debit', 'sofort');
  }
  if (input.enablePaypal) methods.push('paypal');
  methods.forEach((m, i) => form.set(`payment_method_types[${i}]`, m));

  input.line_items.forEach((li, i) => {
    form.set(`line_items[${i}][price_data][currency]`, li.currency);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(li.amount_cents));
    form.set(`line_items[${i}][price_data][product_data][name]`, li.name);
    if (li.description) {
      form.set(
        `line_items[${i}][price_data][product_data][description]`,
        li.description,
      );
    }
    if (li.product_metadata) {
      Object.entries(li.product_metadata).forEach(([k, v]) =>
        form.set(
          `line_items[${i}][price_data][product_data][metadata][${k}]`,
          v,
        ),
      );
    }
    form.set(`line_items[${i}][quantity]`, String(li.quantity));
  });

  Object.entries(input.metadata).forEach(([k, v]) =>
    form.set(`metadata[${k}]`, v),
  );

  return (await stripePostForm('/checkout/sessions', form, {
    secretKey: input.secretKey,
    idempotencyKey: input.idempotency_key,
    context: 'checkout.sessions',
  })) as { id: string; url: string; payment_intent: string | null };
}

// Issue a refund against a PaymentIntent. Omit `amountMinor` for a full
// refund of whatever is still refundable; pass it (in the charge's own
// currency) for a partial. The matching `charge.refunded` webhook is what
// actually flips our DB row to 'refunded' and accumulates the amount — this
// only asks Stripe to move the money, so the two never double-count.
export async function createRefund(input: {
  secretKey: string;
  paymentIntent: string;
  amountMinor?: number | null;
  reason?: 'requested_by_customer' | 'duplicate' | 'fraudulent';
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}): Promise<{ id: string; status: string; amount: number; currency: string }> {
  const form = new URLSearchParams();
  form.set('payment_intent', input.paymentIntent);
  if (input.amountMinor != null) form.set('amount', String(input.amountMinor));
  if (input.reason) form.set('reason', input.reason);
  if (input.metadata) {
    Object.entries(input.metadata).forEach(([k, v]) =>
      form.set(`metadata[${k}]`, v),
    );
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey;

  const res = await fetch(`${STRIPE_BASE}/refunds`, {
    method: 'POST',
    headers,
    body: form,
  });
  const body = (await res.json()) as
    | { id: string; status: string; amount: number; currency: string }
    | { error: { message: string } };
  if (!res.ok || 'error' in body) {
    const msg = 'error' in body ? body.error.message : 'Stripe error';
    throw new Error(`Stripe refunds: ${msg}`);
  }
  return body;
}

export async function retrieveSession(secretKey: string, sessionId: string) {
  const res = await fetch(
    `${STRIPE_BASE}/checkout/sessions/${sessionId}?expand[]=payment_intent&expand[]=customer_details`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  );
  if (!res.ok) throw new Error(`Stripe retrieve session ${res.status}`);
  return (await res.json()) as any;
}

// ───────────────────────────────────────────────────────────────────────
// Subscription mode for 3-monthly-installment course purchases.
//
// We create an ad-hoc monthly Price (no Product object pre-required —
// Stripe accepts `price_data` inline). Stripe charges immediately, then
// once per calendar month. After the subscription is created we call
// `setSubscriptionCancelAt` from the webhook to schedule it to cancel the
// instant the (N+1)th charge would fall due, yielding exactly N monthly
// charges without juggling subscription schedules — and working inside a
// regular Stripe Checkout flow.
//
// (`subscription_data[cancel_at]` on Checkout Sessions is not accepted
// by the current Stripe API, so we set it via the Subscriptions API.)
//
// THE BOUNDARY IS THE WHOLE POINT (bug fixed July 2026). Stripe prorates
// the invoice of any period the cancellation falls *inside*: a cancel_at
// strictly between charge N and charge N+1 bills the Nth installment only
// for the days before it. This code used to compute cancel_at as
// `now + (N-1)×30d + 15d` — 30-day months against Stripe's calendar-month
// billing — which always landed ~10-16 days INTO the final period, so every
// plan's last installment was charged at roughly a third to a half:
//
//   3× plan  — final installment billed at 43-53% of its amount
//   6× plan  — 39-48%
//   12× plan — 29-36%
//
// (A real case: a €349×3 certification plan whose third invoice came out at
// €157.62 — exactly 14 days of a 31-day period — €191.38 short.)
//
// The only cancel_at that bills N full installments and never an (N+1)th is
// EXACTLY the (N+1)th billing instant: the final period is then covered in
// full (nothing to prorate) and no further invoice is ever generated. There
// is no safe margin in either direction — earlier prorates, later bills
// again — so the timestamp must come from Stripe's own billing anchor, not
// from our clock. `recordCourseInvoiceIfNew` additionally flips
// `cancel_at_period_end` once the last installment settles, which is the
// canonical (also proration-free) stop and covers the boundary instant.

// Add `n` calendar months to a unix-seconds instant, preserving the time of
// day and clamping the day-of-month to the target month's length. Mirrors how
// Stripe derives every billing period from `billing_cycle_anchor` — each
// period is `anchor + k months`, so an anchor on the 31st bills Feb 28 and
// then Mar 31 again (it never drifts down to the 28th).
export function addMonthsUnix(unixSeconds: number, n: number): number {
  const d = new Date(unixSeconds * 1000);
  const day = d.getUTCDate();
  const target = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + n,
      1,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
    ),
  );
  const daysInTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTarget));
  return Math.floor(target.getTime() / 1000);
}

// The cancel_at unix timestamp that allows exactly `installmentCount` full
// monthly charges: the instant the next one would fall due. `anchorUnix` MUST
// be the subscription's own `billing_cycle_anchor` (see the note above — our
// wall clock is a minute or so late, which would put cancel_at *past* the
// boundary and buy the customer an extra charge).
export function computeInstallmentCancelAt(
  installmentCount: number,
  anchorUnix: number,
): number {
  return addMonthsUnix(anchorUnix, installmentCount);
}

// ── Invoice shape normalisation ────────────────────────────────────────
// Stripe's 2025-04-30 ("basil") API version moved three fields we depend on
// off the Invoice object: `subscription` → `parent.subscription_details.
// subscription`, the subscription metadata alongside it, and `payment_intent`
// → `payments.data[].payment.payment_intent`. Webhook payloads are rendered
// at the ENDPOINT's pinned API version, so an endpoint on a newer version
// hands us an invoice with none of the old fields — the handler finds no
// subscription, returns 200, and the installment is silently never recorded
// (Stripe's dashboard still shows the delivery as successful). We therefore
// read every known shape everywhere an invoice is inspected.

// A Stripe reference is either a bare id or an expanded object.
function idOf(v: unknown): string | null {
  if (typeof v === 'string') return v || null;
  if (v && typeof v === 'object' && typeof (v as any).id === 'string') {
    return (v as any).id;
  }
  return null;
}

export type StripeInvoiceLike = {
  subscription?: unknown;
  payment_intent?: unknown;
  metadata?: Record<string, string> | null;
  subscription_details?: { metadata?: Record<string, string> | null } | null;
  parent?: {
    subscription_details?: {
      subscription?: unknown;
      metadata?: Record<string, string> | null;
    } | null;
  } | null;
  payments?: {
    data?: Array<{ payment?: { payment_intent?: unknown } | null } | null>;
  } | null;
};

// The subscription this invoice belongs to, across API versions.
export function subscriptionIdFromInvoice(
  inv: StripeInvoiceLike | null | undefined,
): string | null {
  if (!inv) return null;
  return (
    idOf(inv.subscription) ??
    idOf(inv.parent?.subscription_details?.subscription) ??
    null
  );
}

// The subscription metadata Stripe copies onto the invoice (our routing
// fallback for the very first invoice, before the subscription is attached).
export function subscriptionMetadataFromInvoice(
  inv: StripeInvoiceLike | null | undefined,
): Record<string, string> {
  if (!inv) return {};
  return (
    inv.subscription_details?.metadata ??
    inv.parent?.subscription_details?.metadata ??
    inv.metadata ??
    {}
  );
}

// The PaymentIntent that settled this invoice, across API versions. Only used
// as the refund anchor we persist, so a null is survivable.
export function paymentIntentFromInvoice(
  inv: StripeInvoiceLike | null | undefined,
): string | null {
  if (!inv) return null;
  const direct = idOf(inv.payment_intent);
  if (direct) return direct;
  for (const p of inv.payments?.data ?? []) {
    const pi = idOf(p?.payment?.payment_intent);
    if (pi) return pi;
  }
  return null;
}

export type StripeSubscriptionSnapshot = {
  id: string;
  status: string;
  // Unix seconds. Every billing period is `billing_cycle_anchor + k months`,
  // so this is the one true anchor for scheduling the cancellation. Present
  // in every API version (unlike current_period_end, which basil moved onto
  // the subscription items).
  billing_cycle_anchor: number | null;
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  latest_invoice: {
    id: string;
    status: string;
    paid: boolean;
    payment_intent: string | null;
    amount_paid: number;
  } | null;
};

// Fetch a subscription with its latest invoice expanded. Used by the webhook
// to backstop a missing or delayed invoice.paid event (we read the
// already-paid first invoice straight off the subscription on
// checkout.session.completed instead of waiting for Stripe to fire
// invoice.paid, which — if the endpoint isn't subscribed to it — never
// arrives at all), and to read `billing_cycle_anchor` for the cancel_at
// schedule.
export async function retrieveSubscriptionWithLatestInvoice(
  secretKey: string,
  subscriptionId: string,
): Promise<StripeSubscriptionSnapshot> {
  const res = await fetch(
    `${STRIPE_BASE}/subscriptions/${subscriptionId}?expand[]=latest_invoice`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  );
  if (!res.ok) {
    const body = (await res.json()) as { error?: { message: string } };
    throw new Error(
      `Stripe subscriptions.retrieve: ${body.error?.message ?? res.status}`,
    );
  }
  const sub = (await res.json()) as any;
  const inv = sub.latest_invoice ?? null;
  return {
    id: sub.id,
    status: sub.status,
    billing_cycle_anchor:
      typeof sub.billing_cycle_anchor === 'number'
        ? sub.billing_cycle_anchor
        : typeof sub.start_date === 'number'
          ? sub.start_date
          : null,
    cancel_at: typeof sub.cancel_at === 'number' ? sub.cancel_at : null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    latest_invoice:
      inv && typeof inv === 'object'
        ? {
            id: inv.id,
            status: inv.status ?? '',
            paid: inv.paid ?? inv.status === 'paid',
            payment_intent: paymentIntentFromInvoice(inv),
            amount_paid: inv.amount_paid ?? 0,
          }
        : null,
  };
}

// List the invoices Stripe has generated for a subscription, newest-first
// (Stripe's default order). Used by the hourly safety-net reconcile
// (src/lib/payments/stripe-reconcile.ts) to find every already-settled
// installment cycle when the invoice.paid webhook was never delivered — the
// same class of hole reconcilePaypalCourseOrders closes for PayPal. `status`
// filters server-side ('paid' = money in the bank); `payment_intent` is the
// refund/first-installment anchor we persist on the row, mirroring the shape
// retrieveSubscriptionWithLatestInvoice already returns.
export async function listSubscriptionInvoices(
  secretKey: string,
  subscriptionId: string,
  opts: { status?: 'paid' | 'open' | 'draft' | 'uncollectible' | 'void'; limit?: number } = {},
): Promise<
  Array<{
    id: string;
    number: string | null;
    status: string;
    paid: boolean;
    payment_intent: string | null;
    // Gross amount actually settled, in the invoice currency's minor units.
    // The installment audit compares this against the plan's per-installment
    // amount to spot a prorated (short) cycle.
    amount_paid: number;
    currency: string;
    created: number;
  }>
> {
  const params = new URLSearchParams();
  params.set('subscription', subscriptionId);
  params.set('limit', String(Math.max(1, Math.min(100, opts.limit ?? 100))));
  if (opts.status) params.set('status', opts.status);
  const res = await fetch(`${STRIPE_BASE}/invoices?${params.toString()}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: { message: string } };
    throw new Error(
      `Stripe invoices.list: ${body.error?.message ?? res.status}`,
    );
  }
  const body = (await res.json()) as {
    data?: Array<
      StripeInvoiceLike & {
        id: string;
        number?: string | null;
        status?: string;
        paid?: boolean;
        amount_paid?: number;
        currency?: string;
        created?: number;
      }
    >;
  };
  return (body.data ?? []).map((inv) => ({
    id: inv.id,
    number: inv.number ?? null,
    status: inv.status ?? '',
    paid: inv.paid ?? inv.status === 'paid',
    payment_intent: paymentIntentFromInvoice(inv),
    amount_paid: inv.amount_paid ?? 0,
    currency: (inv.currency ?? '').toUpperCase(),
    created: inv.created ?? 0,
  }));
}

// Retrieve a charge, with its invoice expanded. Used by the `charge.refunded`
// webhook to resolve a refunded subscription-installment back to the
// subscription id (and from there to the course_registration). For one-off
// retreat payments `payment_intent` alone is enough — but installment 2
// or 3 of a course subscription doesn't appear on our row, so we walk
// charge → invoice → subscription instead.
export async function retrieveChargeWithInvoice(
  secretKey: string,
  chargeId: string,
): Promise<{
  id: string;
  payment_intent: string | null;
  amount_refunded: number;
  refunded: boolean;
  invoice: {
    id: string;
    // Resolved across API versions (basil moved it under `parent`).
    subscription: string | null;
  } | null;
}> {
  const res = await fetch(
    `${STRIPE_BASE}/charges/${chargeId}?expand[]=invoice`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  );
  if (!res.ok) {
    const body = (await res.json()) as { error?: { message: string } };
    throw new Error(
      `Stripe charges.retrieve: ${body.error?.message ?? res.status}`,
    );
  }
  const charge = (await res.json()) as any;
  const inv = charge.invoice;
  return {
    ...charge,
    invoice:
      inv && typeof inv === 'object'
        ? { id: inv.id, subscription: subscriptionIdFromInvoice(inv) }
        : null,
  };
}

async function updateSubscription(
  secretKey: string,
  subscriptionId: string,
  form: URLSearchParams,
): Promise<void> {
  const res = await fetch(`${STRIPE_BASE}/subscriptions/${subscriptionId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: { message: string } };
    throw new Error(
      `Stripe subscriptions.update: ${body.error?.message ?? res.status}`,
    );
  }
}

export async function setSubscriptionCancelAt(
  secretKey: string,
  subscriptionId: string,
  cancelAt: number,
): Promise<void> {
  const form = new URLSearchParams();
  form.set('cancel_at', String(cancelAt));
  await updateSubscription(secretKey, subscriptionId, form);
}

// Stop the subscription at the end of the period it is currently in — Stripe's
// own "cancel at period end" flag. Unlike a cancel_at timestamp this can never
// land inside a period, so the invoice already issued for that period is never
// prorated and no further one is generated. Called once the final installment
// settles (see recordCourseInvoiceIfNew), which makes the plan's stop exact
// even if the scheduled cancel_at was wrong or never applied.
export async function setSubscriptionCancelAtPeriodEnd(
  secretKey: string,
  subscriptionId: string,
): Promise<void> {
  const form = new URLSearchParams();
  form.set('cancel_at_period_end', 'true');
  await updateSubscription(secretKey, subscriptionId, form);
}

// Cancel a subscription immediately — no further invoices, effective now. Used
// by the admin "stop all upcoming charges" action (the buyer keeps whatever
// access the earlier installments granted; we're only forgiving the rest).
// Stripe then fires `customer.subscription.deleted`, which our webhook folds
// onto the row (status → cancelled). Idempotent: a 404 (already gone) is OK.
export async function cancelSubscriptionNow(
  secretKey: string,
  subscriptionId: string,
): Promise<void> {
  const res = await fetch(`${STRIPE_BASE}/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok && res.status !== 404) {
    const body = (await res.json()) as { error?: { message: string } };
    throw new Error(
      `Stripe subscriptions.cancel: ${body.error?.message ?? res.status}`,
    );
  }
}

export type CreateSubscriptionCheckoutInput = {
  secretKey: string;
  customer: string;
  success_url: string;
  cancel_url: string;
  product_name: string;
  product_description?: string;
  // Copied onto each generated Invoice's payment_intent.description so the
  // Quaderno-Stripe sync uses it as the invoice line item description
  // (instead of falling back to the merchant name "SONGDANCE").
  payment_intent_description?: string;
  // Stripe Product metadata; Quaderno reads `tax_class` from here to apply
  // eservice / digital-services VAT rules.
  product_metadata?: Record<string, string>;
  monthly_amount_cents: number;
  currency: string;
  installment_count: number; // typically 3
  metadata: Record<string, string>;
  idempotency_key?: string;
  // One-off line items (e.g. order bumps) billed on the FIRST invoice only.
  // Stripe Checkout in subscription mode accepts a mix of recurring + one-time
  // prices; a price_data without `recurring` is one-time and lands on invoice 1.
  one_time_line_items?: StripeLineItem[];
  // Collect a shipping address on the Checkout page (see the one-off input).
  shipping_countries?: string[];
};

export async function createSubscriptionCheckoutSession(
  input: CreateSubscriptionCheckoutInput,
) {
  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('success_url', input.success_url);
  form.set('cancel_url', input.cancel_url);
  form.set('customer', input.customer);
  form.set('customer_update[address]', 'auto');
  form.set('billing_address_collection', 'required');
  // Shipping address (physical add-on riding the order) — countries must be
  // enumerated. Checkout in subscription mode also needs permission to write
  // the collected shipping address onto the customer.
  if (input.shipping_countries?.length) {
    form.set('customer_update[shipping]', 'auto');
    input.shipping_countries.forEach((code, i) =>
      form.set(`shipping_address_collection[allowed_countries][${i}]`, code),
    );
  }

  // Card only for now — most non-card EU methods (Bancontact, iDEAL) are
  // single-charge instruments that can't authorise a recurring debit
  // through Checkout, and Stripe will reject the session if we ask for
  // them in subscription mode.
  form.set('payment_method_types[0]', 'card');
  // SEPA Direct Debit *can* drive a recurring sub; opt in when the buyer
  // is in a SEPA country. Stripe filters by the customer's billing address.
  // SEPA is EUR-only, though, and an explicitly-listed method that doesn't
  // support the session currency makes Stripe reject the whole session — so
  // only offer it on EUR plans (a USD/GBP/… installment buyer gets card).
  if (input.currency.toLowerCase() === 'eur') {
    form.set('payment_method_types[1]', 'sepa_debit');
  }

  // Inline price_data: avoids needing to pre-create a Product / Price.
  form.set('line_items[0][price_data][currency]', input.currency);
  form.set(
    'line_items[0][price_data][unit_amount]',
    String(input.monthly_amount_cents),
  );
  form.set('line_items[0][price_data][recurring][interval]', 'month');
  form.set('line_items[0][price_data][recurring][interval_count]', '1');
  form.set(
    'line_items[0][price_data][product_data][name]',
    `${input.product_name} — ${input.installment_count}-month plan`,
  );
  if (input.product_description) {
    form.set(
      'line_items[0][price_data][product_data][description]',
      input.product_description,
    );
  }
  if (input.product_metadata) {
    Object.entries(input.product_metadata).forEach(([k, v]) =>
      form.set(
        `line_items[0][price_data][product_data][metadata][${k}]`,
        v,
      ),
    );
  }
  // Subscription-level description shows on the Stripe dashboard and is
  // copied onto each generated Invoice's `description`, which Quaderno
  // reads when syncing the invoice.
  if (input.payment_intent_description) {
    form.set(
      'subscription_data[description]',
      input.payment_intent_description,
    );
  }
  form.set('line_items[0][quantity]', '1');

  // One-off add-ons (order bumps): additional line_items WITHOUT `recurring`,
  // so Stripe treats them as one-time and bills them on the first invoice
  // alongside the opening installment. Indexed from 1 (the subscription is 0).
  (input.one_time_line_items ?? []).forEach((li, idx) => {
    const i = idx + 1;
    form.set(`line_items[${i}][price_data][currency]`, li.currency);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(li.amount_cents));
    form.set(`line_items[${i}][price_data][product_data][name]`, li.name);
    if (li.description) {
      form.set(
        `line_items[${i}][price_data][product_data][description]`,
        li.description,
      );
    }
    if (li.product_metadata) {
      Object.entries(li.product_metadata).forEach(([k, v]) =>
        form.set(
          `line_items[${i}][price_data][product_data][metadata][${k}]`,
          v,
        ),
      );
    }
    form.set(`line_items[${i}][quantity]`, String(li.quantity));
  });

  // Metadata lands on the Subscription itself (and is copied through to
  // each generated Invoice / PaymentIntent), which the webhook uses to
  // route invoice.paid events back to our course_registration. We also
  // stash installment_count on both the session and subscription so the
  // checkout.session.completed handler can call the Subscriptions API to
  // set `cancel_at` (Stripe Checkout itself doesn't accept it).
  const fullMeta: Record<string, string> = {
    ...input.metadata,
    installment_count: String(input.installment_count),
  };
  Object.entries(fullMeta).forEach(([k, v]) => {
    form.set(`metadata[${k}]`, v);
    form.set(`subscription_data[metadata][${k}]`, v);
  });

  return (await stripePostForm('/checkout/sessions', form, {
    secretKey: input.secretKey,
    idempotencyKey: input.idempotency_key,
    context: 'checkout.sessions (subscription)',
  })) as { id: string; url: string; subscription: string | null };
}

// Verify the Stripe webhook signature using Web Crypto (Workers-compatible).
// Stripe signs the payload as "{timestamp}.{body}" and exposes the result in
// the Stripe-Signature header as `t=<ts>,v1=<hex>`.
export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  const parts = header.split(',').reduce<Record<string, string[]>>((acc, p) => {
    const [k, v] = p.split('=');
    if (!k || !v) return acc;
    (acc[k] ||= []).push(v);
    return acc;
  }, {});
  const ts = parts['t']?.[0];
  const sigs = parts['v1'] ?? [];
  if (!ts || sigs.length === 0) return false;

  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Date.now() / 1000 - tsNum) > toleranceSeconds) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${payload}`));
  const expected = bufToHex(mac);
  return sigs.some((s) => timingSafeEqual(s, expected));
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++)
    out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
