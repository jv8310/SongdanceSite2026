// Course-checkout endpoint. Slimmer than the retreat checkout:
//   - no rooms / no tiers / no inventory
//   - B2C by default, B2B optional (company + EU VAT number attached to the
//     Stripe Customer as tax_id_data so Quaderno applies reverse-charge)
//
// Inputs come from the variant block on /courses/certification. The variant
// itself is recorded on the row so we can audit later why a person was
// offered the bundle vs. cert-only.
//
// payment_plan:
//   'full' → one-off PaymentIntent via Stripe Checkout (mode=payment)
//   '3x'   → monthly Subscription via Stripe Checkout (mode=subscription),
//            cancels itself after 3 invoices
//
// Tax / Quaderno: every line item carries product_metadata.tax_class =
// 'eservice'. The Quaderno-Stripe sync reads this to apply destination-VAT
// rules for digital services (EU consumer → buyer-country VAT; EU business
// with VAT id → reverse-charge; non-EU → out of EU VAT scope).
//
// Every code path returns JSON on failure (never an HTML 500), so the
// frontend can render the actual error instead of the generic
// "could not reach the server" fallback that fires when res.json() throws.

import type { APIRoute } from 'astro';
import {
  createPendingCourseRegistration,
  attachStripeSessionToCourse,
  attachStripeSubscriptionToCourse,
  type ActivateChoice,
  type CourseProductSlug,
  type PaymentPlan,
} from '../../../lib/courses/db';
import { logEvent } from '../../../lib/registrations/db';
import {
  createCheckoutSession,
  createCustomer,
  paypalEnabled,
  createSubscriptionCheckoutSession,
  stripeTaxIdTypeFor,
} from '../../../lib/registrations/stripe';
import { findCountry } from '../../../lib/countries';
import {
  getBundleOffer,
  getCertOffer,
  type Currency,
  type InstallmentPlan,
  type Offer,
  type Variant,
} from '../../../lib/courses/variant';

export const prerender = false;

// Resolve the installment ladder for the chosen payment plan. Returns null
// for 'full' (one-off) or when the offer doesn't carry that ladder.
function installmentPlanFor(
  offer: Offer,
  paymentPlan: PaymentPlan,
): InstallmentPlan | undefined {
  if (paymentPlan === '3x') return offer.installments;
  if (paymentPlan === '6x') return offer.installments_6x;
  return undefined;
}

type Body = {
  product_slug?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string;       // ISO-2
  phone_country?: string; // ISO-2
  phone?: string;
  company_name?: string;
  vat_number?: string;
  activate_choice?: string;
  source_variant?: string;
  consent_terms?: boolean;
  payment_plan?: string;
  currency?: string;
  discount_percent?: number | string;
};

function offerFor(productSlug: CourseProductSlug, currency: Currency): Offer {
  return productSlug === 'cc-bundle'
    ? getBundleOffer(currency)
    : getCertOffer(currency);
}

