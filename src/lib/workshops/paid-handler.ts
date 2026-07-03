// Side-effects when a workshop registration becomes paid (or coupon-free):
//   1. Drip — ensure the contact exists + carries the workshop tag (tag-only).
//   2. Resend — send the confirmation email with join + add-to-calendar links.
//   3. Meta CAPI — server-side Purchase with the shared dedup event_id.
//
// All steps are best-effort and individually guarded; a failure in one is
// logged (to the shared `events` audit log) and never blocks the others.
// The confirmation email is idempotent via claimNotification('confirmation').

import { logEvent } from '../registrations/db';
import { upsertSubscriber } from '../registrations/drip';
import { recordPurchaseOrder } from '../orders/drip-order';
import {
  claimNotification,
  getProductById,
  getRegistrationById,
  getWorkshopById,
  type Workshop,
  type WorkshopRegistration,
} from './db';
import { sendEmail } from './resend';
import { confirmationEmail } from './emails';
import { googleCalendarUrl } from './ics';
import { formatInTz } from './time';
import { purchaseEventId, sendPurchaseEvent } from './meta';

type Env = {
  DB: D1Database;
  DRIP_API_TOKEN?: string;
  DRIP_ACCOUNT_ID?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
  META_PIXEL_ID?: string;
  META_ACCESS_TOKEN?: string;
  PUBLIC_BASE_URL: string;
};

export function successUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/workshop/success?t=${token}`;
}

export function icsUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api/workshops/ics?t=${token}`;
}

// The page's audience doors → readable lens names, used for Drip segmentation.
const AUDIENCE_LENSES: Record<string, string> = { '1': 'healing', '2': 'freedom', '3': 'pro' };

function audienceLenses(reg: WorkshopRegistration): string[] {
  return (reg.audience ?? '')
    .split(',')
    .map((d) => AUDIENCE_LENSES[d.trim()])
    .filter(Boolean);
}

async function tagInDrip(env: Env, reg: WorkshopRegistration, workshop: Workshop) {
  if (!env.DRIP_API_TOKEN || !env.DRIP_ACCOUNT_ID) return;
  const tags: string[] = [];
  if (reg.source_tag) tags.push(reg.source_tag);
  else if (workshop.source_tag) tags.push(workshop.source_tag);
  if (reg.wants_bump && workshop.bump_product_id) {
    const bump = await getProductById(env.DB, workshop.bump_product_id);
    if (bump) tags.push(bump.drip_tag || `prod_${bump.slug}`);
  }
  // Audience doors chosen on the workshop page → one tag per lens
  // (svh_audience_pro, …) plus an `audience` custom field. Null audience
  // sends nothing, so a lens learned earlier is never erased.
  const lenses = audienceLenses(reg);
  for (const lens of lenses) tags.push(`svh_audience_${lens}`);
  const [firstName, ...rest] = (reg.name ?? '').trim().split(' ');
  await upsertSubscriber(
    { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID },
    {
      email: reg.email,
      first_name: firstName || undefined,
      last_name: rest.join(' ') || undefined,
      country: reg.country,
      phone: reg.phone,
      time_zone: reg.timezone,
      tags: tags.length ? tags : undefined,
      custom_fields: {
        workshop_id: String(workshop.id),
        workshop_slug: workshop.slug,
        workshop_date: workshop.starts_at_utc,
        bump: reg.wants_bump ? 'yes' : 'no',
        audience: lenses.length ? lenses.join(',') : null,
      },
    },
  );
}

