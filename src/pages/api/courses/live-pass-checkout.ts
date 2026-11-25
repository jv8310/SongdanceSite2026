import type { APIRoute } from 'astro';
import {
  createPendingCourseRegistration,
  attachStripeSessionToCourse,
  attachStripeSubscriptionToCourse,
  attachPaypalOrderToCourse,
  attachPaypalSubscriptionToCourse,
} from '../../../lib/courses/db';
import { edgeTimezone } from '../../../lib/geo';
import { logEventSafe } from '../../../lib/registrations/db';
import {
  createCheckoutSession,
  createCustomer,
  createSubscriptionCheckoutSession,
  ensureRepeatingCoupon,
  paypalEnabled,
} from '../../../lib/registrations/stripe';
import {
  paypalConfigured,
  createOrder as createPaypalOrder,
  createSubscription as createPaypalSubscription,
} from '../../../lib/payments/paypal';
import { formatMoney } from '../../../lib/workshops/currency';
import { findRunningMonthly, recordMonthlyStart } from '../../../lib/courses/live-pass-monthly';
import { businessDayStartMs } from '../../../lib/workshops/periods';
import { encodeCustomId, parseProvider } from '../../../lib/payments/provider';
import { findCountry } from '../../../lib/countries';
import { albumCurrencyForCountry } from '../../../lib/music/product';
import {
  CERT_EXTENSION_LABEL,
  CERT_EXTENSION_SLUG,
  LIVE_PASS_MONTHLY_LABEL,
  LIVE_PASS_MONTHLY_SLUG,
  LIVE_PASS_PAGE_PATH,
  MONTHLY_FIRST_MONTH_LABEL,
  MONTHLY_FIRST_MONTH_SLUG,
  livePassMonthlyFirstCents,
  livePassMonthlyRenewalCents,
  livePassMonthlyPromo,
  livePassLabel,
  livePassOffer,
  livePassSlug,
  parseLivePassMonths,
  recordLivePassPeriod,
} from '../../../lib/courses/live-pass';
import { extensionRefusal, monthlyExtensionRefusal, planLivePass, planMonthlyStart } from '../../../lib/courses/live-pass-plan';

export const prerender = false;

// Checkout for the live pass (src/lib/courses/live-pass.ts), with the optional
// "Extend my certification window" add-on. Same shape as the album checkout:
// one product, full payment, B2C; the buyer's country picks the currency and
// the price comes from the same function the page renders with. The add-on is
// a second line item and a `cert-extension` row in `bumps` — refused for anyone
// it would buy nothing (no certification course on this address, or a window
// that already reaches past the end of this pass).
//
// `months: 'monthly'` is the monthly live pass instead: an open-ended
// subscription (Stripe subscription mode / a PayPal plan with no cycle limit),
// the full month's price the first month and less after, no add-on, and
// refused while the address already has one running. Taken while the buyer
// still has the live sessions, it is agreed now and first charged the day
// those end (planMonthlyStart).
type Body = {
  months?: number | string;
  cert_extension?: boolean;
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string; // ISO-2
  consent_terms?: boolean;
  provider?: string; // 'stripe' (default) | 'paypal'
};

const fmtDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  try {
    let payload: Body;
    try {
      payload = (await request.json()) as Body;
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const isMonthly = payload.months === 'monthly';
    const months = parseLivePassMonths(payload.months);
    if (!months && !isMonthly) return json({ error: 'Please choose 1, 3, 6 or 12 months, or monthly.' }, 400);
    const withExtension = payload.cert_extension === true;

    const firstName = (payload.first_name ?? '').trim();
    const lastName = (payload.last_name ?? '').trim();
    const email = (payload.email ?? '').trim().toLowerCase();
    const countryCode = (payload.country ?? '').trim().toUpperCase();
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

    if (isMonthly) {
      return await startMonthly(env, locals, { firstName, lastName, email, countryCode, provider, withExtension });
    }
    if (!months) return json({ error: 'Please choose 1, 3, 6 or 12 months, or monthly.' }, 400);

    const plan = await planLivePass(env.DB, email);
    const period = plan.periods[months];
    const refusal = withExtension ? extensionRefusal(plan, months) : null;
    if (refusal) return json({ error: refusal }, 400);

    const currency = albumCurrencyForCountry(countryCode);
    const offer = livePassOffer(months, currency);
    const slug = livePassSlug(months);
    const label = livePassLabel(months);
    const bumps = withExtension ? [{ slug: CERT_EXTENSION_SLUG, amount_cents: offer.extension_cents }] : [];

    const registrationId = await createPendingCourseRegistration(env.DB, {
      email,
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      phone: null,
      phone_country: null,
      company_name: null,
      vat_number: null,
      product_slug: slug,
      activate_choice: null,
      language_choice: null,
      source_variant: 'direct',
      timezone: edgeTimezone(locals),
      bumps,
      amount_cents: offer.price_cents,
      currency,
      consent_terms: payload.consent_terms === true,
      payment_plan: 'full',
      installments_total: 1,
      provider,
    });

    // The period as quoted on the page; the payment rewrites it from the
    // moment it lands (paid-handler).
    await recordLivePassPeriod(env.DB, registrationId, period);

    const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');
    const successPath = `${LIVE_PASS_PAGE_PATH}?welcome=1`;
    const cancelUrl = `${baseUrl}${LIVE_PASS_PAGE_PATH}?email=${encodeURIComponent(email)}#get`;
    const lineItems = [
      { name: label, amountCents: offer.price_cents, slug },
      ...(withExtension
        ? [{ name: CERT_EXTENSION_LABEL, amountCents: offer.extension_cents, slug: CERT_EXTENSION_SLUG }]
        : []),
    ];
    const totalCents = lineItems.reduce((sum, l) => sum + l.amountCents, 0);

    if (provider === 'paypal') {
      const order = await createPaypalOrder({
        env,
        currency,
        items: lineItems.map((l) => ({
          name: l.name,
          amountMinor: l.amountCents,
          category: 'DIGITAL_GOODS' as const,
        })),
        customId: encodeCustomId('course', registrationId),
        description: label,
        softDescriptor: 'SONGDANCE',
        invoiceId: `${slug}-${registrationId}`,
        returnUrl: `${baseUrl}/api/payments/paypal-return?dest=${encodeURIComponent(successPath)}`,
        cancelUrl,
        brandName: 'Songdance',
        payer: { email, firstName, lastName, countryCode },
        requestId: `${slug}-reg-${registrationId}-pp`,
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
          product_slug: slug,
          cert_extension: withExtension,
          currency,
          amount_cents: totalCents,
        },
      });
      return json({ checkout_url: order.approveUrl, course_registration_id: registrationId });
    }

    let customerId: string | undefined;
    try {
      const cust = await createCustomer({
        secretKey: env.STRIPE_SECRET_KEY,
        email,
        name: `${firstName} ${lastName}`,
        country: countryCode,
        description: `${firstName} ${lastName} · ${slug} reg ${registrationId}`,
        metadata: {
          course_registration_id: String(registrationId),
          contact_first_name: firstName,
          contact_last_name: lastName,
          product_slug: slug,
          payment_plan: 'full',
          tax_class: 'eservice',
        },
      });
      customerId = cust.id;
    } catch (err) {
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'stripe.customer.error',
        source: 'system',
        payload: { course_registration_id: registrationId, error: String(err) },
      });
    }

    const session = await createCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      enablePaypal: paypalEnabled(env),
      ...(customerId ? { customer: customerId } : { customer_email: email }),
      success_url: `${baseUrl}${successPath}`,
      cancel_url: cancelUrl,
      payment_intent_description: label,
      line_items: lineItems.map((l) => ({
        name: l.name,
        amount_cents: l.amountCents,
        currency: currency.toLowerCase(),
        quantity: 1,
        product_metadata: { tax_class: 'eservice', product_slug: l.slug },
      })),
      metadata: {
        course_registration_id: String(registrationId),
        product_slug: slug,
        source_variant: 'direct',
        payment_plan: 'full',
        first_name: firstName,
        last_name: lastName,
        country: countryCode,
        currency,
        tax_class: 'eservice',
        cert_extension: withExtension ? 'yes' : 'no',
      },
      idempotency_key: `${slug}-reg-${registrationId}`,
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
        product_slug: slug,
        cert_extension: withExtension,
        currency,
        amount_cents: totalCents,
      },
    });

    return json({ checkout_url: session.url, course_registration_id: registrationId });
  } catch (err) {
    try {
      await locals.runtime.env.DB.prepare(
        `INSERT INTO events (registration_id, kind, source, payload_json)
         VALUES (NULL, 'course.checkout.error', 'system', ?)`,
      )
        .bind(JSON.stringify({ error: String(err), product: 'live-pass' }))
        .run();
    } catch {}
    const message = String(err).replace(/^Error:\s*/, '');
    return json({ error: `Could not start checkout: ${message}` }, 500);
  }
};