// URL-driven discount. Any integer 1–99 is accepted; anything else (NaN,
// 0, ≥100, negative, non-integer) falls back to no discount. Note: this is
// deliberately permissive — whoever holds the URL controls the price.
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

  // Wrap the whole handler in try/catch so any unexpected Stripe / D1 /
  // network error still surfaces as a JSON {error} the client can show,
  // instead of a 500 with HTML that res.json() would choke on.
  try {
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
    const companyName = (payload.company_name ?? '').trim() || null;
    const vatNumberRaw = (payload.vat_number ?? '').trim().replace(/\s+/g, '');
    const vatNumber = vatNumberRaw ? vatNumberRaw.toUpperCase() : null;
    const paymentPlan: PaymentPlan =
      payload.payment_plan === '3x'
        ? '3x'
        : payload.payment_plan === '6x'
          ? '6x'
          : 'full';
    const currency: Currency =
      payload.currency === 'USD'
        ? 'USD'
        : payload.currency === 'GBP'
          ? 'GBP'
          : 'EUR';
    const discountPct = parseDiscountPercent(payload.discount_percent);

    if (productSlug !== 'cc-cert' && productSlug !== 'cc-bundle') {
      return json({ error: 'Unknown product.' }, 400);
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
    if (!phoneCountryCode || !findCountry(phoneCountryCode) || !phoneLocal) {
      return json(
        { error: 'Please enter a phone number with country code.' },
        400,
      );
    }
    if (!payload.consent_terms) {
      return json({ error: 'Please agree to the terms to continue.' }, 400);
    }
    // VAT number requires a company; an isolated VAT without a company is
    // very likely a copy-paste mistake.
    if (vatNumber && !companyName) {
      return json(
        { error: 'Please add your company name to use a VAT number.' },
        400,
      );
    }
    // Lightweight VAT sanity check — Stripe will reject malformed VAT ids
    // with a less friendly message, so we filter the obvious garbage here.
    if (vatNumber && !/^[A-Z]{2}[A-Z0-9]{6,14}$/.test(vatNumber)) {
      return json(
        {
          error:
            'That VAT number does not look right. It should start with the two-letter country code (e.g. BE0123456789).',
        },
        400,
      );
    }

    const activateChoice: ActivateChoice | null =
      payload.activate_choice === 'now' || payload.activate_choice === 'wait'
        ? payload.activate_choice
        : null;

    const sourceVariant = isVariant(payload.source_variant)
      ? payload.source_variant
      : 'direct';

    const offer = offerFor(productSlug, currency);

    // The installment ladder for the chosen plan (3 or 6 monthly payments),
    // or undefined for pay-in-full.
    const installmentPlan = installmentPlanFor(offer, paymentPlan);

    // For full pay we charge price_cents once. For an installment plan we
    // charge monthly_cents × count (total may differ by a few cents from the
    // pay-in-full price — see variant.ts).
    if (paymentPlan !== 'full' && !installmentPlan) {
      return json(
        { error: 'This product cannot be purchased in installments.' },
        400,
      );
    }
    // Apply URL-driven discount to the unit price charged to the buyer.
    // For an installment plan, every monthly payment is discounted (not just
    // the first).
    const chargedPriceCents = applyDiscount(offer.price_cents, discountPct);
    const chargedMonthlyCents = installmentPlan
      ? applyDiscount(installmentPlan.monthly_cents, discountPct)
      : 0;
    const totalAmountCents = installmentPlan
      ? chargedMonthlyCents * installmentPlan.count
      : chargedPriceCents;
    const installmentsTotal = installmentPlan ? installmentPlan.count : 1;

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
      company_name: companyName,
      vat_number: vatNumber,
      product_slug: productSlug,
      activate_choice: activateChoice,
      source_variant: sourceVariant,
      amount_cents: totalAmountCents,
      currency,
      consent_terms: payload.consent_terms === true,
      payment_plan: paymentPlan,
      installments_total: installmentsTotal,
    });

    const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');

    // Pre-create the Stripe Customer so the email/name/country pre-fill on
    // the checkout page and Stripe can filter payment methods by country.
    // For subscription mode this is required (the customer carries the
    // payment method that future invoices charge against). For one-off
    // payments it's still nice-to-have but optional.
    //
    // When the buyer provides an EU/UK VAT number we attach it as
    // tax_id_data, which Quaderno reads from the Stripe customer to issue
    // a reverse-charge invoice.
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
        phone: phoneE164,
        country: countryCode,
        description: companyName
          ? `${companyName} · ${firstName} ${lastName} · course reg ${registrationId}`
          : `${firstName} ${lastName} · course reg ${registrationId}`,
        tax_id:
          vatNumber && taxIdType
            ? { type: taxIdType, value: vatNumber }
            : undefined,
        metadata: {
          course_registration_id: String(registrationId),
          contact_first_name: firstName,
          contact_last_name: lastName,
          product_slug: productSlug,
          payment_plan: paymentPlan,
          // Quaderno reads `tax_class` from the customer too as a fallback
          // for products without explicit tax metadata.
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
      // For subscription mode the customer is mandatory — bail with a
      // visible error instead of silently falling back to customer_email.
      if (paymentPlan === '3x') {
        return json(
          {
            error:
              'We could not start the payment plan. Please try again, or pick "Pay in full".',
          },
          502,
        );
      }
    }

    const metadata: Record<string, string> = {
      course_registration_id: String(registrationId),
      product_slug: productSlug,
      activate_choice: activateChoice ?? '',
      source_variant: sourceVariant,
      payment_plan: paymentPlan,
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      phone: phoneE164,
      currency,
      tax_class: 'eservice',
      ...(companyName ? { company_name: companyName } : {}),
      ...(vatNumber ? { vat_number: vatNumber } : {}),
      ...(discountPct > 0
        ? {
            discount_percent: String(discountPct),
            original_amount_cents: String(
              installmentPlan ? installmentPlan.total_cents : offer.price_cents,
            ),
          }
        : {}),
    };

    // Preserve the discount on the cancel URL so the buyer's price doesn't
    // silently jump back to full if they bail out and try again.
    const cancelQuery = discountPct > 0 ? `?discount=${discountPct}` : '';
    const successUrl = `${baseUrl}/courses/certification/thanks?session_id={CHECKOUT_SESSION_ID}`;

    // tax_class metadata is attached to the underlying Stripe Product so
    // Quaderno's sync picks it up on every Invoice generated from this
    // session (relevant for the recurring subscription too).
    const productMetadata: Record<string, string> = {
      tax_class: 'eservice',
      product_slug: productSlug,
    };

    if (paymentPlan !== 'full' && installmentPlan && customerId) {
      const session = await createSubscriptionCheckoutSession({
        secretKey: env.STRIPE_SECRET_KEY,
        customer: customerId,
        success_url: successUrl,
        cancel_url: `${baseUrl}/courses/certification${cancelQuery}#register`,
        product_name: offer.label,
        product_description: `${installmentPlan.count} monthly installments of ${moneyCents(chargedMonthlyCents, currency)}`,
        payment_intent_description: offer.label,
        product_metadata: productMetadata,
        monthly_amount_cents: chargedMonthlyCents,
        currency: currency.toLowerCase(),
        installment_count: installmentPlan.count,
        metadata,
        idempotency_key: `course-reg-${registrationId}-${paymentPlan}${discountPct > 0 ? `-d${discountPct}` : ''}`,
      });

      await attachStripeSessionToCourse(env.DB, registrationId, session.id);
      if (session.subscription) {
        await attachStripeSubscriptionToCourse(
          env.DB,
          registrationId,
          session.subscription,
        );
      }

      await logEvent(env.DB, {
        registration_id: null,
        kind: 'course.checkout.subscription.created',
        source: 'system',
        external_id: `local-course-${registrationId}-${paymentPlan}`,
        payload: {
          course_registration_id: registrationId,
          session_id: session.id,
          subscription_id: session.subscription,
          product_slug: productSlug,
          currency,
          monthly_amount_cents: chargedMonthlyCents,
          installments_total: installmentPlan.count,
          activate_choice: activateChoice,
          source_variant: sourceVariant,
          company_name: companyName,
          vat_number: vatNumber,
          discount_percent: discountPct,
          original_monthly_amount_cents: installmentPlan.monthly_cents,
        },
      });

      return json({
        checkout_url: session.url,
        course_registration_id: registrationId,
      });
    }

    // Default path: one-off payment.
    const session = await createCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      enablePaypal: paypalEnabled(env),
      ...(customerId
        ? { customer: customerId }
        : { customer_email: email }),
      success_url: successUrl,
      cancel_url: `${baseUrl}/courses/certification${cancelQuery}#register`,
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
      idempotency_key: `course-reg-${registrationId}${discountPct > 0 ? `-d${discountPct}` : ''}`,
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
        currency,
        amount_cents: chargedPriceCents,
        activate_choice: activateChoice,
        source_variant: sourceVariant,
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
    // Best effort: log the error to D1 so we have a paper trail for prod
    // debugging, then surface a readable message to the user.
    try {
      await locals.runtime.env.DB.prepare(
        `INSERT INTO events (registration_id, kind, source, payload_json)
         VALUES (NULL, 'course.checkout.error', 'system', ?)`,
      )
        .bind(JSON.stringify({ error: String(err) }))
        .run();
    } catch {}
    const message = String(err).replace(/^Error:\s*/, '');
    return json(
      {
        error: `Could not start checkout: ${message}`,
      },
      500,
    );
  }
};

function isVariant(v: unknown): v is Variant {
  return v === 'B1' || v === 'B2' || v === 'A' || v === 'D' || v === 'E' || v === 'C';
}

function moneyCents(cents: number, currency: Currency): string {
  const symbol =
    currency === 'USD' ? '$' : currency === 'GBP' ? '£' : '€';
  const whole = cents % 100 === 0;
  const amount = (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return `${symbol}${amount}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
