// Checkout endpoint for The Forgiveness Course — four live sessions in December
// 2026 (src/lib/courses/forgiveness.ts), a flat €147 in the buyer's currency.
//
// The Grief Course's checkout (./grief-checkout.ts), plus the two order bumps
// the 12-week and certification checkouts carry (src/lib/courses/bumps.ts):
//   - one product, one price, full payment only;
//   - B2C by default; a VAT number (only with a company name) rides the Stripe
//     Customer as tax_id_data so Quaderno issues a reverse-charge invoice;
//   - `?discount=N` (1–99) / the owner's `?adiscount=N` (to 100 = free), same
//     semantics as every course checkout — the server re-validates;
//   - the ticked bumps ('asj' | 'grief') are priced here, never discounted,
//     charged as their own line items, and recorded on the row's `bumps` JSON
//     so the paid-handler tags them and the member app opens them.
//
// Registration closes when the last session has ended (forgivenessRegistrationOpen).
// Every failure returns JSON, never an HTML 500.

import type { APIRoute } from 'astro';
import {
  createPendingCourseRegistration,
  attachStripeSessionToCourse,
  attachPaypalOrderToCourse,
} from '../../../lib/courses/db';
import { logEventSafe } from '../../../lib/registrations/db';
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
  FORGIVENESS_PRODUCT_SLUG,
  forgivenessOffer,
  forgivenessCurrencyForCountry,
  forgivenessRegistrationOpen,
  type ForgivenessCurrency,
} from '../../../lib/courses/forgiveness';
import { bumpOffer, isBumpSlug, BUMPS, type BumpSlug } from '../../../lib/courses/bumps';
import { withLaunchPromo } from '../../../lib/promo';
import {
  resolveCourseDiscountPercent,
  isFreeCourseCheckout,
} from '../../../lib/courses/discount';
import { fulfilFreeCourseRegistration } from '../../../lib/courses/free-checkout';
import { edgeTimezone } from '../../../lib/geo';

export const prerender = false;

const PAGE_PATH = '/courses/forgiveness';
const THANKS_PATH = '/courses/forgiveness/thanks';

