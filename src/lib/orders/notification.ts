// Internal "SD-ORDER" notification — a plain ops email to the team whenever a
// real purchase is paid through the site. NOT customer-facing: the recipients
// are jacob@ / support@ (configurable via ORDER_NOTIFICATIONS_TO), the subject
// is prefixed `SD-ORDER:` for easy inbox filtering, and the body carries every
// order detail plus one-click links into Quaderno (the invoice), Stripe (the
// payment) and Drip (the subscriber).
//
// Scope: retreat registrations and course registrations (grief, 12-week,
// certification, bundle). Workshop and masterclass registrations are NOT
// notified — both route through the workshop engine, which never calls this.
// That's deliberate: those are high-volume and would flood the inbox.
//
// Idempotency: each order claims a unique row in the `events` audit log
// (external_id `order-notify-<type>-<id>`) before sending, so re-delivered
// Stripe events never produce a second email. A send failure releases the
// claim so a later retry can still get through.

import type { CourseRegistration } from '../courses/db';
import { LANGUAGE_CHOICE_LABEL } from '../courses/journeys';
import type { Registration } from '../registrations/db';
import { logEvent } from '../registrations/db';
import { getSubscriber } from '../registrations/drip';
import { formatMoney } from '../workshops/currency';
import { sendEmail } from '../workshops/resend';
import type { EmailContent } from '../workshops/emails';

export type OrderEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  QUADERNO_ACCOUNT?: string;
  DRIP_API_TOKEN?: string;
  DRIP_ACCOUNT_ID?: string;
  ORDER_NOTIFICATIONS_TO?: string;
};

// Where SD-ORDER notifications land when ORDER_NOTIFICATIONS_TO is unset.
const DEFAULT_RECIPIENTS = ['jacob@songdance.co', 'support@songdance.co'];

// Course product slug → human label (matches the labels used on the course
// pages — see src/lib/courses/variant.ts, grief.ts, twelve-week.ts).
const COURSE_PRODUCT_LABELS: Record<string, string> = {
  'cc-cert': 'SVH Certification Course',
  'cc-bundle': '12-Week Course + Certification Course',
  'grief-course': 'The Grief Course',
  'svh-12week': '12-Week SVH Course',
};

const PAYMENT_PLAN_LABELS: Record<string, string> = {
  full: 'Paid in full',
  '3x': '3× monthly installments',
  '6x': '6× monthly installments',
  '12x': '12× monthly installments',
};

export type OrderNotificationInput = {
  orderType: 'course' | 'retreat';
  orderId: number;
  productName: string;
  productSlug?: string | null;
  tierName?: string | null;
  firstName: string;
  customerName: string;
  email: string;
  phone?: string | null;
  country?: string | null;
  companyName?: string | null;
  vatNumber?: string | null;
  amountCents: number;
  currency: string;
  paymentPlan?: string | null;
  installmentsTotal?: number | null;
  activateChoice?: string | null;
  languageChoice?: string | null;
  sourceVariant?: string | null;
  dietary?: string | null;
  notes?: string | null;
  paidAt?: string | null;
  provider?: 'stripe' | 'paypal';
  stripePaymentIntent?: string | null;
  stripeSubscriptionId?: string | null;
  paypalCaptureId?: string | null;
  paypalSubscriptionId?: string | null;
};

