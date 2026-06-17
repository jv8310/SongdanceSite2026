// Checkout for the 12-Week Somatic Vocal Healing Course.
//
//   - Email-gated, regional pricing (~€650 across the workshop currencies).
//   - payment_plan 'full' → one-off Stripe Checkout (mode=payment).
//     payment_plan '3x'   → monthly Subscription that cancels after 3 invoices.
//   - The 20% workshop discount is re-derived here from the email↔workshop link
//     (NOT trusted from the client), so the charge always matches eligibility.
//   - B2C by default; an EU/UK VAT number (shown once a company is named) is
//     attached to the Stripe Customer as tax_id_data for reverse-charge.
//   - tax_class = 'eservice' on every line item for the Quaderno–Stripe sync.
//
// Fulfilment reuses the shared course pipeline: the pending row + the
// `course_registration_id` metadata are all the existing Stripe webhook +
// paid-handler need to flip the row to paid and tag `prod_SVH_12w` in Drip.

import type { APIRoute } from 'astro';
import {
  createPendingCourseRegistration,
  attachStripeSessionToCourse,
  attachStripeSubscriptionToCourse,
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
import { formatMoney } from '../../../lib/workshops/currency';
import {
  listSecuredWorkshopLinksByEmail,
  listReplayViewAnchorsByEmail,
} from '../../../lib/workshops/db';
import {
  twelveWeekCurrencyForCountry,
  priceCents,
  monthlyCents,
  applyPercentCents,
  bestDiscountStatus,
  anchorMsFromWorkshop,
  effectiveTwelveWeekDiscount,
  parseUrlDiscountPercent,
  TWELVE_WEEK_PRODUCT_SLUG,
  INSTALLMENT_COUNT,
} from '../../../lib/courses/twelve-week';

export const prerender = false;

const LABEL = 'The 12-Week Somatic Vocal Healing Course';

type Body = {
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string; // ISO-2
  phone_country?: string; // ISO-2
  phone?: string;
  company_name?: string;
  vat_number?: string;
  payment_plan?: string;
  consent_terms?: boolean;
  discount_percent?: number | string;
};

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
    const phoneCountryCode = (payload.phone_country ?? '').trim().toUpperCase();
    const phoneLocal = (payload.phone ?? '').trim();
    const companyName = (payload.company_name ?? '').trim() || null;
    const vatNumberRaw = (payload.vat_number ?? '').trim().replace(/\s+/g, '');
    const vatNumber = vatNumberRaw ? vatNumberRaw.toUpperCase() : null;
    const paymentPlan: PaymentPlan = payload.payment_plan === '3x' ? '3x' : 'full';

    if (!firstName || !lastName || !email) {
      return json({ error: 'First name, last name and email are required.' }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Please enter a valid email address.' }, 400);
    }
    if (!countryCode || !findCountry(countryCode)) {
      return json({ error: 'Please select your country from the list.' }, 400);
    }
    if (!phoneCountryCode || !findCountry(phoneCountryCode) || !phoneLocal) {
      return json({ error: 'Please enter a phone number with country code.' }, 400);
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

    // Currency follows the buyer's country (so headline and charge agree).
    const currency = twelveWeekCurrencyForCountry(countryCode);

    // Re-derive the discount independently of the client. A `?discount=N`
    // override (1–99) wins over the automatic workshop discount; otherwise the
    // workshop window (incl. replay-view anchors) decides. The override is
    // deliberately permissive — whoever holds the URL controls the price.
    const overridePercent = parseUrlDiscountPercent(payload.discount_percent);
    const links = await listSecuredWorkshopLinksByEmail(env.DB, email);
    const replayAnchors = await listReplayViewAnchorsByEmail(env.DB, email);
    const workshopStatus = bestDiscountStatus(
      [
        ...links.map((l) => anchorMsFromWorkshop(l.starts_at_utc, l.ends_at_utc)),
        ...replayAnchors,
      ],
      Date.now(),
    );
    const discount = effectiveTwelveWeekDiscount(workshopStatus, overridePercent);
    const eligible = discount.eligible;
    const discountPercent = discount.percent;

    const baseFull = priceCents(currency);
    const baseMonthly = monthlyCents(currency);
    const chargedFull = applyPercentCents(baseFull, discountPercent);
    const chargedMonthly = applyPercentCents(baseMonthly, discountPercent);

    const totalAmountCents =
      paymentPlan === '3x' ? chargedMonthly * INSTALLMENT_COUNT : chargedFull;
    const installmentsTotal = paymentPlan === '3x' ? INSTALLMENT_COUNT : 1;
    const sourceVariant = eligible
      ? discount.kind === 'override'
        ? `override-${discountPercent}`
        : discount.kind === 'promo'
          ? 'launch-promo'
          : `workshop-${discount.kind}`
      : 'direct';

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
      product_slug: TWELVE_WEEK_PRODUCT_SLUG,
      activate_choice: null,
      source_variant: sourceVariant,
      amount_cents: totalAmountCents,
      currency,
      consent_terms: payload.consent_terms === true,
      payment_plan: paymentPlan,
      installments_total: installmentsTotal,
    });

    const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');

    // Pre-create the Stripe Customer (required for subscription mode; carries
    // the VAT id for reverse-charge invoicing).
    let customerId: string | undefined;
    const taxIdType = vatNumber ? stripeTaxIdTypeFor(vatNumber.slice(0, 2)) : null;
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
          ? `${companyName} · ${firstName} ${lastName} · 12w course reg ${registrationId}`
          : `${firstName} ${lastName} · 12w course reg ${registrationId}`,
        tax_id: vatNumber && taxIdType ? { type: taxIdType, value: vatNumber } : undefined,
        metadata: {
          course_registration_id: String(registrationId),
          contact_first_name: firstName,
          contact_last_name: lastName,
          product_slug: TWELVE_WEEK_PRODUCT_SLUG,
          payment_plan: paymentPlan,
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
        payload: { course_registration_id: registrationId, error: String(err) },
      });
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
      product_slug: TWELVE_WEEK_PRODUCT_SLUG,
      payment_plan: paymentPlan,
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      phone: phoneE164,
      currency,
      tax_class: 'eservice',
      ...(companyName ? { company_name: companyName } : {}),
      ...(vatNumber ? { vat_number: vatNumber } : {}),
      ...(eligible
        ? {
            discount_percent: String(discountPercent),
            discount_kind: discount.kind,
            original_amount_cents: String(
              paymentPlan === '3x' ? baseMonthly * INSTALLMENT_COUNT : baseFull,
            ),
          }
        : {}),
    };

    const successUrl = `${baseUrl}/courses/12-week/thanks?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/courses/12-week#register`;

    const productMetadata: Record<string, string> = {
      tax_class: 'eservice',
      product_slug: TWELVE_WEEK_PRODUCT_SLUG,
    };

    if (paymentPlan === '3x' && customerId) {
      const session = await createSubscriptionCheckoutSession({
        secretKey: env.STRIPE_SECRET_KEY,
        customer: customerId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        product_name: LABEL,
        product_description: `${INSTALLMENT_COUNT} monthly installments of ${formatMoney(chargedMonthly, currency)}`,
        payment_intent_description: LABEL,
        product_metadata: productMetadata,
        monthly_amount_cents: chargedMonthly,
        currency: currency.toLowerCase(),
        installment_count: INSTALLMENT_COUNT,
        metadata,
        idempotency_key: `tw-reg-${registrationId}-3x`,
      });

      await attachStripeSessionToCourse(env.DB, registrationId, session.id);
      if (session.subscription) {
        await attachStripeSubscriptionToCourse(env.DB, registrationId, session.subscription);
      }

      await logEvent(env.DB, {
        registration_id: null,
        kind: 'course.checkout.subscription.created',
        source: 'system',
        external_id: `local-course-${registrationId}-3x`,
        payload: {
          course_registration_id: registrationId,
          session_id: session.id,
          subscription_id: session.subscription,
          product_slug: TWELVE_WEEK_PRODUCT_SLUG,
          currency,
          monthly_amount_cents: chargedMonthly,
          installments_total: INSTALLMENT_COUNT,
          discount_kind: eligible ? discount.kind : null,
          discount_percent: eligible ? discountPercent : 0,
          original_monthly_amount_cents: baseMonthly,
        },
      });

      return json({ checkout_url: session.url, course_registration_id: registrationId });
    }

    // One-off payment.
    const session = await createCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      enablePaypal: paypalEnabled(env),
      ...(customerId ? { customer: customerId } : { customer_email: email }),
      success_url: successUrl,
      cancel_url: cancelUrl,
      payment_intent_description: LABEL,
      line_items: [
        {
          name: LABEL,
          description: companyName ? `${LABEL} · Billed to ${companyName}` : undefined,
          amount_cents: chargedFull,
          currency: currency.toLowerCase(),
          quantity: 1,
          product_metadata: productMetadata,
        },
      ],
      metadata,
      idempotency_key: `tw-reg-${registrationId}`,
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
        product_slug: TWELVE_WEEK_PRODUCT_SLUG,
        currency,
        amount_cents: chargedFull,
        discount_kind: eligible ? discount.kind : null,
        discount_percent: eligible ? discountPercent : 0,
        original_amount_cents: baseFull,
      },
    });

    return json({ checkout_url: session.url, course_registration_id: registrationId });
  } catch (err) {
    try {
      await locals.runtime.env.DB.prepare(
        `INSERT INTO events (registration_id, kind, source, payload_json)
         VALUES (NULL, 'course.checkout.error', 'system', ?)`,
      )
        .bind(JSON.stringify({ error: String(err), product: TWELVE_WEEK_PRODUCT_SLUG }))
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
