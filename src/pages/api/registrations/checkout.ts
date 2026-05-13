import type { APIRoute } from 'astro';
import {
  getProductBySlug,
  getTierBySlug,
  createPendingRegistration,
  attachStripeSession,
  logEvent,
  pickRoomForTier,
} from '../../../lib/registrations/db';
import {
  createCheckoutSession,
  createCustomer,
  stripeTaxIdTypeFor,
} from '../../../lib/registrations/stripe';
import { findCountry } from '../../../lib/countries';

export const prerender = false;

const HOLD_MINUTES = 30;

type Body = {
  product_slug?: string;
  tier_slug?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string;          // ISO-2
  phone_country?: string;    // ISO-2
  phone?: string;            // local number, no dial prefix
  company_name?: string;
  vat_number?: string;
  address?: string;
  dietary?: string;
  notes?: string;
  consent_framework?: boolean;
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

  const productSlug = (payload.product_slug ?? '').trim();
  const tierSlug = (payload.tier_slug ?? '').trim();
  const firstName = (payload.first_name ?? '').trim();
  const lastName = (payload.last_name ?? '').trim();
  const email = (payload.email ?? '').trim().toLowerCase();
  const countryCode = (payload.country ?? '').trim().toUpperCase();
  const phoneCountryCode = (payload.phone_country ?? '').trim().toUpperCase();
  const phoneLocal = (payload.phone ?? '').trim();
  const companyName = (payload.company_name ?? '').trim();
  const vatNumber = (payload.vat_number ?? '').trim();
  const address = (payload.address ?? '').trim();

  if (!productSlug || !tierSlug || !firstName || !lastName || !email) {
    return json(
      { error: 'first_name, last_name, email, product_slug and tier_slug are required' },
      400,
    );
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
  // Company is optional; when provided, VAT and address become required.
  if (companyName && (!vatNumber || !address)) {
    return json(
      { error: 'When registering on behalf of a company, please add VAT number and billing address.' },
      400,
    );
  }
  if (!payload.consent_framework || !payload.consent_terms) {
    return json(
      { error: 'Please confirm both agreements to continue.' },
      400,
    );
  }

  const product = await getProductBySlug(env.DB, productSlug);
  if (!product) return json({ error: 'Unknown product' }, 404);

  const tier = await getTierBySlug(env.DB, product.id, tierSlug);
  if (!tier) return json({ error: 'Unknown tier' }, 404);

  // Pick the room before recording the registration. This uses the
  // smart "preserve solo, fill shared rooms first" algorithm in
  // pickRoomForTier — see db.ts for the priority ladder.
  const room = await pickRoomForTier(env.DB, product.id, tierSlug);
  if (!room) {
    return json(
      { error: 'This room option is fully booked. Please choose another, or email info@songdance.co to join the waitlist.' },
      409,
    );
  }

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
    address: address || null,
    dietary: payload.dietary?.trim() || null,
    notes: payload.notes?.trim() || null,
    consent_framework: payload.consent_framework === true,
    consent_terms: payload.consent_terms === true,
    amount_cents: tier.price_cents,
    currency: product.currency,
    hold_minutes: HOLD_MINUTES,
  });

  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');

  // Always pre-create a Stripe Customer with everything we already know so
  // Stripe Checkout pre-fills email, name and country (and for B2B also
  // attaches the VAT number as a tax_id). The Quaderno-Stripe integration
  // reads these fields off the customer to produce the right invoice.
  //
  // Tax note: this retreat is a physical event in Belgium, so under EU VAT
  // Directive Art. 53 the place-of-supply is Belgium for both B2C and B2B
  // (no reverse-charge for event tickets). All prices are gross-inclusive
  // of 21% Belgian VAT regardless of the buyer's country — Quaderno is
  // configured to apply that rate when it generates the invoice.
  let customerId: string | undefined;
  const taxIdType = vatNumber ? stripeTaxIdTypeFor(countryCode) : null;
  try {
    // For B2B, the billing name should be the company; for B2C it's the
    // person. Either way, country is set so Checkout filters payment
    // methods (Bancontact for BE, iDEAL for NL, etc.) without the buyer
    // needing to pick a country first.
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
    // Don't block the registration on customer creation — log and fall
    // back to customer_email. The VAT (if any) is still in our D1 row.
    await logEvent(env.DB, {
      registration_id: registrationId,
      kind: 'stripe.customer.error',
      payload: { error: String(err) },
    });
  }

  const session = await createCheckoutSession({
    secretKey: env.STRIPE_SECRET_KEY,
    ...(customerId
      ? { customer: customerId }
      : { customer_email: email }),
    success_url: `${baseUrl}/registrations/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/ritual-of-belonging#register`,
    line_items: [
      {
        name: `${product.name} — ${tier.name}`,
        description: tier.description ?? undefined,
        amount_cents: tier.price_cents,
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
