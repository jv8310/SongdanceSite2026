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
import { sendPurchaseEvent } from './meta';

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

export function successUrl(baseUrl: string, registrationId: number): string {
  return `${baseUrl.replace(/\/$/, '')}/workshop/success?rid=${registrationId}`;
}

export function icsUrl(baseUrl: string, registrationId: number): string {
  return `${baseUrl.replace(/\/$/, '')}/api/workshops/ics?rid=${registrationId}`;
}

async function tagInDrip(env: Env, reg: WorkshopRegistration, workshop: Workshop) {
  if (!env.DRIP_API_TOKEN || !env.DRIP_ACCOUNT_ID) return;
  const tags: string[] = [];
  if (reg.source_tag) tags.push(reg.source_tag);
  else if (workshop.source_tag) tags.push(workshop.source_tag);
  if (reg.wants_bump && workshop.bump_product_id) {
    const bump = await getProductById(env.DB, workshop.bump_product_id);
    if (bump) tags.push(`prod_${bump.slug}`);
  }
  const [firstName, ...rest] = (reg.name ?? '').trim().split(' ');
  await upsertSubscriber(
    { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID },
    {
      email: reg.email,
      first_name: firstName || undefined,
      last_name: rest.join(' ') || undefined,
      country: reg.country,
      phone: reg.phone,
      tags: tags.length ? tags : undefined,
      custom_fields: {
        workshop_id: String(workshop.id),
        workshop_slug: workshop.slug,
        workshop_date: workshop.starts_at_utc,
        bump: reg.wants_bump ? 'yes' : 'no',
      },
    },
  );
}

async function sendConfirmation(env: Env, reg: WorkshopRegistration, workshop: Workshop) {
  if (!env.RESEND_API_KEY) return;
  // Idempotent: only the first caller to claim the slot actually sends.
  const claimed = await claimNotification(env.DB, reg.id, 'confirmation');
  if (!claimed) return;

  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const tz = reg.timezone || workshop.display_tz;
  const join = successUrl(baseUrl, reg.id);
  const content = confirmationEmail({
    name: reg.name,
    workshopTitle: workshop.title,
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
    icsUrl: workshop.is_replay ? undefined : icsUrl(baseUrl, reg.id),
  });
  await sendEmail({
    apiKey: env.RESEND_API_KEY,
    // Default sender (info@mail.songdance.co) — not the prayer@ RESEND_FROM.
    replyTo: env.RESEND_REPLY_TO,
    to: reg.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    entityRefId: `workshop-confirm-${reg.id}`,
  });
}

export async function runWorkshopPaidSideEffects(
  env: Env,
  args: {
    registrationId: number;
    metaEventId?: string | null;
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

  // 2. Confirmation email
  try {
    await sendConfirmation(env, reg, workshop);
  } catch (err) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.email.error', payload: { registration_id: reg.id, error: String(err) } });
  }

  // 3. Meta CAPI Purchase (only for real, paid value)
  if (
    args.metaEventId &&
    args.valueMajor &&
    args.valueMajor > 0 &&
    args.currency &&
    env.META_PIXEL_ID &&
    env.META_ACCESS_TOKEN
  ) {
    try {
      await sendPurchaseEvent(
        { pixelId: env.META_PIXEL_ID, accessToken: env.META_ACCESS_TOKEN },
        {
          eventId: args.metaEventId,
          email: reg.email,
          value: args.valueMajor,
          currency: args.currency,
          orderId: `wreg-${reg.id}`,
          clientIp: args.clientIp ?? null,
          clientUserAgent: args.clientUserAgent ?? null,
          eventSourceUrl: args.eventSourceUrl,
        },
      );
    } catch (err) {
      await logEvent(env.DB, { registration_id: null, kind: 'workshop.meta.error', payload: { registration_id: reg.id, error: String(err) } });
    }
  }
}
