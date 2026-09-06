// "Pay the remainder" flow: for a registration that was paid with a 50%
// deposit, email the buyer their two ways to settle the outstanding balance —
// a bank transfer to the Songdance account (preferred; the guest replies and
// an admin marks it paid on /admin/retreats/<slug>) or an online checkout
// link, which settles itself. The words live in balance-email.ts, so
// /admin/emails can preview them.
//
// THE EMAILED LINK IS OURS, NOT THE GATEWAY'S. A Stripe Checkout Session lives
// at most 24 hours and a PayPal approve URL less, so a gateway URL baked into
// an email is dead by the next morning — which is how the Dolphin & Sound
// balance send left everyone who clicked it a day later on Stripe's "this
// checkout session has timed out" page. The email carries the durable
// /registrations/balance link (balance-link.ts) and the gateway session is
// minted on the CLICK, by `createBalanceCheckout` below. Anything that hands a
// guest a payment link they will read later must do the same.
//
// Shared by the admin per-person send (api/admin/balance/send), the bulk send
// (api/admin/balance/send-bulk) and the pay page itself.

import {
  attachBalanceCheckoutRef,
  markBalanceInviteSent,
  logEvent,
  type Registration,
} from './db';
import { createCheckoutSession, paypalEnabled } from './stripe';
import {
  paypalConfigured,
  createOrder as createPaypalOrder,
} from '../payments/paypal';
import { encodeCustomId, type PaymentProvider } from '../payments/provider';
import { retreatPagePath } from './waitlist';
import { buildBalancePayUrl } from './balance-link';
import {
  BALANCE_DUE_LABEL,
  BALANCE_REPLY_TO,
  balancePaymentReference,
  buildBalanceEmail,
} from './balance-email';

// Re-exported so the existing import surface (balance.ts) keeps working.
export {
  BALANCE_DUE_LABEL,
  BALANCE_REPLY_TO,
  BANK_TRANSFER,
  balancePaymentReference,
  buildBalanceEmail,
} from './balance-email';
export type { BalanceEmailContent } from './balance-email';

export type BalanceEnv = {
  DB: D1Database;
  STRIPE_SECRET_KEY: string;
  STRIPE_ENABLE_PAYPAL?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_ENV?: string;
  RESEND_API_KEY?: string;
  RESEND_INTAKES_FROM?: string;
  PUBLIC_BASE_URL?: string;
  // Signs the durable pay link in the email (balance-link.ts).
  ADMIN_SESSION_SECRET: string;
};

const DEFAULT_FROM = 'Songdance <intakes@mail.songdance.co>';
// The email asks the guest to reply once they have transferred, so the
// Reply-To and the address named in the copy must be the same one.
const REPLY_TO = BALANCE_REPLY_TO;

