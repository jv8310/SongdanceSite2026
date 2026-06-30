// Checkout endpoint for the Three Journeys (Authentic Singing, Magical
// Movement, Inner Child) + the PRO mantra upgrade + the all-three bundle.
//
// Same shape as the Grief checkout (../grief-checkout.ts): one product, one
// price, full payment only; B2C by default with optional company + EU/UK VAT
// (attached to the Stripe Customer as tax_id_data for Quaderno reverse-charge);
// URL-driven `?discount=N` honoured server-side. The product is chosen from a
// fixed allowlist — the buyer's country decides the currency, so the headline
// and the charge always agree. Drip tagging happens later in the shared course
// paid-handler, keyed on the product slug stored here.

import type { APIRoute } from 'astro';
import {
  createPendingCourseRegistration,
  attachStripeSessionToCourse,
  attachPaypalOrderToCourse,
} from '../../../lib/courses/db';
import { edgeTimezone } from '../../../lib/geo';
import { logEvent } from '../../../lib/registrations/db';
import {
  createCheckoutSession,
  createCustomer,
  paypalEnabled,
  stripeTaxIdTypeFor,
} from '../../../lib/registrations/stripe';
import {
  paypalConfigured,
  createOrder as createPaypalOrder,
} from '../../../lib/payments/paypal';
import { encodeCustomId, parseProvider } from '../../../lib/payments/provider';
import { findCountry } from '../../../lib/countries';
import {
  hasDutchEdition,
  isJourneyLanguageChoice,
  isJourneySlug,
  journeyCurrencyForCountry,
  journeyOffer,
  type JourneyCurrency,
  type JourneyLanguageChoice,
  type JourneySlug,
} from '../../../lib/courses/journeys';
import { withLaunchPromo } from '../../../lib/promo';
import {
  resolveCourseDiscountPercent,
  isFreeCourseCheckout,
} from '../../../lib/courses/discount';
import { fulfilFreeCourseRegistration } from '../../../lib/courses/free-checkout';

export const prerender = false;

