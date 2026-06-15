// "Pay the remainder" flow: for a registration that was paid with a 50%
// deposit, create a Stripe Checkout Session for the outstanding balance and
// email the buyer a link to settle it.
//
// Shared by the admin per-person send (api/admin/balance/send) and the bulk
// send (api/admin/balance/send-bulk). Mirrors the intake-invitation sender:
// Resend for delivery, the existing Stripe helper for the checkout link.

import { attachBalanceSession, logEvent, type Registration } from './db';
import { createCheckoutSession, paypalEnabled } from './stripe';

export type BalanceEnv = {
  DB: D1Database;
  STRIPE_SECRET_KEY: string;
  STRIPE_ENABLE_PAYPAL?: string;
  RESEND_API_KEY?: string;
  RESEND_INTAKES_FROM?: string;
  PUBLIC_BASE_URL?: string;
};

const DEFAULT_FROM = 'Songdance <intakes@mail.songdance.co>';
const REPLY_TO = 'jacob@songdance.co';

// When the balance is due. Kept in sync with the deposit copy on the
// registration form + checkout.
export const BALANCE_DUE_LABEL = 'before 1 September 2026';

function eur(cents: number): string {
  return `€${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface BalanceEmailContent {
  subject: string;
  text: string;
  html: string;
}

export function buildBalanceEmail(args: {
  first_name: string | null;
  event_name: string;
  amount_label: string;
  due_label: string;
  link: string;
}): BalanceEmailContent {
  const { first_name, event_name, amount_label, due_label, link } = args;
  const greet = first_name ? `Hi ${first_name},` : 'Hi,';
  const subject = `Your remaining balance for ${event_name}`;
  const body =
    `Thank you for reserving your place on ${event_name} with a deposit. ` +
    `Your remaining balance of ${amount_label} is now due (${due_label}). ` +
    `You can settle it securely by card below — it only takes a minute.`;
  const cta = 'Pay your remaining balance:';
  const ctaBtn = `Pay ${amount_label}`;
  const sig = 'With warmth,\nJacob';

  const text = `${greet}\n\n${body}\n\n${cta}\n${link}\n\n${sig}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F4ECDF;font-family:Georgia,serif;color:#2A1B2A;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td align="center" style="padding:48px 16px;">
    <table role="presentation" width="540" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" style="padding:0 8px 28px;">
        <span style="font-family:Georgia,'Times New Roman',serif;font-size:13px;letter-spacing:0.22em;text-transform:uppercase;color:#7A6A78;">Songdance</span>
      </td></tr>
      <tr><td style="padding:0 8px;">
        <p style="margin:0;font-family:Georgia,serif;font-size:16px;line-height:1.7;color:#2A1B2A;">${escapeHtml(greet)}</p>
        <p style="margin:18px 0 0;font-family:Georgia,serif;font-size:16px;line-height:1.75;color:#2A1B2A;white-space:pre-line;">${escapeHtml(body)}</p>
        <p style="margin:28px 0 14px;font-family:Georgia,serif;font-size:15px;color:#4A3848;">${escapeHtml(cta)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0;">
          <tr><td align="center" bgcolor="#2A1B2A" style="border-radius:999px;">
            <a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 30px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:500;letter-spacing:0.01em;color:#F4ECDF;text-decoration:none;border-radius:999px;">${escapeHtml(ctaBtn)} &rarr;</a>
          </td></tr>
        </table>
        <p style="margin:36px 0 0;font-family:Georgia,serif;font-size:16px;line-height:1.7;color:#2A1B2A;white-space:pre-line;">${escapeHtml(sig)}</p>
      </td></tr>
      <tr><td align="center" style="padding:36px 8px 0;">
        <p style="margin:0;font-family:Georgia,serif;font-size:11px;color:#B6A8B4;">songdance.co</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return { subject, html, text };
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
  const currency = (reg.currency || product.currency || 'EUR').toLowerCase();
  const lineItemName = `${product.name} — ${tier.name} (remaining balance)`;

  let session: { id: string; url: string };
  try {
    session = await createCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      enablePaypal: paypalEnabled(env),
      customer_email: reg.email,
      success_url: `${baseUrl}/registrations/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/retreats/dolphin-and-sound`,
      payment_intent_description: lineItemName,
      line_items: [
        {
          name: lineItemName,
          amount_cents: balance,
          currency,
          quantity: 1,
        },
      ],
      metadata: {
        registration_id: String(reg.id),
        product_slug: product.slug,
        tier_slug: tier.slug,
        payment_kind: 'balance',
      },
      idempotency_key: `balance-${reg.id}-${balance}`,
    });
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: reg.id,
      kind: 'registration.balance.checkout_error',
      payload: { error: String(err) },
    });
    return { ok: false, error: 'stripe-error' };
  }

  const email = buildBalanceEmail({
    first_name: reg.first_name ?? (reg.name ? reg.name.split(' ')[0] : null),
    event_name: product.name,
    amount_label: eur(balance),
    due_label: BALANCE_DUE_LABEL,
    link: session.url,
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
      payload: { error: sent.error, session_id: session.id },
    });
    return { ok: false, error: sent.error };
  }

  await attachBalanceSession(env.DB, reg.id, session.id);
  await logEvent(env.DB, {
    registration_id: reg.id,
    kind: 'registration.balance.invited',
    source: 'admin',
    payload: { session_id: session.id, balance_cents: balance },
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