// Link config resolved from env at send time (kept out of the pure builder so
// the builder stays trivially previewable with sample data).
type LinkContext = {
  quadernoAccount?: string | null;
  dripAccountId?: string | null;
  dripSubscriberId?: string | null;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstNameOf(first: string | null | undefined, fallback: string): string {
  const f = (first ?? '').trim().split(' ')[0];
  return f || fallback;
}

function resolveRecipients(env: OrderEnv): string[] {
  const raw = (env.ORDER_NOTIFICATIONS_TO ?? '').trim();
  if (!raw) return DEFAULT_RECIPIENTS;
  const list = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : DEFAULT_RECIPIENTS;
}

// The Quaderno invoice is created asynchronously by the Stripe↔Quaderno sync,
// so we don't know its id at webhook time — we link to the invoices list
// filtered by the buyer's email, which lands on (or right beside) it.
function quadernoUrl(ctx: LinkContext, email: string): string | null {
  if (!ctx.quadernoAccount) return null;
  return `https://${ctx.quadernoAccount}.quadernoapp.com/invoices?q=${encodeURIComponent(email)}`;
}

// Provider-aware deep link into the gateway dashboard for this payment.
function paymentUrl(input: OrderNotificationInput): string | null {
  if (input.provider === 'paypal') {
    if (input.paypalSubscriptionId) {
      return `https://www.paypal.com/billing/subscriptions/${input.paypalSubscriptionId}`;
    }
    if (input.paypalCaptureId) {
      return `https://www.paypal.com/activity/payment/${input.paypalCaptureId}`;
    }
    return `https://www.paypal.com/listing/transactions`;
  }
  if (input.stripeSubscriptionId) {
    return `https://dashboard.stripe.com/subscriptions/${input.stripeSubscriptionId}`;
  }
  if (input.stripePaymentIntent) {
    return `https://dashboard.stripe.com/payments/${input.stripePaymentIntent}`;
  }
  return `https://dashboard.stripe.com/search?query=${encodeURIComponent(input.email)}`;
}

function dripUrl(ctx: LinkContext): string | null {
  if (!ctx.dripAccountId) return null;
  if (ctx.dripSubscriberId) {
    return `https://www.getdrip.com/${ctx.dripAccountId}/subscribers/${ctx.dripSubscriberId}`;
  }
  return `https://www.getdrip.com/${ctx.dripAccountId}/subscribers`;
}

// ── The email itself ───────────────────────────────────────────────────────
export function buildOrderNotificationEmail(
  input: OrderNotificationInput,
  ctx: LinkContext = {},
): EmailContent {
  const first = firstNameOf(input.firstName, input.customerName || input.email);
  const subject = `SD-ORDER: ${input.productName} by ${first} (#${input.orderId})`;

  const amount = formatMoney(input.amountCents, input.currency);
  const planLabel = input.paymentPlan
    ? PAYMENT_PLAN_LABELS[input.paymentPlan] ?? input.paymentPlan
    : null;

  // Build the field list. Each entry is [label, value]; null/empty values are
  // dropped so the email only shows what's actually there.
  const fields: Array<[string, string | null | undefined]> = [
    ['Order', `#${input.orderId} · ${input.orderType === 'course' ? 'Course' : 'Retreat'}`],
    ['Product', input.tierName ? `${input.productName} — ${input.tierName}` : input.productName],
    ['Amount', planLabel ? `${amount} (${planLabel})` : amount],
    ['Gateway', input.provider === 'paypal' ? 'PayPal' : 'Stripe'],
    ['Name', input.customerName],
    ['Email', input.email],
    ['Phone', input.phone],
    ['Country', input.country],
    ['Company', input.companyName],
    ['VAT number', input.vatNumber],
    [
      'Activation',
      input.activateChoice
        ? input.activateChoice === 'now'
          ? 'Activate certification now'
          : 'Wait (12-week first)'
        : null,
    ],
    ['Journey language', input.languageChoice],
    ['Dietary', input.dietary],
    ['Notes', input.notes],
    ['Source', input.sourceVariant],
    ['Paid at', input.paidAt],
  ];

  const links: Array<[string, string | null]> = [
    ['Quaderno invoice', quadernoUrl(ctx, input.email)],
    [input.provider === 'paypal' ? 'PayPal payment' : 'Stripe payment', paymentUrl(input)],
    ['Drip subscriber', dripUrl(ctx)],
  ];

  // ── HTML ──
  const rowsHtml = fields
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(
      ([label, v]) =>
        `<tr>
          <td style="padding:7px 14px 7px 0;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:7px 0;font-size:14px;color:#111827;vertical-align:top;">${escapeHtml(String(v))}</td>
        </tr>`,
    )
    .join('');

  const linksHtml = links
    .filter(([, href]) => !!href)
    .map(
      ([label, href]) =>
        `<a href="${href}" style="display:inline-block;margin:0 10px 8px 0;padding:9px 16px;background:#111827;color:#ffffff;font-size:13px;text-decoration:none;border-radius:8px;">${escapeHtml(label)} →</a>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;">
    <tr><td align="center" style="padding:28px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
        <tr><td style="padding:22px 26px 6px;">
          <p style="margin:0 0 2px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">New order · ${escapeHtml(input.orderType === 'course' ? 'Course' : 'Retreat')}</p>
          <h1 style="margin:0;font-size:20px;font-weight:600;color:#111827;">${escapeHtml(input.productName)}</h1>
          <p style="margin:4px 0 0;font-size:14px;color:#6b7280;">by ${escapeHtml(input.customerName)} · #${input.orderId}</p>
        </td></tr>
        <tr><td style="padding:14px 26px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table>
        </td></tr>
        <tr><td style="padding:18px 26px 26px;">
          ${linksHtml || '<p style="margin:0;font-size:13px;color:#9ca3af;">No external links available.</p>'}
        </td></tr>
      </table>
      <p style="margin:14px 0 0;font-size:11px;color:#9ca3af;">Automated order notification · Songdance</p>
    </td></tr>
  </table>
</body></html>`;

  // ── Plain text ──
  const textLines = [
    subject,
    '',
    ...fields
      .filter(([, v]) => v != null && String(v).trim() !== '')
      .map(([label, v]) => `${label}: ${v}`),
    '',
    ...links.filter(([, href]) => !!href).map(([label, href]) => `${label}: ${href}`),
  ];

  return { subject, html, text: textLines.join('\n') };
}

// ── Send (with idempotency claim) ──────────────────────────────────────────
async function claimOrderNotification(db: D1Database, externalId: string): Promise<boolean> {
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id)
       VALUES (NULL, 'order.notification.sent', 'system', ?)`,
    )
    .bind(externalId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

async function releaseOrderNotification(db: D1Database, externalId: string): Promise<void> {
  await db
    .prepare(`DELETE FROM events WHERE external_id = ? AND kind = 'order.notification.sent'`)
    .bind(externalId)
    .run();
}

// Best-effort by contract: this never throws into the webhook. Any failure
// releases the idempotency claim (so a Stripe redelivery can retry) and is
// logged to the events audit log.
export async function sendOrderNotification(
  env: OrderEnv,
  input: OrderNotificationInput,
): Promise<void> {
  if (!env.RESEND_API_KEY) return;

  const externalId = `order-notify-${input.orderType}-${input.orderId}`;
  let claimed = false;
  try {
    claimed = await claimOrderNotification(env.DB, externalId);
    if (!claimed) return; // already notified for this order

    // Best-effort Drip subscriber id, so the Drip link is a precise deep link
    // rather than the subscribers index. Never blocks the send.
    let dripSubscriberId: string | null = null;
    if (env.DRIP_API_TOKEN && env.DRIP_ACCOUNT_ID) {
      try {
        const sub = await getSubscriber(
          { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID },
          input.email,
        );
        dripSubscriberId = sub?.id ?? null;
      } catch {
        /* fall back to the subscribers index link */
      }
    }

    const content = buildOrderNotificationEmail(input, {
      quadernoAccount: env.QUADERNO_ACCOUNT ?? null,
      dripAccountId: env.DRIP_ACCOUNT_ID ?? null,
      dripSubscriberId,
    });

    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      to: resolveRecipients(env),
      // Reply goes straight to the buyer — handy for an order notification.
      replyTo: input.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      entityRefId: externalId,
    });
  } catch (err) {
    // Let a future redelivery retry by releasing the claim.
    if (claimed) await releaseOrderNotification(env.DB, externalId).catch(() => {});
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'order.notification.error',
      source: 'system',
      payload: { order_type: input.orderType, order_id: input.orderId, error: String(err) },
    }).catch(() => {});
  }
}

// ── Thin adapters that gather the data from a paid registration row ─────────
export async function notifyCourseOrder(
  env: OrderEnv,
  reg: CourseRegistration,
  opts?: { stripePaymentIntent?: string | null; stripeSubscriptionId?: string | null },
): Promise<void> {
  const productName = COURSE_PRODUCT_LABELS[reg.product_slug] ?? reg.product_slug;
  const fullName =
    [reg.first_name, reg.last_name].filter(Boolean).join(' ').trim() ||
    reg.email.split('@')[0];
  await sendOrderNotification(env, {
    orderType: 'course',
    orderId: reg.id,
    productName,
    productSlug: reg.product_slug,
    firstName: firstNameOf(reg.first_name, reg.email.split('@')[0]),
    customerName: fullName,
    email: reg.email,
    phone: reg.phone,
    country: reg.country,
    companyName: reg.company_name,
    vatNumber: reg.vat_number,
    amountCents: reg.amount_cents,
    currency: reg.currency,
    paymentPlan: reg.payment_plan,
    installmentsTotal: reg.installments_total,
    activateChoice: reg.activate_choice,
    languageChoice: reg.language_choice
      ? LANGUAGE_CHOICE_LABEL[reg.language_choice] ?? reg.language_choice
      : null,
    sourceVariant: reg.source_variant,
    paidAt: reg.paid_at ?? new Date().toISOString(),
    provider: reg.provider,
    stripePaymentIntent: opts?.stripePaymentIntent ?? reg.stripe_payment_intent,
    stripeSubscriptionId: opts?.stripeSubscriptionId ?? reg.stripe_subscription_id,
    paypalCaptureId: reg.paypal_capture_id,
    paypalSubscriptionId: reg.paypal_subscription_id,
  });
}

export async function notifyRetreatOrder(
  env: OrderEnv,
  reg: Registration,
  opts?: { stripePaymentIntent?: string | null },
): Promise<void> {
  const product = await env.DB.prepare('SELECT name, slug FROM products WHERE id = ?')
    .bind(reg.product_id)
    .first<{ name: string; slug: string }>();
  const tier = await env.DB.prepare('SELECT name FROM tiers WHERE id = ?')
    .bind(reg.tier_id)
    .first<{ name: string }>();
  await sendOrderNotification(env, {
    orderType: 'retreat',
    orderId: reg.id,
    productName: product?.name ?? `Product #${reg.product_id}`,
    productSlug: product?.slug ?? null,
    tierName: tier?.name ?? null,
    firstName: firstNameOf(reg.first_name ?? reg.name, reg.email.split('@')[0]),
    customerName: reg.name,
    email: reg.email,
    phone: reg.phone,
    country: reg.country,
    companyName: reg.company_name,
    vatNumber: reg.vat_number,
    amountCents: reg.amount_cents,
    currency: reg.currency,
    dietary: reg.dietary,
    notes: reg.notes,
    paidAt: reg.paid_at ?? new Date().toISOString(),
    provider: reg.provider,
    stripePaymentIntent: opts?.stripePaymentIntent ?? reg.stripe_payment_intent,
    paypalCaptureId: reg.paypal_capture_id,
  });
}
