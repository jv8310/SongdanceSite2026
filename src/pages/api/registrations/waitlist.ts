import type { APIRoute } from 'astro';
import {
  getProductBySlug,
  getTierBySlug,
  logEventSafe,
} from '../../../lib/registrations/db';
import {
  joinWaitlist,
  getLiveOfferByToken,
  queuePosition,
  dateRangeLabel,
  sqliteToIso,
} from '../../../lib/registrations/waitlist';
import { buildWaitlistJoinedEmail } from '../../../lib/registrations/waitlist-emails';
import { sendViaResend } from '../../../lib/registrations/balance';
import { formatInTz } from '../../../lib/workshops/time';
import { findCountry } from '../../../lib/countries';

export const prerender = false;

// The waiting list on a sold-out retreat.
//
//   GET  ?claim=<token>  → what a claim link is offering (tier, expiry, the
//                          details we already hold), so the retreat's own
//                          registration form can unlock and prefill itself.
//   POST                 → put someone on the list (upsert on email) and
//                          confirm it by email.
//
// The offer side of this — who gets called up, and when — is admin-driven:
// see /api/admin/waitlist/offer.

const DEFAULT_FROM = 'Songdance <intakes@mail.songdance.co>';
const REPLY_TO = 'jacob@songdance.co';
const DISPLAY_TZ = 'Europe/Brussels';

export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;
  const token = (url.searchParams.get('claim') ?? '').trim();
  if (!token) return json({ ok: false, reason: 'no-token' }, 400);

  const entry = await getLiveOfferByToken(env.DB, token);
  if (!entry) return json({ ok: false, reason: 'expired' }, 200);

  const product = await env.DB
    .prepare('SELECT slug, name, currency FROM products WHERE id = ?')
    .bind(entry.product_id)
    .first<{ slug: string; name: string; currency: string }>();
  const tier = entry.offered_tier_id
    ? await env.DB
        .prepare('SELECT slug, name, price_cents FROM tiers WHERE id = ?')
        .bind(entry.offered_tier_id)
        .first<{ slug: string; name: string; price_cents: number }>()
    : null;
  if (!product || !tier) return json({ ok: false, reason: 'expired' }, 200);

  const expiresIso = sqliteToIso(entry.offer_expires_at);

  return json({
    ok: true,
    product_slug: product.slug,
    product_name: product.name,
    tier_slug: tier.slug,
    tier_name: tier.name,
    price_cents: tier.price_cents,
    expires_at: expiresIso,
    expires_label: expiresIso ? formatInTz(expiresIso, DISPLAY_TZ) : null,
    first_name: entry.first_name || null,
    last_name: entry.last_name,
    email: entry.email,
    phone: entry.phone,
    phone_country: entry.phone_country,
    country: entry.country,
  });
};

type Body = {
  product_slug?: string;
  tier_slug?: string;      // preferred room/cabin; '' or absent = any
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string;        // ISO-2
  phone_country?: string;  // ISO-2
  phone?: string;          // local number, no dial prefix
  party_size?: number;
  notes?: string;
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const productSlug = (payload.product_slug ?? '').trim();
  const tierSlug = (payload.tier_slug ?? '').trim();
  const firstName = (payload.first_name ?? '').trim();
  const lastName = (payload.last_name ?? '').trim();
  const email = (payload.email ?? '').trim().toLowerCase();
  const countryCode = (payload.country ?? '').trim().toUpperCase();
  const phoneCountryCode = (payload.phone_country ?? '').trim().toUpperCase();
  const phoneLocal = (payload.phone ?? '').trim();

  if (!productSlug || !firstName || !email) {
    return json({ error: 'Please fill in your name and email.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400);
  }

  const product = await getProductBySlug(env.DB, productSlug);
  if (!product || product.type !== 'retreat') {
    return json({ error: 'This retreat isn\'t available right now.' }, 404);
  }

  // The room preference is optional and never blocks the join: an unknown or
  // admin-only tier just means "anything that comes free".
  let tierId: number | null = null;
  let tierName: string | null = null;
  if (tierSlug && !/admin|test/i.test(tierSlug)) {
    const tier = await getTierBySlug(env.DB, product.id, tierSlug);
    if (tier) {
      tierId = tier.id;
      tierName = tier.name;
    }
  }

  const phoneCountry = phoneCountryCode ? findCountry(phoneCountryCode) : null;
  const phoneE164 =
    phoneCountry && phoneLocal
      ? `+${phoneCountry.dial}${phoneLocal.replace(/[^0-9]/g, '')}`
      : phoneLocal || null;

  const partySize = Number.isFinite(payload.party_size)
    ? Math.max(1, Math.min(2, Math.round(Number(payload.party_size))))
    : 1;

  const { entry, created } = await joinWaitlist(env.DB, {
    product_id: product.id,
    tier_id: tierId,
    first_name: firstName,
    last_name: lastName || null,
    email,
    phone: phoneE164,
    phone_country: phoneCountry ? phoneCountryCode : null,
    country: countryCode && findCountry(countryCode) ? countryCode : null,
    party_size: partySize,
    notes: payload.notes?.trim() || null,
    source: 'public',
  });

  const position = await queuePosition(env.DB, entry);

  await logEventSafe(env.DB, {
    registration_id: null,
    kind: created ? 'waitlist.joined' : 'waitlist.rejoined',
    source: 'system',
    payload: {
      waitlist_id: entry.id,
      product_slug: product.slug,
      tier_slug: tierSlug || null,
      position,
    },
  });

  // Confirmation is best-effort: being on the list is what matters, and the
  // row is already written. A failed send is logged, never surfaced.
  if (env.RESEND_API_KEY) {
    const mail = buildWaitlistJoinedEmail({
      first_name: entry.first_name || null,
      retreat_name: product.name,
      when_label: dateRangeLabel(product.starts_at, product.ends_at),
      tier_name: tierName,
      position,
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
    if (!sent.ok) {
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'waitlist.joined.email_error',
        payload: { waitlist_id: entry.id, error: sent.error },
      });
    }
  }

  return json({ ok: true, created, position });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