type Body = {
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
  // Order-bump slugs the buyer ticked ('asj' | 'grief').
  bumps?: string[];
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

    if (!forgivenessRegistrationOpen()) {
      return json(
        { error: 'Registration for the December sessions has closed. Write to support@songdance.co and we will help.' },
        400,
      );
    }

    const firstName = (payload.first_name ?? '').trim();
    const lastName = (payload.last_name ?? '').trim();
    const email = (payload.email ?? '').trim().toLowerCase();
    const countryCode = (payload.country ?? '').trim().toUpperCase();
    const companyName = (payload.company_name ?? '').trim() || null;
    const vatNumberRaw = (payload.vat_number ?? '').trim().replace(/\s+/g, '');
    const vatNumber = vatNumberRaw ? vatNumberRaw.toUpperCase() : null;
    const discountPct = resolveCourseDiscountPercent({
      discount: payload.discount_percent,
      adiscount: payload.adiscount_percent,
    });
    const provider = parseProvider(payload.provider);
    if (provider === 'paypal' && !paypalConfigured(env)) {
      return json({ error: 'PayPal is not available right now. Please pay by card.' }, 400);
    }

    if (!firstName || !lastName || !email) {
      return json({ error: 'First name, last name and email are required.' }, 400);
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
      return json({ error: 'Please add your company name to use a VAT number.' }, 400);
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

    // The buyer's country decides the currency; the client-sent one is never
    // trusted, so the headline price and the charge always agree.
    const currency: ForgivenessCurrency = forgivenessCurrencyForCountry(countryCode);
    const offer = forgivenessOffer(currency);
    const timezone = edgeTimezone(locals);

    // Free checkout (secret ?adiscount=100): nothing to charge, so the row is
    // fulfilled directly. Bumps are not part of a comp.
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
          product_slug: FORGIVENESS_PRODUCT_SLUG,
          activate_choice: null,
          source_variant: 'free-comp',
          timezone,
          amount_cents: 0,
          currency,
          consent_terms: payload.consent_terms === true,
          payment_plan: 'full',
          installments_total: 1,
        },
        { thanksPath: THANKS_PATH, originalAmountCents: offer.price_cents },
      );
      return json(result);
    }

    const effectivePct = withLaunchPromo(discountPct);
    const chargedPriceCents = applyDiscount(offer.price_cents, effectivePct);

    // ── Order bumps ────────────────────────────────────────────────────────
    const selectedBumps: BumpSlug[] = Array.isArray(payload.bumps)
      ? Array.from(new Set(payload.bumps.filter(isBumpSlug)))
      : [];
    const bumpOffers = selectedBumps.map((slug) => bumpOffer(slug, currency));
    const bumpRows = bumpOffers.map((b) => ({ slug: b.slug, amount_cents: b.price_cents }));

    const registrationId = await createPendingCourseRegistration(env.DB, {
      email,
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      phone: null,
      phone_country: null,
      company_name: companyName,
      vat_number: vatNumber,
      product_slug: FORGIVENESS_PRODUCT_SLUG,
      activate_choice: null,
      source_variant: effectivePct > 0 ? `override-${effectivePct}` : 'direct',
      timezone,
      bumps: bumpRows.length ? bumpRows : null,
      amount_cents: chargedPriceCents,
      currency,
      consent_terms: payload.consent_terms === true,
      payment_plan: 'full',
      installments_total: 1,
      provider,
    });

    const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');
    const cancelQuery = discountPct > 0 ? `?discount=${discountPct}` : '';
    const cancelUrl = `${baseUrl}${PAGE_PATH}${cancelQuery}#register`;

    // ── PayPal (one-off) ───────────────────────────────────────────────────
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
          ...bumpOffers.map((b) => ({
            name: BUMPS[b.slug].label,
            amountMinor: b.price_cents,
            category: 'DIGITAL_GOODS' as const,
          })),
        ],
        customId: encodeCustomId('course', registrationId),
        description: offer.label,
        softDescriptor: 'SONGDANCE',
        invoiceId: `forgiveness-${registrationId}`,
        returnUrl: `${baseUrl}/api/payments/paypal-return?dest=${encodeURIComponent(THANKS_PATH)}`,
        cancelUrl,
        brandName: 'Songdance',
        payer: { email, firstName, lastName, countryCode },
        requestId: `forgiveness-reg-${registrationId}-pp`,
      });
      await attachPaypalOrderToCourse(env.DB, registrationId, order.id);
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'course.checkout.paypal.order.created',
        source: 'system',
        external_id: `local-course-pp-${registrationId}`,
        payload: {
          course_registration_id: registrationId,
          order_id: order.id,
          product_slug: FORGIVENESS_PRODUCT_SLUG,
          currency,
          amount_cents: chargedPriceCents,
          bumps: selectedBumps,
        },
      });
      return json({ checkout_url: order.approveUrl, course_registration_id: registrationId });
    }

    // ── Stripe ─────────────────────────────────────────────────────────────
    // Pre-create the Customer so the Checkout page is pre-filled and a B2B VAT
    // number can ride as tax_id_data (read by the Quaderno–Stripe sync).
    let customerId: string | undefined;
    const taxIdType = vatNumber ? stripeTaxIdTypeFor(vatNumber.slice(0, 2)) : null;
    try {
      const cust = await createCustomer({
        secretKey: env.STRIPE_SECRET_KEY,
        email,
        name: companyName ? `${companyName} (${firstName} ${lastName})` : `${firstName} ${lastName}`,
        country: countryCode,
        description: companyName
          ? `${companyName} · ${firstName} ${lastName} · forgiveness course reg ${registrationId}`
          : `${firstName} ${lastName} · forgiveness course reg ${registrationId}`,
        tax_id: vatNumber && taxIdType ? { type: taxIdType, value: vatNumber } : undefined,
        metadata: {
          course_registration_id: String(registrationId),
          contact_first_name: firstName,
          contact_last_name: lastName,
          product_slug: FORGIVENESS_PRODUCT_SLUG,
          payment_plan: 'full',
          tax_class: 'eservice',
          ...(companyName ? { company_name: companyName } : {}),
          ...(vatNumber ? { vat_number: vatNumber } : {}),
        },
      });
      customerId = cust.id;
    } catch (err) {
      // Nice-to-have for a one-off payment: fall back to customer_email.
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'stripe.customer.error',
        source: 'system',
        payload: { course_registration_id: registrationId, error: String(err) },
      });
    }

    const metadata: Record<string, string> = {
      course_registration_id: String(registrationId),
      product_slug: FORGIVENESS_PRODUCT_SLUG,
      source_variant: effectivePct > 0 ? `override-${effectivePct}` : 'direct',
      payment_plan: 'full',
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      currency,
      tax_class: 'eservice',
      ...(companyName ? { company_name: companyName } : {}),
      ...(vatNumber ? { vat_number: vatNumber } : {}),
      ...(selectedBumps.length ? { bumps: selectedBumps.join(',') } : {}),
      ...(effectivePct > 0
        ? {
            discount_percent: String(effectivePct),
            original_amount_cents: String(offer.price_cents),
          }
        : {}),
    };

    const session = await createCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      enablePaypal: paypalEnabled(env),
      ...(customerId ? { customer: customerId } : { customer_email: email }),
      success_url: `${baseUrl}${THANKS_PATH}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      payment_intent_description: offer.label,
      line_items: [
        {
          name: offer.label,
          description: companyName ? `${offer.label} · Billed to ${companyName}` : undefined,
          amount_cents: chargedPriceCents,
          currency: currency.toLowerCase(),
          quantity: 1,
          product_metadata: { tax_class: 'eservice', product_slug: FORGIVENESS_PRODUCT_SLUG },
        },
        ...bumpOffers.map((b) => ({
          name: BUMPS[b.slug].label,
          amount_cents: b.price_cents,
          currency: currency.toLowerCase(),
          quantity: 1,
          product_metadata: { tax_class: 'eservice', product_slug: BUMPS[b.slug].catalogSlug },
        })),
      ],
      metadata,
      idempotency_key: `forgiveness-reg-${registrationId}`,
    });

    await attachStripeSessionToCourse(env.DB, registrationId, session.id);

    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'course.checkout.session.created',
      source: 'system',
      external_id: `local-course-${registrationId}`,
      payload: {
        course_registration_id: registrationId,
        session_id: session.id,
        product_slug: FORGIVENESS_PRODUCT_SLUG,
        currency,
        amount_cents: chargedPriceCents,
        bumps: selectedBumps,
        company_name: companyName,
        vat_number: vatNumber,
        discount_percent: effectivePct,
        original_amount_cents: offer.price_cents,
      },
    });

    return json({ checkout_url: session.url, course_registration_id: registrationId });
  } catch (err) {
    try {
      await locals.runtime.env.DB.prepare(
        `INSERT INTO events (registration_id, kind, source, payload_json)
         VALUES (NULL, 'course.checkout.error', 'system', ?)`,
      )
        .bind(JSON.stringify({ error: String(err), product: FORGIVENESS_PRODUCT_SLUG }))
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
