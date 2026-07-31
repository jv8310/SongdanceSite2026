// Offering a freed place to someone on the waiting list.
//
// One call does the whole move: hold the place (offerPlace), build the claim
// link, and email it. Used by the admin button on /admin/retreats/<slug>
// (/api/admin/waitlist/offer). Mirrors sendBalanceInvite in balance.ts — the
// send is what makes it real, so a failed email rolls the hold back.

import { logEventSafe } from './db';
import {
  offerPlace,
  withdrawOffer,
  claimUrl,
  dateRangeLabel,
  sqliteToIso,
  waitlistDisplayName,
  type WaitlistEntry,
} from './waitlist';
import { buildWaitlistOfferEmail } from './waitlist-emails';
import { sendViaResend } from './balance';
import { formatInTz } from '../workshops/time';

const DEFAULT_FROM = 'Songdance <intakes@mail.songdance.co>';
const REPLY_TO = 'jacob@songdance.co';
const DISPLAY_TZ = 'Europe/Brussels';

export type WaitlistOfferEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  RESEND_INTAKES_FROM?: string;
  PUBLIC_BASE_URL?: string;
};

export type SendOfferResult =
  | { ok: true; entry: WaitlistEntry; link: string; expires_label: string }
  | { ok: false; error: string };

export async function sendWaitlistOffer(
  env: WaitlistOfferEnv,
  entryId: number,
  opts: {
    tierId: number;
    hours?: number;
    message?: string | null;
    by?: string;
    requestOrigin?: string;
  },
): Promise<SendOfferResult> {
  const offered = await offerPlace(env.DB, entryId, {
    tierId: opts.tierId,
    hours: opts.hours,
    by: opts.by,
  });
  if (!offered.ok) return { ok: false, error: offered.error };
  const entry = offered.entry;

  const product = await env.DB
    .prepare('SELECT slug, name, currency, starts_at, ends_at FROM products WHERE id = ?')
    .bind(entry.product_id)
    .first<{
      slug: string;
      name: string;
      currency: string;
      starts_at: string | null;
      ends_at: string | null;
    }>();
  const tier = await env.DB
    .prepare('SELECT name, price_cents FROM tiers WHERE id = ?')
    .bind(opts.tierId)
    .first<{ name: string; price_cents: number }>();

  const fail = async (error: string): Promise<SendOfferResult> => {
    // Nobody was told, so nothing should be held.
    await withdrawOffer(env.DB, entryId);
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'waitlist.offer.email_error',
      source: 'admin',
      payload: { waitlist_id: entryId, error },
    });
    return { ok: false, error };
  };

  if (!product || !tier) return fail('product-or-tier-missing');
  if (!env.RESEND_API_KEY) return fail('resend-key-missing');

  const baseUrl = (env.PUBLIC_BASE_URL || opts.requestOrigin || '').replace(/\/+$/, '');
  const link = claimUrl(baseUrl, product.slug, offered.token);
  if (!link) return fail('no-claim-page');

  const expiresIso = sqliteToIso(entry.offer_expires_at);
  const expiresLabel = expiresIso ? formatInTz(expiresIso, DISPLAY_TZ) : 'the date in this email';

  const mail = buildWaitlistOfferEmail({
    first_name: entry.first_name || null,
    retreat_name: product.name,
    when_label: dateRangeLabel(product.starts_at, product.ends_at),
    tier_name: tier.name,
    price_label: money(tier.price_cents, product.currency),
    expires_label: expiresLabel,
    link,
    message: opts.message?.trim() || null,
  });

  const sent = await sendViaResend({
    apiKey: env.RESEND_API_KEY,
    from: env.RESEND_INTAKES_FROM ?? DEFAULT_FROM,
    to: entry.email,
    replyTo: REPLY_TO,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
  if (!sent.ok) return fail(sent.error);

  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'waitlist.offer.emailed',
    source: 'admin',
    payload: {
      waitlist_id: entryId,
      to: entry.email,
      who: waitlistDisplayName(entry),
      tier: tier.name,
      expires_at: entry.offer_expires_at,
    },
  });

  return { ok: true, entry, link, expires_label: expiresLabel };
}

function money(cents: number, currency: string): string {
  try {
    return (cents / 100).toLocaleString('en-GB', {
      style: 'currency',
      currency: currency || 'EUR',
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    });
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}