// The amount as the guest reads it in the email — exported so the pay page
// prints the same string as the mail that sent them there.
export function formatBalanceAmount(cents: number): string {
  return `€${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
}
const eur = formatBalanceAmount;

// What a balance charge needs to know about the booking: the retreat it is
// for, the tier that priced it, and where a guest who backs out should land.
export type BalanceContext = {
  product: { name: string; slug: string; currency: string };
  tier: { name: string; slug: string };
  balanceCents: number;
  lineItemName: string;
};

// Is there a balance to charge at all, and what is it for? Returns an error
// code (not a throw) for every "nothing to pay here" case, so the pay page can
// say which one it is in plain words.
export async function loadBalanceContext(
  env: BalanceEnv,
  reg: Registration,
): Promise<{ ok: true; ctx: BalanceContext } | { ok: false; error: BalanceError }> {
  const balanceCents = reg.balance_due_cents ?? 0;
  if (reg.status !== 'paid') return { ok: false, error: 'not-paid' };
  if (balanceCents <= 0) return { ok: false, error: 'no-balance' };
  if (reg.balance_paid_at) return { ok: false, error: 'already-settled' };

  const product = await env.DB
    .prepare('SELECT name, slug, currency FROM products WHERE id = ?')
    .bind(reg.product_id)
    .first<{ name: string; slug: string; currency: string }>();
  const tier = await env.DB
    .prepare('SELECT name, slug FROM tiers WHERE id = ?')
    .bind(reg.tier_id)
    .first<{ name: string; slug: string }>();
  if (!product || !tier) return { ok: false, error: 'product-or-tier-missing' };

  return {
    ok: true,
    ctx: {
      product,
      tier,
      balanceCents,
      lineItemName: `${product.name} — ${tier.name} (remaining balance)`,
    },
  };
}

// The codes the callers actually branch on. Resend hands back its own error
// text verbatim, so the type stays open — `string & {}` keeps the literals in
// autocomplete instead of the union collapsing to plain `string`.
export type BalanceError =
  | 'not-paid'
  | 'no-balance'
  | 'already-settled'
  | 'product-or-tier-missing'
  | 'base-url-missing'
  | 'resend-key-missing'
  | 'stripe-error'
  | 'paypal-error'
  | (string & {});

// Mint a gateway checkout for the outstanding balance and hand back its URL.
//
// Called on the CLICK, from /registrations/balance — never at send time. Both
// gateways expire the link they hand out (Stripe: 24h at the outside; PayPal:
// sooner), so the only URL that can safely sit in an inbox is our own, and this
// is what it redirects to.
export async function createBalanceCheckout(
  env: BalanceEnv,
  reg: Registration,
  requestOrigin?: string,
): Promise<
  | { ok: true; url: string; ref: string; provider: PaymentProvider }
  | { ok: false; error: BalanceError }
> {
  const loaded = await loadBalanceContext(env, reg);
  if (!loaded.ok) return loaded;
  const { product, tier, balanceCents, lineItemName } = loaded.ctx;

  const baseUrl = resolveBaseUrl(env, requestOrigin);
  if (!baseUrl) return { ok: false, error: 'base-url-missing' };

  // Backing out of the gateway returns to our own page — which re-offers the
  // bank details and a fresh "pay online" button — instead of dumping the
  // guest on a retreat landing page with no way back to their balance.
  const cancelUrl = await buildBalancePayUrl(
    env.ADMIN_SESSION_SECRET,
    baseUrl,
    reg.id,
    { stay: true },
  );

  // The balance rides the SAME gateway the deposit was paid on, so a PayPal
  // deposit settles via PayPal and a Stripe deposit via Stripe. The balance
  // webhook (Stripe payment_kind=balance / PayPal custom_id balance:<id>) rolls
  // the balance into amount_cents either way. A bank_transfer deposit has no
  // gateway of its own and falls to Stripe, which is the point of the link.
  const usePaypal = reg.provider === 'paypal' && paypalConfigured(env);

  // Both gateways treat a repeated idempotency key as "hand back the object you
  // made last time" — which, for an object that expires, would hand back a dead
  // link. Bucketing by the hour keeps a double-click cheap while guaranteeing a
  // guest who returns tomorrow gets a live checkout.
  const bucket = Math.floor(Date.now() / 3_600_000);
  const idemKey = `balance-${reg.id}-${balanceCents}-${bucket}`;

  if (usePaypal) {
    try {
      const order = await createPaypalOrder({
        env,
        currency: (reg.currency || product.currency || 'EUR').toUpperCase(),
        items: [
          { name: lineItemName, amountMinor: balanceCents, category: 'PHYSICAL_GOODS' },
        ],
        customId: encodeCustomId('balance', reg.id),
        description: lineItemName,
        softDescriptor: 'SONGDANCE',
        invoiceId: `balance-${reg.id}-${balanceCents}`,
        returnUrl: `${baseUrl}/api/payments/paypal-return?dest=${encodeURIComponent('/registrations/thanks')}`,
        cancelUrl,
        brandName: 'Songdance',
        payer: { email: reg.email, countryCode: reg.country ?? undefined },
        requestId: `${idemKey}-pp`,
      });
      await attachBalanceCheckoutRef(env.DB, reg.id, 'paypal', order.id);
      return { ok: true, url: order.approveUrl, ref: order.id, provider: 'paypal' };
    } catch (err) {
      await logEvent(env.DB, {
        registration_id: reg.id,
        kind: 'registration.balance.checkout_error',
        payload: { provider: 'paypal', error: String(err) },
      });
      return { ok: false, error: 'paypal-error' };
    }
  }

  const currency = (reg.currency || product.currency || 'EUR').toLowerCase();
  try {
    const session = await createCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      enablePaypal: paypalEnabled(env),
      customer_email: reg.email,
      success_url: `${baseUrl}/registrations/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      payment_intent_description: lineItemName,
      line_items: [
        { name: lineItemName, amount_cents: balanceCents, currency, quantity: 1 },
      ],
      metadata: {
        registration_id: String(reg.id),
        product_slug: product.slug,
        tier_slug: tier.slug,
        payment_kind: 'balance',
      },
      idempotency_key: idemKey,
    });
    await attachBalanceCheckoutRef(env.DB, reg.id, 'stripe', session.id);
    return { ok: true, url: session.url, ref: session.id, provider: 'stripe' };
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: reg.id,
      kind: 'registration.balance.checkout_error',
      payload: { error: String(err) },
    });
    return { ok: false, error: 'stripe-error' };
  }
}

