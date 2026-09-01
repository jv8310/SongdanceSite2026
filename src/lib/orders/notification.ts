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
import { parsePurchasedBumps } from '../courses/db';
import { BUMPS, isBumpSlug, type BumpSlug } from '../courses/bumps';
import {
  DECK_GIFT_BUMP_SLUG,
  DECK_GIFT_LABEL,
  DECK_GIFT_COUPON_CODE,
  DECK_GIFT_SHOP_ORIGIN,
  deckGiftClaimUrl,
  parseDeckGiftShipping,
  type DeckGiftShipping,
} from '../courses/deck-promo';
import {
  placeDeckGiftShopifyOrder,
  shopifyConfigured,
  type ShopifyEnv,
} from './shopify';
import { deckGiftClaimEmail, deckGiftConfirmedEmail } from '../workshops/emails';
import { sendAlbumPurchaseEmail } from '../music/delivery';
import { LANGUAGE_CHOICE_LABEL } from '../courses/journeys';
import { BANK_TRANSFER, type OrderProvider } from '../payments/provider';
import type { Registration } from '../registrations/db';
import { logEvent } from '../registrations/db';
import { getSubscriber } from '../registrations/drip';
import { formatMoney } from '../workshops/currency';
import { sendEmail } from '../workshops/resend';
import type { EmailContent } from '../workshops/emails';

export type OrderEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  RESEND_REPLY_TO?: string;
  QUADERNO_ACCOUNT?: string;
  DRIP_API_TOKEN?: string;
  DRIP_ACCOUNT_ID?: string;
  ORDER_NOTIFICATIONS_TO?: string;
  // Used to build the album player link in the buyer's delivery email.
  PUBLIC_BASE_URL?: string;
} & ShopifyEnv;

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
  // One-time order bumps bought alongside a course (label + amount). Rendered as
  // an "Add-ons" row plus an "Order total" (amountCents + bumps). Omit for none.
  bumps?: Array<{ label: string; amountCents: number }>;
  // The workshop this buyer came through, if any — looked up by email against
  // paid/coupon workshop registrations (prefer the one they attended, else the
  // most recent). Lets the ops inbox see which workshop a course sale traces to.
  // `moreCount` = additional matching workshops beyond the one shown.
  attendedWorkshop?: {
    title: string;
    startsAtUtc: string | null;
    isReplay: boolean;
    attendanceStatus: string; // 'registered' | 'attended' | 'no_show'
    moreCount?: number;
  } | null;
  paymentPlan?: string | null;
  installmentsTotal?: number | null;
  activateChoice?: string | null;
  languageChoice?: string | null;
  sourceVariant?: string | null;
  dietary?: string | null;
  notes?: string | null;
  paidAt?: string | null;
  provider?: OrderProvider;
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

// "12 Jun 2026" in the workshop's home timezone. Accepts both ISO ("…Z") and
// SQLite "YYYY-MM-DD HH:MM:SS" (also UTC).
function workshopDateLabel(iso: string): string {
  const ms = Date.parse(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(ms)) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Brussels',
  }).format(new Date(ms));
}

