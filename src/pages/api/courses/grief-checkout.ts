// Checkout endpoint for The Grief Course — a flat €99 / $99 thematic course.
//
// Deliberately simpler than the certification-course checkout:
//   - one product, one price, full payment only (no installments / subscription)
//   - no phone (the grief form collects first/last name, country, email, and
//     optional company + VAT only)
//   - B2C by default; an EU/UK VAT number (only ever shown once a company name
//     is entered) is attached to the Stripe Customer as tax_id_data so the
//     Quaderno–Stripe sync issues a reverse-charge invoice.
//   - URL-driven discount (`?discount=N`, 1–99) — identical semantics to the
//     cert course: whoever holds the URL controls the price; the server
//     re-validates the range.
//
// Tax: every line item carries product_metadata.tax_class = 'eservice', so
// Quaderno applies destination-VAT rules for digital services. Invoicing is
// done by Quaderno's own Stripe integration — we never call Quaderno here.
//
// Every failure returns JSON (never an HTML 500) so the front-end can render
// the real error instead of the generic network fallback.

import type { APIRoute } from 'astro';
import {
  createPendingCourseRegistration,
  attachStripeSessionToCourse,
} from '../../../lib/courses/db';
import { logEvent } from '../../../lib/registrations/db';
import {
  createCheckoutSession,
  createCustomer,
  paypalEnabled,
  stripeTaxIdTypeFor,
} from '../../../lib/registrations/stripe';
import { findCountry } from '../../../lib/countries';
import {
  griefOffer,
  griefCurrencyForCountry,
  type GriefCurrency,
} from '../../../lib/courses/grief';

export const prerender = false;

type Body = {
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string; // ISO-2
  company_name?: string;
  vat_number?: string;
  currency?: string;
  consent_terms?: boolean;
  discount_percent?: number | string;
};

function parseDiscountPercent(raw: unknown): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? parseInt(raw, 10)
        : NaN;
  if (Number.isInteger(n) && n >= 1 && n <= 99) return n;
  return 0;
}