// The monthly live pass: one row, payment_plan 'subscription',
// installments_total 0, amount_cents = one month at the renewal price
// (isOpenEndedPlan). The first month's extra is a one-off on the first charge
// and a `monthly-first-month` row in `bumps` (live-pass.ts, "The monthly's
// price"). Recorded, granted and confirmed by the same paths as every course
// subscription; the webhook schedules no stop for it (installment_count 0).
async function startMonthly(
  env: Env,
  locals: App.Locals,
  who: { firstName: string; lastName: string; email: string; countryCode: string; provider: 'stripe' | 'paypal'; withExtension: boolean },
): Promise<Response> {
  const { firstName, lastName, email, countryCode, provider, withExtension } = who;
  if (await findRunningMonthly(env.DB, email)) {
    return json(
      {
        error:
          'You already have a monthly live pass running under this email address. To check or cancel it, use “Manage my monthly pass” on this page.',
      },
      409,
    );
  }
  const currency = albumCurrencyForCountry(countryCode);
  // With the certification-window extension both prices are 20% more
  // (live-pass.ts): the subscription's own price carries it month by month.
  const firstCents = livePassMonthlyFirstCents(currency, withExtension);
  const monthlyCents = livePassMonthlyRenewalCents(currency, withExtension);
  const extraCents = Math.max(0, firstCents - monthlyCents);
  const slug = LIVE_PASS_MONTHLY_SLUG;
  const label = withExtension ? `${LIVE_PASS_MONTHLY_LABEL} + certification window` : LIVE_PASS_MONTHLY_LABEL;
  // The day of the first charge: today, or the day the live sessions they
  // already have end — on this site or in the member app.
  const plan = await planLivePass(env.DB, email);
  const start = await planMonthlyStart(env, email, plan);
  const startsOn = start.startsOn;
  // The extension only for a certification student it would add something for.
  if (withExtension) {
    const refusal = monthlyExtensionRefusal(plan.window, startsOn);
    if (refusal) return json({ error: refusal }, 400);
  }
  // Charged at 09:00 Brussels on that day.
  const firstChargeMs = startsOn ? businessDayStartMs(startsOn) + 9 * 3_600_000 : null;
  const startsLabel = startsOn ? fmtDay(startsOn) : null;
  // The site sale (Black Friday 2026): 20% off the first two months. The order
  // itself is written as always (one month = the renewal price, the first
  // month's extra as its row), so every report reads it as a monthly; what the
  // two sale months really took is at the gateway.
  const promo = livePassMonthlyPromo(currency, Date.now(), withExtension);
  const prices = promo
    ? `${formatMoney(promo.first_cents, currency)} the first month and ${formatMoney(promo.second_cents, currency)} the second (${promo.percent}% off both), then ${formatMoney(monthlyCents, currency)} a month until cancelled`
    : `${formatMoney(firstCents, currency)} the first month, then ${formatMoney(monthlyCents, currency)} a month until cancelled`;
  const describe = startsLabel ? `Starts ${startsLabel}: ${prices}` : prices;

  const registrationId = await createPendingCourseRegistration(env.DB, {
    email,
    first_name: firstName,
    last_name: lastName,
    country: countryCode,
    phone: null,
    phone_country: null,
    company_name: null,
    vat_number: null,
    product_slug: slug,
    activate_choice: null,
    language_choice: null,
    source_variant: 'direct',
    timezone: edgeTimezone(locals),
    // The extension is in the monthly price itself; its €0 row marks the order.
    bumps: [
      ...(extraCents > 0 ? [{ slug: MONTHLY_FIRST_MONTH_SLUG, amount_cents: extraCents }] : []),
      ...(withExtension ? [{ slug: CERT_EXTENSION_SLUG, amount_cents: 0 }] : []),
    ],
    amount_cents: monthlyCents,
    currency,
    consent_terms: true,
    payment_plan: 'subscription',
    installments_total: 0,
    provider,
  });
  if (startsOn) await recordMonthlyStart(env.DB, registrationId, startsOn);

  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const successPath = `${LIVE_PASS_PAGE_PATH}?welcome=monthly${startsOn ? `&starts=${startsOn}` : ''}`;
  const cancelUrl = `${baseUrl}${LIVE_PASS_PAGE_PATH}?email=${encodeURIComponent(email)}&months=monthly${withExtension ? '&extend=1' : ''}#get`;

  if (provider === 'paypal') {
    const sub = await createPaypalSubscription({
      env,
      productName: label,
      productDescription: describe,
      planName: `${label} — monthly`,
      monthlyAmountMinor: monthlyCents,
      currency,
      installmentCount: 0, // PayPal: total_cycles 0 = renews until cancelled
      ...(promo
        ? {
            // The sale: the two discounted months are cycles of their own, then
            // the regular month. No setup fee: the first cycle is the first month.
            firstCycleMinor: promo.first_cents,
            secondCycleMinor: promo.second_cents,
            ...(firstChargeMs ? { startTime: new Date(firstChargeMs).toISOString() } : {}),
          }
        : firstChargeMs
        ? {
            // A later start: the first month is a cycle of its own at its full
            // price, billed on that day (a setup fee would be taken today).
            firstCycleMinor: firstCents,
            startTime: new Date(firstChargeMs).toISOString(),
          }
        : {
            // The first month's extra: charged once at the start, as its own
            // sale, which paypal-fulfill tells from a month by its amount.
            setupFeeMinor: extraCents || undefined,
          }),
      customId: encodeCustomId('course', registrationId),
      returnUrl: `${baseUrl}/api/payments/paypal-return?dest=${encodeURIComponent(successPath)}`,
      cancelUrl,
      brandName: 'Songdance',
      subscriber: { email, firstName, lastName },
      requestId: `${slug}-reg-${registrationId}-pp`,
    });
    await attachPaypalSubscriptionToCourse(env.DB, registrationId, sub.subscriptionId);
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'course.checkout.paypal.subscription.created',
      source: 'system',
      external_id: `local-course-pp-${registrationId}-monthly`,
      payload: { course_registration_id: registrationId, subscription_id: sub.subscriptionId, product_slug: slug, currency, monthly_amount_cents: monthlyCents, first_month_extra_cents: extraCents, cert_extension: withExtension, starts_on: startsOn, covered_by: start.coveredBy, ...(promo ? { promo_percent: promo.percent, promo_first_cents: promo.first_cents, promo_second_cents: promo.second_cents } : {}) },
    });
    return json({ checkout_url: sub.approveUrl, course_registration_id: registrationId });
  }

  // Stripe subscription mode needs a Customer to bill each month.
  const cust = await createCustomer({
    secretKey: env.STRIPE_SECRET_KEY,
    email,
    name: `${firstName} ${lastName}`,
    country: countryCode,
    description: `${firstName} ${lastName} · ${slug} reg ${registrationId}`,
    metadata: {
      course_registration_id: String(registrationId),
      contact_first_name: firstName,
      contact_last_name: lastName,
      product_slug: slug,
      payment_plan: 'subscription',
      tax_class: 'eservice',
    },
  });
  // The sale on Stripe: a coupon on the subscription, so Stripe takes the
  // percent off every line of the first two invoices (the first month's extra
  // included). A coupon's months count from the day it is applied, not from the
  // first charge, so a later start gets one that lasts the whole months until
  // that charge plus the two: it then covers exactly the first two charges.
  let coupon: string | undefined;
  if (promo) {
    let waitMonths = 0;
    if (firstChargeMs) {
      const d = new Date();
      for (;;) {
        d.setUTCMonth(d.getUTCMonth() + 1);
        if (d.getTime() > firstChargeMs) break;
        waitMonths += 1;
      }
    }
    const months = waitMonths + promo.months;
    coupon = `sale-monthly-${promo.percent}pct-${months}m`;
    await ensureRepeatingCoupon({
      secretKey: env.STRIPE_SECRET_KEY,
      id: coupon,
      name: `${promo.percent}% off the first ${promo.months} months`,
      percent_off: promo.percent,
      duration_in_months: months,
    });
  }
  const session = await createSubscriptionCheckoutSession({
    secretKey: env.STRIPE_SECRET_KEY,
    customer: cust.id,
    coupon,
    success_url: `${baseUrl}${successPath}`,
    cancel_url: cancelUrl,
    product_name: label,
    product_description: describe,
    payment_intent_description: label,
    product_metadata: { tax_class: 'eservice', product_slug: slug },
    monthly_amount_cents: monthlyCents,
    currency: currency.toLowerCase(),
    installment_count: 0, // open-ended: no cancel_at is scheduled
    // A later start: nothing today, the subscription bills from that day, and
    // the first month's extra is added to that first invoice once Checkout
    // completes (live-pass-scheduled.ts) — as a one-time line here it would be
    // charged today.
    ...(firstChargeMs
      ? {
          trial_end: Math.floor(firstChargeMs / 1000),
          submit_message: promo
            ? `Nothing is charged today. Your monthly starts on ${startsLabel}: the first month, ${formatMoney(promo.first_cents, currency)}, is charged that day, the second month is ${formatMoney(promo.second_cents, currency)}, then ${formatMoney(monthlyCents, currency)} every month after it until you cancel.`
            : `Nothing is charged today. Your monthly starts on ${startsLabel}: the first month, ${formatMoney(firstCents, currency)}, is charged that day, then ${formatMoney(monthlyCents, currency)} every month after it until you cancel.`,
        }
      : {}),
    // The first month's extra, on the first invoice only.
    one_time_line_items:
      extraCents > 0 && !firstChargeMs
        ? [
            {
              name: MONTHLY_FIRST_MONTH_LABEL,
              description: `Your first month is ${formatMoney(firstCents, currency)}; every month after it, ${formatMoney(monthlyCents, currency)}.`,
              amount_cents: extraCents,
              currency: currency.toLowerCase(),
              quantity: 1,
              product_metadata: { tax_class: 'eservice', product_slug: MONTHLY_FIRST_MONTH_SLUG },
            },
          ]
        : undefined,
    metadata: {
      course_registration_id: String(registrationId),
      product_slug: slug,
      source_variant: 'direct',
      payment_plan: 'subscription',
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      currency,
      tax_class: 'eservice',
      ...(startsOn ? { monthly_starts_on: startsOn, first_month_extra_cents: String(extraCents) } : {}),
      ...(withExtension ? { cert_extension: 'yes' } : {}),
    },
    idempotency_key: `${slug}-reg-${registrationId}`,
  });
  await attachStripeSessionToCourse(env.DB, registrationId, session.id);
  if (session.subscription) await attachStripeSubscriptionToCourse(env.DB, registrationId, session.subscription);
  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'course.checkout.subscription.created',
    source: 'system',
    external_id: `local-course-${registrationId}-monthly`,
    payload: { course_registration_id: registrationId, session_id: session.id, product_slug: slug, currency, monthly_amount_cents: monthlyCents, first_month_extra_cents: extraCents, cert_extension: withExtension, installments_total: 0, starts_on: startsOn, covered_by: start.coveredBy, ...(promo ? { promo_percent: promo.percent, promo_coupon: coupon } : {}) },
  });
  return json({ checkout_url: session.url, course_registration_id: registrationId });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
