import type { APIRoute } from 'astro';
import {
  getProductBySlug,
  getTierBySlug,
  computeTierAvailability,
  pickRoomForTier,
  createPendingRegistration,
  attachStripeSession,
  logEvent,
} from '../../../lib/registrations/db';
import {
  createCheckoutSession,
  createCustomer,
  stripeTaxIdTypeFor,
} from '../../../lib/registrations/stripe';
import { findCountry } from '../../../lib/countries';

export const prerender = false;

// The Dolphin & Sound Retreat offers three cabin types, each its own tier:
//   twin-lower   — twin cabin, lower deck (porthole)     · €1995 per person
//   twin-upper   — twin cabin, upper deck (sea views)    · €2495 per person
//   double-lower — double-bed cabin, lower deck          · €3990 for two
// Availability is driven by the smart room model (see migration 0025): twin
// cabins are sold bed-by-bed; the double cabin is sold as a whole unit. A
// fourth, non-public "single-lower" tier exists only for record-keeping.
const PRODUCT_SLUG = 'dolphin-and-sound-2026';
const PUBLIC_TIER_SLUGS = ['twin-lower', 'twin-upper', 'double-lower'] as const;
type PublicTierSlug = (typeof PUBLIC_TIER_SLUGS)[number];
const HOLD_MINUTES = 30;

// You may reserve your place with a 50% deposit and settle the balance before
// 1 September 2026 (mirrors the long-running deposit option on the old site).
const DEPOSIT_FRACTION = 0.5;
const BALANCE_DUE = 'before 1 September 2026';

// The double cabin is priced for two people sharing; everything else is
// per person. Used only for the human-readable label on the form.
function unitLabel(slug: string): string {
  return slug === 'double-lower' ? 'for two people' : 'per person';
}

