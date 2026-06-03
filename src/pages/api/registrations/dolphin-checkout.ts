import type { APIRoute } from 'astro';
import {
  getProductBySlug,
  getTierBySlug,
  getTierAvailability,
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

// The Dolphin & Sound Retreat sells a single option — a twin cabin, all-in.
// Unlike the château retreat there is no room model: availability is a plain
// count against the tier capacity, and registrations carry no inventory unit.
const PRODUCT_SLUG = 'dolphin-and-sound-2026';
const TIER_SLUG = 'twin-cabin';
const HOLD_MINUTES = 30;

// You may reserve your place with a 50% deposit and settle the balance before
// 1 September 2026 (mirrors the long-running deposit option on the old site).
const DEPOSIT_FRACTION = 0.5;
const BALANCE_DUE = 'before 1 September 2026';

// GET → live availability for the registration form's "X places left" badge.
export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime.env;
  const product = await getProductBySlug(env.DB, PRODUCT_SLUG);
  if (!product) return json({ error: 'Unknown product' }, 404);
  const tier = await getTierBySlug(env.DB, product.id, TIER_SLUG);
  if (!tier) return json({ error: 'Unknown tier' }, 404);

  const avail = await getTierAvailability(env.DB, tier.id);
  return json({
    price_cents: tier.price_cents,
    deposit_cents: Math.round(tier.price_cents * DEPOSIT_FRACTION),
    capacity: avail.capacity,
    remaining: avail.remaining,
  });
};

type Body = {
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string; // ISO-2
  phone_country?: string; // ISO-2
  phone?: string; // local number, no dial prefix
  company_name?: string;
  vat_number?: string;
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

  const firstName = (payload.first_name ?? '').trim();
  const lastName = (payload.last_name ?? '').trim();
  const email = (payload.email ?? '').trim().toLowerCase();
  const countryCode = (payload.country ?? '').trim().toUpperCase();
  const phoneCountryCode = (payload.phone_country ?? '').trim().toUpperCase();
  const phoneLocal = (payload.phone ?? '').trim();
  const companyName = (payload.company_name ?? '').trim();
  const vatNumber = (payload.vat_number ?? '').trim();
  const isDeposit = payload.payment_mode === 'deposit';

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
  if (companyName && !vatNumber) {
    return json(
      { error: 'When registering on behalf of a company, please add the VAT number.' },
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

  const tier = await getTierBySlug(env.DB, product.id, TIER_SLUG);
  if (!tier) {
    return json(
      { error: 'This retreat isn\'t available right now. Please refresh, or email info@songdance.co.' },
      404,
    );
  }

  // Capacity guard — a plain count against the tier capacity.
  const avail = await getTierAvailability(env.DB, tier.id);
  if (avail.remaining <= 0) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'checkout.tier.full',
      payload: { tier_slug: TIER_SLUG },
    });
    return json(
      { error: 'The retreat is fully booked. Email info@songdance.co to join the waiting list.' },
      409,
    );
  }

  // Deposit = 50% now, balance settled before 1 September 2026. The balance is
  // tracked in the registration note + audit log (collected separately), the
  // same way the old site's "deposit" coupon worked.
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
    inventory_unit_id: null,
    first_name: firstName,
    last_name: lastName,
    email,
    phone: phoneE164,
    phone_country: phoneCountryCode,
    country: countryCode,
    company_name: companyName || null,
    vat_number: vatNumber || null,
    address: null,
    dietary: payload.dietary?.trim() || null,
    notes: combinedNotes,
    consent_framework: true,
    consent_terms: payload.consent_terms === true,
    amount_cents: amountCents,
    currency: product.currency,
    hold_minutes: HOLD_MINUTES,
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