// Build + send the confirmation email (join + add-to-calendar links). No
// idempotency guard of its own — callers decide whether to gate. `entityRefId`
// is passed in so a forced resend can carry a fresh ref and not be folded into
// the original send by Gmail.
async function deliverConfirmation(
  env: Env,
  reg: WorkshopRegistration,
  workshop: Workshop,
  entityRefId: string,
) {
  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const tz = reg.timezone || workshop.display_tz;
  const join = successUrl(baseUrl, reg.access_token);
  const content = confirmationEmail({
    name: reg.name,
    workshopTitle: workshop.title,
    isReplay: workshop.is_replay === 1,
    whenLocal: workshop.is_replay ? 'On demand — start anytime' : formatInTz(workshop.starts_at_utc, tz),
    joinUrl: join,
    googleCalUrl: workshop.is_replay
      ? undefined
      : googleCalendarUrl({
          title: workshop.title,
          startsAtUtc: workshop.starts_at_utc,
          endsAtUtc: workshop.ends_at_utc,
          url: join,
        }),
    icsUrl: workshop.is_replay ? undefined : icsUrl(baseUrl, reg.access_token),
  });
  await sendEmail({
    apiKey: env.RESEND_API_KEY!,
    // Default sender (info@mail.songdance.co) — not the prayer@ RESEND_FROM.
    replyTo: env.RESEND_REPLY_TO,
    to: reg.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    entityRefId,
    track: { db: env.DB, type: 'confirmation', registrationId: reg.id },
  });
}

async function sendConfirmation(env: Env, reg: WorkshopRegistration, workshop: Workshop) {
  if (!env.RESEND_API_KEY) return;
  // Idempotent: only the first caller to claim the slot actually sends.
  const claimed = await claimNotification(env.DB, reg.id, 'confirmation');
  if (!claimed) return;
  await deliverConfirmation(env, reg, workshop, `workshop-confirm-${reg.id}`);
}

// Force-resend the confirmation email (admin action), bypassing the
// idempotency claim. Used to hand an existing registrant a fresh ?t= join link
// — e.g. after the rid→token switch invalidated an older calendar/email link.
// A unique entityRefId keeps the resend from being folded into the original.
export async function resendConfirmation(
  env: Env,
  registrationId: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'email_not_configured' };
  const reg = await getRegistrationById(env.DB, registrationId);
  if (!reg) return { ok: false, error: 'not_found' };
  if (reg.payment_status !== 'paid' && reg.payment_status !== 'coupon') {
    return { ok: false, error: 'not_paid' };
  }
  const workshop = await getWorkshopById(env.DB, reg.workshop_id);
  if (!workshop) return { ok: false, error: 'not_found' };
  // Claim the slot if it isn't already, so the cron's first-time confirmation
  // can't also fire later; this resend is the intentional, unguarded send.
  await claimNotification(env.DB, reg.id, 'confirmation');
  try {
    await deliverConfirmation(env, reg, workshop, `workshop-confirm-${reg.id}-resend-${Date.now()}`);
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'workshop.confirmation.resend_error',
      payload: { registration_id: reg.id, error: String(err) },
    });
    return { ok: false, error: 'send_failed' };
  }
  await logEvent(env.DB, {
    registration_id: null,
    kind: 'workshop.confirmation.resent',
    payload: { registration_id: reg.id, workshop_id: workshop.id },
  });
  return { ok: true };
}

// Side-effects when an existing registration is *moved* to a new date (the
// countdown-page "change my date"). There's no purchase to record and no Meta
// event — the seat already exists and no money changes hands — so this only
// refreshes the Drip contact's workshop fields to the new date and sends a fresh
// confirmation carrying the new date, join link and calendar. A unique
// entity-ref keeps this confirmation from being deduped against the original
// (they share a registration id, hence the same stable ref); the move already
// cleared the 'confirmation' claim, so re-claiming here also stops the cron from
// ever sending its own first-time confirmation for the new date.
export async function runWorkshopDateChangeSideEffects(
  env: Env,
  registrationId: number,
): Promise<void> {
  const reg = await getRegistrationById(env.DB, registrationId);
  if (!reg) return;
  const workshop = await getWorkshopById(env.DB, reg.workshop_id);
  if (!workshop) return;

  try {
    await tagInDrip(env, reg, workshop);
  } catch (err) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.drip.error', payload: { registration_id: reg.id, error: String(err) } });
  }

  if (!env.RESEND_API_KEY) return;
  try {
    await claimNotification(env.DB, reg.id, 'confirmation');
    await deliverConfirmation(env, reg, workshop, `workshop-confirm-${reg.id}-datechange-${Date.now()}`);
  } catch (err) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.email.error', payload: { registration_id: reg.id, error: String(err) } });
  }
}