// GET → per-cabin prices + live availability for the registration form.
export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime.env;
  const product = await getProductBySlug(env.DB, PRODUCT_SLUG);
  if (!product) return json({ error: 'Unknown product' }, 404);

  const availability = await computeTierAvailability(env.DB, product.id);
  const bySlug = new Map(availability.map((a) => [a.tier.slug, a]));

  const tiers = PUBLIC_TIER_SLUGS.map((slug) => {
    const a = bySlug.get(slug);
    if (!a) return null;
    const price = a.tier.price_cents;
    return {
      slug,
      name: a.tier.name,
      price_cents: price,
      deposit_cents: Math.round(price * DEPOSIT_FRACTION),
      remaining: a.remaining,
      capacity: a.capacity,
      sold_out: a.remaining <= 0,
      unit_label: unitLabel(slug),
    };
  }).filter((t): t is NonNullable<typeof t> => t !== null);

  const totalRemaining = tiers.reduce((n, t) => n + Math.max(0, t.remaining), 0);

  return new Response(
    JSON.stringify({ tiers, total_remaining: totalRemaining, balance_due: BALANCE_DUE }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
};

type Body = {
  tier_slug?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string; // ISO-2
  phone_country?: string; // ISO-2
  phone?: string; // local number, no dial prefix
  company_name?: string;
  vat_number?: string;
  roommate_pref?: string;
  dietary?: string;
  notes?: string;
  payment_mode?: 'full' | 'deposit';
  consent_terms?: boolean;
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const tierSlug = (payload.tier_slug ?? '').trim() as PublicTierSlug;
  const firstName = (payload.first_name ?? '').trim();
  const lastName = (payload.last_name ?? '').trim();
  const email = (payload.email ?? '').trim().toLowerCase();
  const countryCode = (payload.country ?? '').trim().toUpperCase();
  const phoneCountryCode = (payload.phone_country ?? '').trim().toUpperCase();
  const phoneLocal = (payload.phone ?? '').trim();
  const companyName = (payload.company_name ?? '').trim();
  const vatNumber = (payload.vat_number ?? '').trim();
  const isDeposit = payload.payment_mode === 'deposit';

  if (!PUBLIC_TIER_SLUGS.includes(tierSlug)) {
    return json({ error: 'Please choose a cabin.' }, 400);
  }
  if (!firstName || !lastName || !email) {
    return json({ error: 'Please fill in your first name, last name and email.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400);
  }
  if (!countryCode || !findCountry(countryCode)) {
    return json({ error: 'Please select your country.' }, 400);
  }
  if (!phoneCountryCode || !findCountry(phoneCountryCode) || !phoneLocal) {
    return json({ error: 'Please enter a phone number with country code.' }, 400);
  }
  if (vatNumber && !companyName) {
    return json(
      { error: 'Please add your company name to use a VAT number.' },
      400,
    );
  }
  if (!payload.consent_terms) {
    return json({ error: 'Please agree to the terms and conditions to continue.' }, 400);
  }

  const product = await getProductBySlug(env.DB, PRODUCT_SLUG);
  if (!product) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'checkout.product.unknown',
      payload: { product_slug: PRODUCT_SLUG },
    });
    return json(
      { error: 'This retreat isn\'t available right now. Please refresh, or email info@songdance.co.' },
      404,
    );
  }

  const tier = await getTierBySlug(env.DB, product.id, tierSlug);
  if (!tier) {
    return json(
      { error: 'This cabin isn\'t available right now. Please refresh, or email info@songdance.co.' },
      404,
    );
  }

  // Capacity guard — computed from the room model so cross-cabin coupling
  // (a solo-locked double, the reserved host cabin) is respected.
  const availability = await computeTierAvailability(env.DB, product.id);
  const tierAvail = availability.find((a) => a.tier.id === tier.id);
  if (!tierAvail || tierAvail.remaining <= 0) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'checkout.tier.full',
      payload: { tier_slug: tierSlug },
    });
    return json(
      { error: 'That cabin is fully booked. Please choose another, or email info@songdance.co for the waiting list.' },
      409,
    );
  }

  // Auto-assign a specific cabin for this tier.
  const room = await pickRoomForTier(env.DB, product.id, tierSlug);
  if (!room) {
    return json(
      { error: 'That cabin was just taken. Please choose another, or email info@songdance.co.' },
      409,
    );
  }

  // Deposit = 50% now, balance settled before the cut-off. The balance is
  // tracked on the registration (balance_due_cents) so the admin can later
  // send a Stripe link for the remainder.
  const fullCents = tier.price_cents;
  const depositCents = Math.round(fullCents * DEPOSIT_FRACTION);
  const amountCents = isDeposit ? depositCents : fullCents;
  const balanceCents = isDeposit ? fullCents - depositCents : 0;
  const eur = (c: number) => `€${(c / 100).toFixed(2).replace(/\.00$/, '')}`;

  const depositNote = isDeposit
    ? `50% deposit paid (${eur(depositCents)}); balance ${eur(balanceCents)} due ${BALANCE_DUE}.`
    : null;
  const combinedNotes = [payload.notes?.trim() || null, depositNote]
    .filter(Boolean)
    .join(' — ') || null;

  const phoneCountry = findCountry(phoneCountryCode);
  const phoneE164 = phoneCountry
    ? `+${phoneCountry.dial}${phoneLocal.replace(/[^0-9]/g, '')}`
    : phoneLocal;

  const registrationId = await createPendingRegistration(env.DB, {
    product_id: product.id,
    tier_id: tier.id,
    inventory_unit_id: room.id,
    first_name: firstName,
    last_name: lastName,
    email,
    phone: phoneE164,
    phone_country: phoneCountryCode,
    country: countryCode,
    company_name: companyName || null,
    vat_number: vatNumber || null,
    address: null,
    roommate_pref: payload.roommate_pref?.trim() || null,
    dietary: payload.dietary?.trim() || null,
    notes: combinedNotes,
    consent_framework: true,
    consent_terms: payload.consent_terms === true,
    amount_cents: amountCents,
    currency: product.currency,
    hold_minutes: HOLD_MINUTES,
    balance_due_cents: balanceCents,
  });

  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');

  // Pre-create a Stripe Customer so Checkout pre-fills email/name/country
  // (and attaches the VAT number for B2B). Mirrors the château flow.
  let customerId: string | undefined;
  const taxIdType = vatNumber ? stripeTaxIdTypeFor(countryCode) : null;
  try {
    const billingName = companyName || `${firstName} ${lastName}`;
    const cust = await createCustomer({
      secretKey: env.STRIPE_SECRET_KEY,
      email,
      name: billingName,
      phone: phoneE164,
      country: countryCode,
      description: companyName
        ? `${companyName} · ${firstName} ${lastName} · reg ${registrationId}`
        : `${firstName} ${lastName} · reg ${registrationId}`,
      tax_id:
        companyName && vatNumber && taxIdType
          ? { type: taxIdType, value: vatNumber }
          : undefined,
      metadata: {
        registration_id: String(registrationId),
        contact_first_name: firstName,
        contact_last_name: lastName,
        ...(companyName ? { company_name: companyName } : {}),
      },
    });
    customerId = cust.id;
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: registrationId,
      kind: 'stripe.customer.error',
      payload: { error: String(err) },
    });
  }

  const lineItemName = isDeposit
    ? `${product.name} — ${tier.name} (50% deposit, balance ${eur(balanceCents)} due ${BALANCE_DUE})`
    : `${product.name} — ${tier.name}`;

  const session = await createCheckoutSession({
    secretKey: env.STRIPE_SECRET_KEY,
    ...(customerId ? { customer: customerId } : { customer_email: email }),
    success_url: `${baseUrl}/registrations/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/retreats/dolphin-and-sound#register`,
    payment_intent_description: lineItemName,
    line_items: [
      {
        name: lineItemName,
        description: tier.description ?? undefined,
        amount_cents: amountCents,
        currency: product.currency.toLowerCase(),
        quantity: 1,
      },
    ],
    metadata: {
      registration_id: String(registrationId),
      product_slug: product.slug,
      tier_slug: tier.slug,
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      phone: phoneE164,
      company_name: companyName,
      vat_number: vatNumber,
      payment_mode: isDeposit ? 'deposit' : 'full',
      deposit_balance_cents: String(balanceCents),
    },
    idempotency_key: `reg-${registrationId}`,
  });

  await attachStripeSession(env.DB, registrationId, session.id);
  await logEvent(env.DB, {
    registration_id: registrationId,
    kind: 'checkout.session.created',
    external_id: `local-checkout-${registrationId}`,
    payload: {
      session_id: session.id,
      tier: tier.slug,
      auto_assigned_room: room.name,
      auto_assigned_room_id: room.id,
      payment_mode: isDeposit ? 'deposit' : 'full',
      amount_cents: amountCents,
      deposit_balance_cents: balanceCents,
    },
  });

  return json({ checkout_url: session.url, registration_id: registrationId });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