// Where a guest who cancels or whose booking is already settled can go back to.
export function retreatPageFor(productSlug: string): string {
  return retreatPagePath(productSlug) ?? '/events';
}

export function resolveBaseUrl(env: BalanceEnv, requestOrigin?: string): string {
  return (env.PUBLIC_BASE_URL || requestOrigin || '').replace(/\/+$/, '');
}

// Email the guest their two ways to settle the balance, and stamp
// balance_invite_sent_at on a successful send.
//
// No gateway is touched here: the "pay online" button carries our own durable
// link, which mints a checkout when it is clicked. That is the whole fix — the
// email is read days after it is sent, and no gateway session lives that long.
export async function sendBalanceInvite(
  env: BalanceEnv,
  reg: Registration,
  requestOrigin?: string,
): Promise<{ ok: true } | { ok: false; error: BalanceError }> {
  const loaded = await loadBalanceContext(env, reg);
  if (!loaded.ok) return loaded;
  const { product, balanceCents } = loaded.ctx;

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'resend-key-missing' };

  const baseUrl = resolveBaseUrl(env, requestOrigin);
  if (!baseUrl) return { ok: false, error: 'base-url-missing' };

  const link = await buildBalancePayUrl(env.ADMIN_SESSION_SECRET, baseUrl, reg.id);

  const email = buildBalanceEmail({
    first_name: reg.first_name ?? (reg.name ? reg.name.split(' ')[0] : null),
    event_name: product.name,
    amount_label: eur(balanceCents),
    due_label: BALANCE_DUE_LABEL,
    link,
    reference: balancePaymentReference(reg.id),
  });

  const sent = await sendViaResend({
    apiKey,
    from: env.RESEND_INTAKES_FROM ?? DEFAULT_FROM,
    to: reg.email,
    replyTo: REPLY_TO,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  if (!sent.ok) {
    await logEvent(env.DB, {
      registration_id: reg.id,
      kind: 'registration.balance.email_error',
      payload: { error: sent.error },
    });
    return { ok: false, error: sent.error };
  }

  await markBalanceInviteSent(env.DB, reg.id);
  await logEvent(env.DB, {
    registration_id: reg.id,
    kind: 'registration.balance.invited',
    source: 'admin',
    payload: { link, balance_cents: balanceCents },
  });

  return { ok: true };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function sendViaResend(args: {
  apiKey: string;
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${args.apiKey}`,
        },
        body: JSON.stringify({
          from: args.from,
          to: [args.to],
          reply_to: args.replyTo,
          subject: args.subject,
          html: args.html,
          text: args.text,
        }),
        signal: controller.signal,
      });
      if (res.status === 429 && attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 5) : 1) * 1000);
        continue;
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { ok: false, error: `resend-${res.status}: ${errText.slice(0, 200)}` };
      }
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) {
        await sleep(1000);
        continue;
      }
      return { ok: false, error: msg.includes('abort') ? 'timeout' : msg.slice(0, 200) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: 'retries-exhausted' };
}