export async function runWorkshopPaidSideEffects(
  env: Env,
  args: {
    registrationId: number;
    valueMajor?: number;
    currency?: string;
    clientIp?: string | null;
    clientUserAgent?: string | null;
    eventSourceUrl?: string;
  },
): Promise<void> {
  const reg = await getRegistrationById(env.DB, args.registrationId);
  if (!reg) return;
  const workshop = await getWorkshopById(env.DB, reg.workshop_id);
  if (!workshop) return;

  // 1. Drip tag
  try {
    await tagInDrip(env, reg, workshop);
  } catch (err) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.drip.error', payload: { registration_id: reg.id, error: String(err) } });
  }

  // 1b. Native Drip ecommerce order — so a workshop ticket counts toward the
  // buyer's lifetime value just like a course/retreat (workshops previously
  // only tagged the contact, never recording the purchase). A coupon-free seat
  // records a €0 order so the registration still shows as purchase activity.
  // Idempotent on order id `workshop-<registrationId>`.
  await recordPurchaseOrder(
    env,
    {
      type: 'workshop',
      id: reg.id,
      email: reg.email,
      currency: args.currency || reg.currency || 'EUR',
      grandTotalCents:
        args.valueMajor && args.valueMajor > 0 ? Math.round(args.valueMajor * 100) : 0,
      items: [
        {
          name: workshop.title,
          slug: workshop.slug,
          amountCents:
            args.valueMajor && args.valueMajor > 0 ? Math.round(args.valueMajor * 100) : 0,
        },
      ],
      properties: {
        workshop_id: workshop.id,
        workshop_slug: workshop.slug,
        bump: reg.wants_bump ? 'yes' : 'no',
        payment_status: reg.payment_status,
      },
    },
    'drip.workshop.order.error',
  );

  // 2. Confirmation email
  try {
    await sendConfirmation(env, reg, workshop);
  } catch (err) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.email.error', payload: { registration_id: reg.id, error: String(err) } });
  }

  // 3. Meta CAPI Purchase (only for real, paid value). The event_id is
  // deterministic per registration so it deduplicates against the browser Pixel
  // Purchase fired on /workshop/success. This fires from the Stripe webhook —
  // a server-to-server call — so there's no real visitor IP/UA to attach; the
  // browser send carries those. We still pass a true event_source_url, which
  // Meta expects for website events.
  if (
    args.valueMajor &&
    args.valueMajor > 0 &&
    args.currency &&
    env.META_PIXEL_ID &&
    env.META_ACCESS_TOKEN
  ) {
    // The masterclass is also a product-catalog item (id `masterclass`), so its
    // Purchase carries content_ids to bind to the catalog — same as the course
    // purchases. Other workshops aren't in the catalog, so they send none.
    // Detect it the same way /api/workshops/register does: the main product's
    // slug contains "masterclass".
    const ticketProduct = workshop.main_product_id
      ? await getProductById(env.DB, workshop.main_product_id)
      : null;
    const isMasterclass = (ticketProduct?.slug ?? '').includes('masterclass');
    try {
      await sendPurchaseEvent(
        { pixelId: env.META_PIXEL_ID, accessToken: env.META_ACCESS_TOKEN },
        {
          eventId: purchaseEventId(reg.id),
          email: reg.email,
          value: args.valueMajor,
          currency: args.currency,
          orderId: `wreg-${reg.id}`,
          contentIds: isMasterclass ? ['masterclass'] : undefined,
          clientIp: args.clientIp ?? null,
          clientUserAgent: args.clientUserAgent ?? null,
          eventSourceUrl:
            args.eventSourceUrl ?? successUrl(env.PUBLIC_BASE_URL, reg.access_token),
        },
      );
    } catch (err) {
      await logEvent(env.DB, { registration_id: null, kind: 'workshop.meta.error', payload: { registration_id: reg.id, error: String(err) } });
    }
  }
}
