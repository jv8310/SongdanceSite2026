// Course-checkout endpoint. Slimmer than the retreat checkout:
//   - no rooms / no tiers / no inventory
//   - no B2B (digital course, B2C only — collect VAT via Stripe Tax if needed
//     later, currently we just bill the headline price)
//
// Inputs come from the variant block on /certification-course. The variant
// itself is recorded on the row so we can audit later why a person was
// offered the bundle vs. cert-only.

import type { APIRoute } from 'astro';
import {
  createPendingCourseRegistration,
  attachStripeSessionToCourse,
  type ActivateChoice,
  type CourseProductSlug,
} from '../../../lib/courses/db';
import { logEvent } from '../../../lib/registrations/db';
import { createCheckoutSession, createCustomer } from '../../../lib/registrations/stripe';
import { findCountry } from '../../../lib/countries';
import {
  BUNDLE_OFFER,
  CERT_OFFER,
  type Variant,
} from '../../../lib/courses/variant';

export const prerender = false;

type Body = {
  product_slug?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string;       // ISO-2
  phone_country?: string; // ISO-2
  phone?: string;
  activate_choice?: string;
  source_variant?: string;
  consent_terms?: boolean;
};

const COURSE_OFFERS: Record<CourseProductSlug, typeof CERT_OFFER> = {
  'cc-cert': CERT_OFFER,
  'cc-bundle': BUNDLE_OFFER,
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const productSlug = (payload.product_slug ?? '').trim() as CourseProductSlug;
  const firstName = (payload.first_name ?? '').trim();
  const lastName = (payload.last_name ?? '').trim();
  const email = (payload.email ?? '').trim().toLowerCase();
  const countryCode = (payload.country ?? '').trim().toUpperCase();
  const phoneCountryCode = (payload.phone_country ?? '').trim().toUpperCase();
  const phoneLocal = (payload.phone ?? '').trim();

  if (productSlug !== 'cc-cert' && productSlug !== 'cc-bundle') {
    return json({ error: 'Unknown product.' }, 400);
  }
  if (!firstName || !lastName || !email) {
    return json(
      { error: 'first_name, last_name and email are required.' },
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
  if (!payload.consent_terms) {
    return json({ error: 'Please confirm the terms to continue.' }, 400);
  }

  const activateChoice: ActivateChoice | null =
    payload.activate_choice === 'now' || payload.activate_choice === 'wait'
      ? payload.activate_choice
      : null;

  const sourceVariant = isVariant(payload.source_variant)
    ? payload.source_variant
    : 'direct';

  const offer = COURSE_OFFERS[productSlug];

  const phoneCountry = findCountry(phoneCountryCode);
  const phoneE164 = phoneCountry
    ? `+${phoneCountry.dial}${phoneLocal.replace(/[^0-9]/g, '')}`
    : phoneLocal;

  const registrationId = await createPendingCourseRegistration(env.DB, {
    email,
    first_name: firstName,
    last_name: lastName,
    country: countryCode,
    phone: phoneE164,
    phone_country: phoneCountryCode,
    product_slug: productSlug,
    activate_choice: activateChoice,
    source_variant: sourceVariant,
    amount_cents: offer.price_cents,
    currency: 'EUR',
    consent_terms: payload.consent_terms === true,
  });

  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');

  // Pre-create the Stripe Customer so the email/name/country pre-fill on
  // the checkout page and Stripe can filter payment methods by country.
  // No tax_id for course purchases — this is B2C digital.
  let customerId: string | undefined;
  try {
    const cust = await createCustomer({
      secretKey: env.STRIPE_SECRET_KEY,
      email,
      name: `${firstName} ${lastName}`,
      phone: phoneE164,
      country: countryCode,
      description: `${firstName} ${lastName} · course reg ${registrationId}`,
      metadata: {
        course_registration_id: String(registrationId),
        contact_first_name: firstName,
        contact_last_name: lastName,
        product_slug: productSlug,
      },
    });
    customerId = cust.id;
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'stripe.customer.error',
      source: 'system',
      payload: { course_registration_id: registrationId, error: String(err) },
    });
  }

  const lineItemName = offer.label;

  const session = await createCheckoutSession({
    secretKey: env.STRIPE_SECRET_KEY,
    ...(customerId ? { customer: customerId } : { customer_email: email }),
    success_url: `${baseUrl}/certification-course?paid={CHECKOUT_SESSION_ID}#register`,
    cancel_url: `${baseUrl}/certification-course#register`,
    payment_intent_description: lineItemName,
    line_items: [
      {
        name: lineItemName,
        amount_cents: offer.price_cents,
        currency: 'eur',
        quantity: 1,
      },
    ],
    metadata: {
      course_registration_id: String(registrationId),
      product_slug: productSlug,
      activate_choice: activateChoice ?? '',
      source_variant: sourceVariant,
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      phone: phoneE164,
    },
    idempotency_key: `course-reg-${registrationId}`,
  });

  await attachStripeSessionToCourse(env.DB, registrationId, session.id);

  await logEvent(env.DB, {
    registration_id: null,
    kind: 'course.checkout.session.created',
    source: 'system',
    external_id: `local-course-${registrationId}`,
    payload: {
      course_registration_id: registrationId,
      session_id: session.id,
      product_slug: productSlug,
      amount_cents: offer.price_cents,
      activate_choice: activateChoice,
      source_variant: sourceVariant,
    },
  });

  return json({
    checkout_url: session.url,
    course_registration_id: registrationId,
  });
};

function isVariant(v: unknown): v is Variant {
  return v === 'B1' || v === 'B2' || v === 'A' || v === 'D' || v === 'E' || v === 'C';
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
