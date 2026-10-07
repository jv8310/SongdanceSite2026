import type { APIRoute } from 'astro';
import {
  createPendingCourseRegistration,
  attachStripeSessionToCourse,
  attachPaypalOrderToCourse,
} from '../../../lib/courses/db';
import { edgeTimezone } from '../../../lib/geo';
import { logEventSafe } from '../../../lib/registrations/db';
import {
  createCheckoutSession,
  createCustomer,
  paypalEnabled,
} from '../../../lib/registrations/stripe';
import {
  paypalConfigured,
  createOrder as createPaypalOrder,
} from '../../../lib/payments/paypal';
import { encodeCustomId, parseProvider } from '../../../lib/payments/provider';
import { findCountry } from '../../../lib/countries';
import { albumCurrencyForCountry } from '../../../lib/music/product';
import {
  CERT_EXTENSION_LABEL,
  CERT_EXTENSION_SLUG,
  LIVE_PASS_PAGE_PATH,
  livePassLabel,
  livePassOffer,
  livePassSlug,
  parseLivePassMonths,
  recordLivePassPeriod,
} from '../../../lib/courses/live-pass';
import { planLivePass } from '../../../lib/courses/live-pass-plan';

export const prerender = false;

// Checkout for the live pass (src/lib/courses/live-pass.ts), with the optional
// "Extend my certification window" add-on. Same shape as the album checkout:
// one product, full payment, B2C; the buyer's country picks the currency and
// the price comes from the same function the page renders with. The add-on is
// a second line item and a `cert-extension` row in `bumps` — refused for anyone
// it would buy nothing (no certification course on this address, or a window
// that already reaches past the end of this pass).
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

    const months = parseLivePassMonths(payload.months);
    if (!months) return json({ error: 'Please choose 1, 3 or 6 months.' }, 400);
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

    const plan = await planLivePass(env.DB, email);
    const period = plan.periods[months];
    if (withExtension && !period.extensionHelps) {
      if (!plan.window.holdsCourse) {
        return json(
          {
            error:
              'The certification extension is for students of the certification course, and we find no certification course under this email address. If you bought it with another address, please use that one.',
          },
          400,
        );
      }
      return json(
        {
          error: `Your certification window already runs until ${fmtDay(plan.window.endsOn ?? period.endsOn)}, past what the extension would add, so it would buy you nothing. Untick it to continue.`,
        },
        400,
      );
    }

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
