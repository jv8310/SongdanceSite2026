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

  const res = await fetch(`${STRIPE_BASE}/customers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
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
  // We intentionally do NOT set tax_id_collection — we collect the VAT
  // number on our own form (and attach it to the Customer above for B2B),
  // so we don't make the buyer re-type it on Stripe.
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