function applyDiscount(cents: number, pct: number): number {
  if (pct <= 0) return cents;
  return Math.round((cents * (100 - pct)) / 100);
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  try {
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
    const companyName = (payload.company_name ?? '').trim() || null;
    const vatNumberRaw = (payload.vat_number ?? '').trim().replace(/\s+/g, '');
    const vatNumber = vatNumberRaw ? vatNumberRaw.toUpperCase() : null;
    const discountPct = parseDiscountPercent(payload.discount_percent);

    if (!firstName || !lastName || !email) {
      return json(
        { error: 'First name, last name and email are required.' },
        400,
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Please enter a valid email address.' }, 400);
    }
    if (!countryCode || !findCountry(countryCode)) {
      return json({ error: 'Please select your country from the list.' }, 400);
    }
    if (!payload.consent_terms) {
      return json({ error: 'Please agree to the terms to continue.' }, 400);
    }
    if (vatNumber && !companyName) {
      return json(
        { error: 'Please add your company name to use a VAT number.' },
        400,
      );
    }
    if (vatNumber && !/^[A-Z]{2}[A-Z0-9]{6,14}$/.test(vatNumber)) {
      return json(
        {
          error:
            'That VAT number does not look right. It should start with the two-letter country code (e.g. BE0123456789).',
        },
        400,
      );
    }

    // The buyer's country decides the currency (US → USD, else EUR). We
    // trust the country, not the client-sent currency, so the headline
    // price and the charged price always agree.
    const currency: GriefCurrency = griefCurrencyForCountry(countryCode);
    const offer = griefOffer(currency);
    const chargedPriceCents = applyDiscount(offer.price_cents, discountPct);

    const registrationId = await createPendingCourseRegistration(env.DB, {
      email,
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      phone: null,
      phone_country: null,
      company_name: companyName,
      vat_number: vatNumber,
      product_slug: 'grief-course',
      activate_choice: null,
      source_variant: 'direct',
      amount_cents: chargedPriceCents,
      currency,
      consent_terms: payload.consent_terms === true,
      payment_plan: 'full',
      installments_total: 1,
    });

    const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');

    // Pre-create the Stripe Customer so name/email/country pre-fill on the
    // Checkout page, and so a B2B VAT number can be attached server-side as
    // tax_id_data (read by the Quaderno–Stripe sync for reverse-charge).
    let customerId: string | undefined;
    const taxIdType = vatNumber
      ? stripeTaxIdTypeFor(vatNumber.slice(0, 2))
      : null;
    try {
      const cust = await createCustomer({
        secretKey: env.STRIPE_SECRET_KEY,
        email,
        name: companyName
          ? `${companyName} (${firstName} ${lastName})`
          : `${firstName} ${lastName}`,
        country: countryCode,
        description: companyName
          ? `${companyName} · ${firstName} ${lastName} · grief course reg ${registrationId}`
          : `${firstName} ${lastName} · grief course reg ${registrationId}`,
        tax_id:
          vatNumber && taxIdType
            ? { type: taxIdType, value: vatNumber }
            : undefined,
        metadata: {
          course_registration_id: String(registrationId),
          contact_first_name: firstName,
          contact_last_name: lastName,
          product_slug: 'grief-course',
          payment_plan: 'full',
          tax_class: 'eservice',
          ...(companyName ? { company_name: companyName } : {}),
          ...(vatNumber ? { vat_number: vatNumber } : {}),
        },
      });
      customerId = cust.id;
    } catch (err) {
      // The customer is nice-to-have for a one-off payment but not required —
      // we can fall back to customer_email. Log and continue.
      await logEvent(env.DB, {
        registration_id: null,
        kind: 'stripe.customer.error',
        source: 'system',
        payload: {
          course_registration_id: registrationId,
          error: String(err),
        },
      });
    }

    const metadata: Record<string, string> = {
      course_registration_id: String(registrationId),
      product_slug: 'grief-course',
      source_variant: 'direct',
      payment_plan: 'full',
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      currency,
      tax_class: 'eservice',
      ...(companyName ? { company_name: companyName } : {}),
      ...(vatNumber ? { vat_number: vatNumber } : {}),
      ...(discountPct > 0
        ? {
            discount_percent: String(discountPct),
            original_amount_cents: String(offer.price_cents),
          }
        : {}),
    };

    const cancelQuery = discountPct > 0 ? `?discount=${discountPct}` : '';
    const successUrl = `${baseUrl}/courses/grief/thanks?session_id={CHECKOUT_SESSION_ID}`;

    const productMetadata: Record<string, string> = {
      tax_class: 'eservice',
      product_slug: 'grief-course',
    };

    const session = await createCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      enablePaypal: paypalEnabled(env),
      ...(customerId ? { customer: customerId } : { customer_email: email }),
      success_url: successUrl,
      cancel_url: `${baseUrl}/courses/grief${cancelQuery}#register`,
      payment_intent_description: offer.label,
      line_items: [
        {
          name: offer.label,
          description: companyName
            ? `${offer.label} · Billed to ${companyName}`
            : undefined,
          amount_cents: chargedPriceCents,
          currency: currency.toLowerCase(),
          quantity: 1,
          product_metadata: productMetadata,
        },
      ],
      metadata,
      idempotency_key: `grief-reg-${registrationId}${discountPct > 0 ? `-d${discountPct}` : ''}`,
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
        product_slug: 'grief-course',
        currency,
        amount_cents: chargedPriceCents,
        company_name: companyName,
        vat_number: vatNumber,
        discount_percent: discountPct,
        original_amount_cents: offer.price_cents,
      },
    });

    return json({
      checkout_url: session.url,
      course_registration_id: registrationId,
    });
  } catch (err) {
    try {
      await locals.runtime.env.DB.prepare(
        `INSERT INTO events (registration_id, kind, source, payload_json)
         VALUES (NULL, 'course.checkout.error', 'system', ?)`,
      )
        .bind(JSON.stringify({ error: String(err), product: 'grief-course' }))
        .run();
    } catch {}
    const message = String(err).replace(/^Error:\s*/, '');
    return json({ error: `Could not start checkout: ${message}` }, 500);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
