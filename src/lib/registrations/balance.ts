// "Pay the remainder" flow: for a registration that was paid with a 50%
// deposit, create a Stripe Checkout Session for the outstanding balance and
// email the buyer their two ways to settle it — a bank transfer to the
// Songdance account (preferred; the guest replies and an admin marks it paid
// on /admin/retreats/<slug>) or that checkout link, which settles itself.
// The words live in balance-email.ts, so /admin/emails can preview them.
//
// Shared by the admin per-person send (api/admin/balance/send) and the bulk
// send (api/admin/balance/send-bulk). Mirrors the intake-invitation sender:
// Resend for delivery, the existing Stripe helper for the checkout link.

import {
  attachBalanceSession,
  attachBalancePaypalOrder,
  logEvent,
  type Registration,
} from './db';
import { createCheckoutSession, paypalEnabled } from './stripe';
import {
  paypalConfigured,
  createOrder as createPaypalOrder,
} from '../payments/paypal';
import { encodeCustomId } from '../payments/provider';
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
};

const DEFAULT_FROM = 'Songdance <intakes@mail.songdance.co>';
// The email asks the guest to reply once they have transferred, so the
// Reply-To and the address named in the copy must be the same one.
const REPLY_TO = BALANCE_REPLY_TO;

function eur(cents: number): string {
  return `€${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
}

// Create the balance Checkout Session, email the link, and (on a successful
// send) record balance_stripe_session_id + balance_invite_sent_at.
export async function sendBalanceInvite(
  env: BalanceEnv,
  reg: Registration,
  requestOrigin?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const balance = reg.balance_due_cents ?? 0;
  if (reg.status !== 'paid') return { ok: false, error: 'not-paid' };
  if (balance <= 0) return { ok: false, error: 'no-balance' };
  if (reg.balance_paid_at) return { ok: false, error: 'already-settled' };

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'resend-key-missing' };

  const product = await env.DB
    .prepare('SELECT name, slug, currency FROM products WHERE id = ?')
    .bind(reg.product_id)
    .first<{ name: string; slug: string; currency: string }>();
  const tier = await env.DB
    .prepare('SELECT name, slug FROM tiers WHERE id = ?')
    .bind(reg.tier_id)
    .first<{ name: string; slug: string }>();
  if (!product || !tier) return { ok: false, error: 'product-or-tier-missing' };

  const baseUrl = (env.PUBLIC_BASE_URL || requestOrigin || '').replace(/\/+$/, '');
  const lineItemName = `${product.name} — ${tier.name} (remaining balance)`;

  // The balance link rides the SAME gateway the deposit was paid on, so a
  // PayPal deposit settles via PayPal and a Stripe deposit via Stripe. The
  // balance webhook (Stripe payment_kind=balance / PayPal balance:<id>) rolls
  // the balance into amount_cents either way.
  const usePaypal = reg.provider === 'paypal' && paypalConfigured(env);

  let link: string;
  let externalRef: string; // session id or order id, for logging + attach
  if (usePaypal) {
    try {
      const order = await createPaypalOrder({
        env,
        currency: (reg.currency || product.currency || 'EUR').toUpperCase(),
        items: [
          { name: lineItemName, amountMinor: balance, category: 'PHYSICAL_GOODS' },
        ],
        customId: encodeCustomId('balance', reg.id),
        description: lineItemName,
        softDescriptor: 'SONGDANCE',
        invoiceId: `balance-${reg.id}-${balance}`,
        returnUrl: `${baseUrl}/api/payments/paypal-return?dest=${encodeURIComponent('/registrations/thanks')}`,
        cancelUrl: `${baseUrl}/retreats/dolphin-and-sound`,
        brandName: 'Songdance',
        payer: { email: reg.email, countryCode: reg.country ?? undefined },
        requestId: `balance-${reg.id}-${balance}-pp`,
      });
      link = order.approveUrl;
      externalRef = order.id;
    } catch (err) {
      await logEvent(env.DB, {
        registration_id: reg.id,
        kind: 'registration.balance.checkout_error',
        payload: { provider: 'paypal', error: String(err) },
      });
      return { ok: false, error: 'paypal-error' };
    }
  } else {
    const currency = (reg.currency || product.currency || 'EUR').toLowerCase();
    try {
      const session = await createCheckoutSession({
        secretKey: env.STRIPE_SECRET_KEY,
        enablePaypal: paypalEnabled(env),
        customer_email: reg.email,
        success_url: `${baseUrl}/registrations/thanks?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/retreats/dolphin-and-sound`,
        payment_intent_description: lineItemName,
        line_items: [
          { name: lineItemName, amount_cents: balance, currency, quantity: 1 },
        ],
        metadata: {
          registration_id: String(reg.id),
          product_slug: product.slug,
          tier_slug: tier.slug,
          payment_kind: 'balance',
        },
        idempotency_key: `balance-${reg.id}-${balance}`,
      });
      link = session.url;
      externalRef = session.id;
    } catch (err) {
      await logEvent(env.DB, {
        registration_id: reg.id,
        kind: 'registration.balance.checkout_error',
        payload: { error: String(err) },
      });
      return { ok: false, error: 'stripe-error' };
    }
  }

  const email = buildBalanceEmail({
    first_name: reg.first_name ?? (reg.name ? reg.name.split(' ')[0] : null),
    event_name: product.name,
    amount_label: eur(balance),
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
      payload: { error: sent.error, ref: externalRef },
    });
    return { ok: false, error: sent.error };
  }

  if (usePaypal) {
    await attachBalancePaypalOrder(env.DB, reg.id, externalRef);
  } else {
    await attachBalanceSession(env.DB, reg.id, externalRef);
  }
  await logEvent(env.DB, {
    registration_id: reg.id,
    kind: 'registration.balance.invited',
    source: 'admin',
    payload: { ref: externalRef, provider: usePaypal ? 'paypal' : 'stripe', balance_cents: balance },
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