// One-line summary of the workshop a course buyer came through, for the
// "Workshop attended" row: "SVH Workshop · 12 Jun 2026 · attended (+1 more)".
function attendedWorkshopValue(aw: OrderNotificationInput['attendedWorkshop']): string | null {
  if (!aw) return null;
  const title = aw.title.replace(/Somatic Vocal Healing/gi, 'SVH');
  const when = aw.isReplay
    ? 'on-demand'
    : aw.startsAtUtc
      ? workshopDateLabel(aw.startsAtUtc)
      : null;
  const attend =
    aw.attendanceStatus === 'attended'
      ? 'attended'
      : aw.attendanceStatus === 'no_show'
        ? 'registered · no-show'
        : 'registered';
  const more = aw.moreCount && aw.moreCount > 0 ? ` (+${aw.moreCount} more)` : '';
  return [title, when, attend].filter(Boolean).join(' · ') + more;
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

function gatewayLabel(provider: OrderProvider | undefined): string {
  if (provider === BANK_TRANSFER) return 'Bank transfer';
  return provider === 'paypal' ? 'PayPal' : 'Stripe';
}

// Provider-aware deep link into the gateway dashboard for this payment.
function paymentUrl(input: OrderNotificationInput): string | null {
  // A manual IBAN transfer never touched a gateway, so there is nothing to
  // link to — the money is in the bank statement.
  if (input.provider === BANK_TRANSFER) return null;
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

  // One-time add-ons (order bumps): an itemised "Add-ons" row + an "Order total"
  // (course + bumps). Both drop out when there are no bumps.
  const bumps = input.bumps ?? [];
  const bumpsTotal = bumps.reduce((s, b) => s + b.amountCents, 0);
  const addonsValue = bumps.length
    ? bumps
        .map((b) => `${b.label} (${formatMoney(b.amountCents, input.currency)})`)
        .join(', ')
    : null;
  const orderTotal = bumps.length
    ? formatMoney(input.amountCents + bumpsTotal, input.currency)
    : null;

  // Build the field list. Each entry is [label, value]; null/empty values are
  // dropped so the email only shows what's actually there.
  const fields: Array<[string, string | null | undefined]> = [
    ['Order', `#${input.orderId} · ${input.orderType === 'course' ? 'Course' : 'Retreat'}`],
    ['Product', input.tierName ? `${input.productName} — ${input.tierName}` : input.productName],
    ['Workshop attended', attendedWorkshopValue(input.attendedWorkshop)],
    ['Amount', planLabel ? `${amount} (${planLabel})` : amount],
    ['Add-ons', addonsValue],
    ['Order total', orderTotal],
    ['Gateway', gatewayLabel(input.provider)],
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
    [`${gatewayLabel(input.provider)} payment`, paymentUrl(input)],
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

// Which workshop a buyer came through, matched by email against completed
// (paid/coupon) workshop registrations. Prefers a workshop they *attended*,
// then the most recent by start date; `moreCount` counts the rest. Returns null
// when the buyer never registered for a workshop — a pure course purchase.
export async function findAttendedWorkshopForEmail(
  db: D1Database,
  email: string,
): Promise<OrderNotificationInput['attendedWorkshop']> {
  const e = (email ?? '').trim().toLowerCase();
  if (!e) return null;
  const res = await db
    .prepare(
      `SELECT w.title AS title, w.starts_at_utc AS starts_at_utc,
              w.is_replay AS is_replay, r.attendance_status AS attendance_status
         FROM workshop_registrations r
         JOIN workshops w ON w.id = r.workshop_id
        WHERE lower(r.email) = ?
          AND r.payment_status IN ('paid','coupon')
          AND w.deleted = 0
        ORDER BY (r.attendance_status = 'attended') DESC, w.starts_at_utc DESC`,
    )
    .bind(e)
    .all<{ title: string; starts_at_utc: string; is_replay: number; attendance_status: string }>();
  const rows = res.results ?? [];
  if (!rows.length) return null;
  const top = rows[0];
  return {
    title: top.title,
    startsAtUtc: top.starts_at_utc ?? null,
    isReplay: top.is_replay === 1,
    attendanceStatus: top.attendance_status,
    moreCount: rows.length - 1,
  };
}

// ── Thin adapters that gather the data from a paid registration row ─────────
export async function notifyCourseOrder(
  env: OrderEnv,
  reg: CourseRegistration,
  opts?: { stripePaymentIntent?: string | null; stripeSubscriptionId?: string | null },
): Promise<void> {
  const productName = COURSE_PRODUCT_LABELS[reg.product_slug] ?? reg.product_slug;
  // Best-effort: which workshop did this buyer come through? Never blocks send.
  let attendedWorkshop: OrderNotificationInput['attendedWorkshop'] = null;
  try {
    attendedWorkshop = await findAttendedWorkshopForEmail(env.DB, reg.email);
  } catch {
    /* leave null — the notification still goes out */
  }
  const fullName =
    [reg.first_name, reg.last_name].filter(Boolean).join(' ').trim() ||
    reg.email.split('@')[0];
  const bumps = parsePurchasedBumps(reg.bumps)
    .filter((b) => isBumpSlug(b.slug) || b.slug === DECK_GIFT_BUMP_SLUG)
    .map((b) => ({
      // The Song Deck gift is a zero-amount add-on fulfilled via Shopify: when a
      // shipping address was collected + Shopify is configured, the €0 order is
      // placed automatically (fulfilDeckGift, below); otherwise the buyer gets
      // the SVH-BONUS claim email to self-order the deck free on songdeck.shop.
      label: isBumpSlug(b.slug)
        ? BUMPS[b.slug as BumpSlug].label
        : `🎁 ${DECK_GIFT_LABEL} (auto-placed on Shopify when a shipping address was given, else ${DECK_GIFT_COUPON_CODE} claim email)`,
      amountCents: b.amount_cents,
    }));
  await sendOrderNotification(env, {
    orderType: 'course',
    orderId: reg.id,
    productName,
    productSlug: reg.product_slug,
    attendedWorkshop,
    firstName: firstNameOf(reg.first_name, reg.email.split('@')[0]),
    customerName: fullName,
    email: reg.email,
    phone: reg.phone,
    country: reg.country,
    companyName: reg.company_name,
    vatNumber: reg.vat_number,
    amountCents: reg.amount_cents,
    currency: reg.currency,
    bumps: bumps.length ? bumps : undefined,
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

  // Song Deck gift: a buyer whose registration carries the zero-amount gift row
  // is fulfilled — either the deck order is placed on Shopify (when configured +
  // a shipping address was collected) and a confirmation email goes out, or the
  // buyer gets the SVH-BONUS claim email to self-order. Riding notifyCourseOrder
  // means every fulfilment path triggers it — Stripe webhook, PayPal, free
  // checkout, admin mark-paid, and the hourly order-notification reconcile.
  await fulfilDeckGift(env, reg);

  // A music album bought on its own (product slug `album-<id>`): hand the buyer
  // their player link. Same reasoning as the deck gift above — riding
  // notifyCourseOrder means every fulfilment path delivers it, including the
  // hourly reconcile if a webhook was ever dropped. No-op for every other
  // product; idempotent on its own claim.
  await sendAlbumPurchaseEmail(env, reg);
}

// Turn the stored shipping address into the display lines the confirmation email
// echoes back to the buyer.
export function deckGiftAddressLines(ship: DeckGiftShipping): string[] {
  const cityLine = [ship.postal_code, ship.city].filter(Boolean).join(' ');
  const regionLine = [ship.region].filter(Boolean).join('');
  return [
    ship.name,
    ship.line1,
    ship.line2,
    cityLine,
    regionLine,
    ship.country,
  ].filter((l) => (l ?? '').trim());
}

// Orchestrate deck-gift fulfilment. Never throws into the caller. Each branch is
// independently idempotent (its own `events` claim), so it's safe to re-run from
// the reconcile: a placed order won't re-place, a sent email won't re-send.
//
//   Shopify configured + address on file → place the €0 order, then confirm.
//   otherwise (or on a Shopify failure)   → send the SVH-BONUS claim email.
export async function fulfilDeckGift(env: OrderEnv, reg: CourseRegistration): Promise<void> {
  const hasGift = parsePurchasedBumps(reg.bumps).some((b) => b.slug === DECK_GIFT_BUMP_SLUG);
  if (!hasGift) return;

  const ship = parseDeckGiftShipping(reg.deck_gift_shipping);

  if (shopifyConfigured(env) && ship) {
    const result = await placeDeckGiftShopifyOrder(env, reg);
    // 'placed'/'already' → the order exists; confirm it (idempotent). Any other
    // status (failed, or skipped for a reason other than a missing address) →
    // fall back to the self-serve coupon so the buyer still gets their deck.
    if (result.status === 'placed' || result.status === 'already') {
      await sendDeckGiftConfirmedEmail(env, reg, ship);
      return;
    }
  }

  await sendDeckGiftClaimEmail(env, reg);
}

// Buyer-facing, transactional (part of the purchase — never suppression-gated).
// Idempotent on its own events claim, released on failure so a redelivery /
// reconcile can retry. Never throws into the caller.
export async function sendDeckGiftConfirmedEmail(
  env: OrderEnv,
  reg: CourseRegistration,
  ship: DeckGiftShipping,
): Promise<void> {
  if (!env.RESEND_API_KEY) return;

  const externalId = `deck-gift-confirmed-${reg.id}`;
  let claimed = false;
  try {
    const r = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id)
         VALUES (NULL, 'deck.gift.confirmed.sent', 'system', ?)`,
      )
      .bind(externalId)
      .run();
    claimed = (r.meta?.changes ?? 0) > 0;
    if (!claimed) return; // already sent for this order

    const content = deckGiftConfirmedEmail({
      name: reg.first_name,
      addressLines: deckGiftAddressLines(ship),
    });
    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      to: reg.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      entityRefId: externalId,
      track: { db: env.DB, type: 'deck_gift_confirmed' },
    });
  } catch (err) {
    if (claimed) {
      await env.DB
        .prepare(`DELETE FROM events WHERE external_id = ? AND kind = 'deck.gift.confirmed.sent'`)
        .bind(externalId)
        .run()
        .catch(() => {});
    }
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'deck.gift.confirmed.error',
      source: 'system',
      payload: { course_registration_id: reg.id, error: String(err) },
    }).catch(() => {});
  }
}

// Buyer-facing, transactional (part of the purchase — never suppression-gated).
// Idempotent on its own events claim, released on failure so a webhook
// redelivery / reconcile pass can retry. Never throws into the caller.
export async function sendDeckGiftClaimEmail(
  env: OrderEnv,
  reg: CourseRegistration,
): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  const hasGift = parsePurchasedBumps(reg.bumps).some(
    (b) => b.slug === DECK_GIFT_BUMP_SLUG,
  );
  if (!hasGift) return;

  const externalId = `deck-gift-claim-${reg.id}`;
  let claimed = false;
  try {
    const r = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id)
         VALUES (NULL, 'deck.gift.claim.sent', 'system', ?)`,
      )
      .bind(externalId)
      .run();
    claimed = (r.meta?.changes ?? 0) > 0;
    if (!claimed) return; // already sent for this order

    const content = deckGiftClaimEmail({
      name: reg.first_name,
      claimUrl: deckGiftClaimUrl(),
      couponCode: DECK_GIFT_COUPON_CODE,
      shopUrl: DECK_GIFT_SHOP_ORIGIN,
    });
    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      to: reg.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      entityRefId: externalId,
      track: { db: env.DB, type: 'deck_gift_claim' },
    });
  } catch (err) {
    if (claimed) {
      await env.DB
        .prepare(`DELETE FROM events WHERE external_id = ? AND kind = 'deck.gift.claim.sent'`)
        .bind(externalId)
        .run()
        .catch(() => {});
    }
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'deck.gift.claim.error',
      source: 'system',
      payload: { course_registration_id: reg.id, error: String(err) },
    }).catch(() => {});
  }
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
