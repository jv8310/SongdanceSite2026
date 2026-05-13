const STRIPE_BASE = 'https://api.stripe.com/v1';

type StripeLineItem = {
  name: string;
  description?: string;
  amount_cents: number;
  currency: string;
  quantity: number;
};

export type CreateCheckoutSessionInput = {
  secretKey: string;
  customer_email: string;
  success_url: string;
  cancel_url: string;
  line_items: StripeLineItem[];
  metadata: Record<string, string>;
  idempotency_key?: string;
};

export async function createCheckoutSession(input: CreateCheckoutSessionInput) {
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', input.success_url);
  form.set('cancel_url', input.cancel_url);
  form.set('customer_email', input.customer_email);
  form.set('payment_intent_data[capture_method]', 'automatic');
  form.set('billing_address_collection', 'required');
  // Collect VAT/Tax ID on Stripe's page too — Stripe filters which countries
  // get prompted automatically. Lets B2B customers correct what we captured.
  form.set('tax_id_collection[enabled]', 'true');
  // Common EU payment methods. Stripe filters by what's enabled on the account
  // and by the billing country — so Bancontact only appears for BE addresses,
  // iDEAL only for NL addresses, etc.
  ['card', 'bancontact', 'ideal', 'sepa_debit', 'sofort'].forEach((m, i) =>
    form.set(`payment_method_types[${i}]`, m),
  );

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
    form.set(`line_items[${i}][quantity]`, String(li.quantity));
  });

  Object.entries(input.metadata).forEach(([k, v]) =>
    form.set(`metadata[${k}]`, v),
  );

  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (input.idempotency_key) headers['Idempotency-Key'] = input.idempotency_key;

  const res = await fetch(`${STRIPE_BASE}/checkout/sessions`, {
    method: 'POST',
    headers,
    body: form,
  });
  const body = (await res.json()) as
    | { id: string; url: string; payment_intent: string | null }
    | { error: { message: string; type?: string } };
  if (!res.ok || 'error' in body) {
    const msg = 'error' in body ? body.error.message : 'Stripe error';
    throw new Error(`Stripe checkout.sessions: ${msg}`);
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