type Body = {
  product?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string; // ISO-2
  company_name?: string;
  vat_number?: string;
  consent_terms?: boolean;
  discount_percent?: number | string;
  adiscount_percent?: number | string;
  provider?: string; // 'stripe' (default) | 'paypal'
  language_choice?: string; // ASJ component: 'nl' | 'en' | 'both'
};

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

    const product = (payload.product ?? '').trim();
    if (!isJourneySlug(product)) {
      return json({ error: 'Unknown product.' }, 400);
    }
    const slug: JourneySlug = product;

    const firstName = (payload.first_name ?? '').trim();
    const lastName = (payload.last_name ?? '').trim();
    const email = (payload.email ?? '').trim().toLowerCase();
    const countryCode = (payload.country ?? '').trim().toUpperCase();
    const companyName = (payload.company_name ?? '').trim() || null;
    const vatNumberRaw = (payload.vat_number ?? '').trim().replace(/\s+/g, '');
    const vatNumber = vatNumberRaw ? vatNumberRaw.toUpperCase() : null;
    // Language edition — only meaningful for products containing the Authentic
    // Singing Journey (asj, asj-pro, and the two bundles). Any other product, or
    // an unknown value, falls back to null = the English default. The buyer's
    // country/browser decides whether the choice is shown; the server simply
    // records what was sent.
    const langRaw = (payload.language_choice ?? '').toString().trim().toLowerCase();
    const languageChoice: JourneyLanguageChoice | null =
      hasDutchEdition(slug) && isJourneyLanguageChoice(langRaw) ? langRaw : null;
    // ?discount=N (public, 1–99) or the owner's secret ?adiscount=N (1–100).
    // The secret param is the only route to 100% — a free checkout.
    const discountPct = resolveCourseDiscountPercent({
      discount: payload.discount_percent,
      adiscount: payload.adiscount_percent,
    });
    const provider = parseProvider(payload.provider);
    if (provider === 'paypal' && !paypalConfigured(env)) {
      return json({ error: 'PayPal is not available right now. Please pay by card.' }, 400);
    }

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

    const currency: JourneyCurrency = journeyCurrencyForCountry(countryCode);
    const offer = journeyOffer(slug, currency);

    // Free checkout (secret ?adiscount=100): nothing to charge, so fulfil the
    // registration directly instead of opening Stripe. Same paid-side effects
    // (Drip access + SD-ORDER) run inside the helper.
    if (
      isFreeCourseCheckout({
        discount: payload.discount_percent,
        adiscount: payload.adiscount_percent,
      })
    ) {
      const result = await fulfilFreeCourseRegistration(
        env,
        {
          email,
          first_name: firstName,
          last_name: lastName,
          country: countryCode,
          phone: null,
          phone_country: null,
          company_name: companyName,
          vat_number: vatNumber,
          product_slug: slug,
          activate_choice: null,
          language_choice: languageChoice,
          source_variant: 'free-comp',
          timezone: edgeTimezone(locals),
          amount_cents: 0,
          currency,
          consent_terms: payload.consent_terms === true,
          payment_plan: 'full',
          installments_total: 1,
        },
        {
          thanksPath: '/courses/journeys/thanks',
          originalAmountCents: offer.price_cents,
        },
      );
      return json(result);
    }

    // Launch promo: 50% off, the better of the promo and any ?discount=N. For
    // the bundle, offer.price_cents is already 20% off the sum, so this lands
    // the 50% promo on top of the bundle discount.
    const effectivePct = withLaunchPromo(discountPct);
    const chargedPriceCents = applyDiscount(offer.price_cents, effectivePct);

    const registrationId = await createPendingCourseRegistration(env.DB, {
      email,
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      phone: null,
      phone_country: null,
      company_name: companyName,
      vat_number: vatNumber,
      product_slug: slug,
      activate_choice: null,
      language_choice: languageChoice,
      source_variant: 'direct',
      timezone: edgeTimezone(locals),
      amount_cents: chargedPriceCents,
      currency,
      consent_terms: payload.consent_terms === true,
      payment_plan: 'full',
      installments_total: 1,
      provider,
    });

    const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');

    // Cancel back to the page the product belongs to.
    const cancelPath =
      slug === 'mmj'
        ? '/courses/magical-movement'
        : slug === 'inner-child'
          ? '/courses/inner-child'
          : '/courses/authentic-singing';
    const cancelQuery = discountPct > 0 ? `?discount=${discountPct}` : '';

    // ── PayPal branch (one-off). Same line item label as Stripe so PayPal's
    //    Quaderno connector builds the invoice with the right name.
    if (provider === 'paypal') {
      const order = await createPaypalOrder({
        env,
        currency,
        items: [
          {
            name: offer.label,
            description: companyName ? `Billed to ${companyName}` : undefined,
            amountMinor: chargedPriceCents,
            category: 'DIGITAL_GOODS',
          },
        ],
        customId: encodeCustomId('course', registrationId),
        description: offer.label,
        softDescriptor: 'SONGDANCE',
        invoiceId: `journey-${slug}-${registrationId}`,
        returnUrl: `${baseUrl}/api/payments/paypal-return?dest=${encodeURIComponent('/courses/journeys/thanks')}`,
        cancelUrl: `${baseUrl}${cancelPath}${cancelQuery}#register`,
        brandName: 'Songdance',
        payer: { email, firstName, lastName, countryCode },
        requestId: `journey-${slug}-reg-${registrationId}-pp`,
      });
      await attachPaypalOrderToCourse(env.DB, registrationId, order.id);
      await logEvent(env.DB, {
        registration_id: null,
        kind: 'course.checkout.paypal.order.created',
        source: 'system',
        external_id: `local-course-pp-${registrationId}`,
        payload: {
          course_registration_id: registrationId,
          order_id: order.id,
          product_slug: slug,
          currency,
          amount_cents: chargedPriceCents,
        },
      });
      return json({ checkout_url: order.approveUrl, course_registration_id: registrationId });
    }

    // Pre-create the Stripe Customer so name/email/country pre-fill, and so a
    // B2B VAT number can be attached as tax_id_data for reverse-charge.
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
          ? `${companyName} · ${firstName} ${lastName} · ${slug} reg ${registrationId}`
          : `${firstName} ${lastName} · ${slug} reg ${registrationId}`,
        tax_id:
          vatNumber && taxIdType
            ? { type: taxIdType, value: vatNumber }
            : undefined,
        metadata: {
          course_registration_id: String(registrationId),
          contact_first_name: firstName,
          contact_last_name: lastName,
          product_slug: slug,
          payment_plan: 'full',
          tax_class: 'eservice',
          ...(companyName ? { company_name: companyName } : {}),
          ...(vatNumber ? { vat_number: vatNumber } : {}),
        },
      });
      customerId = cust.id;
    } catch (err) {
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
      product_slug: slug,
      source_variant: 'direct',
      payment_plan: 'full',
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      currency,
      tax_class: 'eservice',
      ...(companyName ? { company_name: companyName } : {}),
      ...(vatNumber ? { vat_number: vatNumber } : {}),
      ...(languageChoice ? { language_choice: languageChoice } : {}),
      ...(effectivePct > 0
        ? {
            discount_percent: String(effectivePct),
            original_amount_cents: String(offer.price_cents),
          }
        : {}),
    };

    const successUrl = `${baseUrl}/courses/journeys/thanks?session_id={CHECKOUT_SESSION_ID}`;

    const productMetadata: Record<string, string> = {
      tax_class: 'eservice',
      product_slug: slug,
    };

    const session = await createCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      enablePaypal: paypalEnabled(env),
      ...(customerId ? { customer: customerId } : { customer_email: email }),
      success_url: successUrl,
      cancel_url: `${baseUrl}${cancelPath}${cancelQuery}#register`,
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
      idempotency_key: `journey-${slug}-reg-${registrationId}${discountPct > 0 ? `-d${discountPct}` : ''}`,
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
        product_slug: slug,
        currency,
        amount_cents: chargedPriceCents,
        company_name: companyName,
        vat_number: vatNumber,
        discount_percent: effectivePct,
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
        .bind(JSON.stringify({ error: String(err), product: 'journey' }))
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
