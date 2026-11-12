import type { APIRoute } from 'astro';
import {
  attachPaypalOrderToCourse,
  attachStripeSessionToCourse,
  createPendingCourseRegistration,
} from '../../../lib/courses/db';
import { edgeTimezone } from '../../../lib/geo';
import { logEventSafe } from '../../../lib/registrations/db';
import { createCheckoutSession, createCustomer, paypalEnabled } from '../../../lib/registrations/stripe';
import { createOrder as createPaypalOrder, paypalConfigured } from '../../../lib/payments/paypal';
import { encodeCustomId, parseProvider } from '../../../lib/payments/provider';
import { findCountry } from '../../../lib/countries';
import {
  bookingOpen,
  loadSessionSettings,
  SESSION_PRODUCT_LABEL,
  SESSION_PRODUCT_SLUG,
  sessionCurrencyForCountry,
  sessionPriceCents,
} from '../../../lib/sessions/config';
import { findOfferedSlot, loadAvailability } from '../../../lib/sessions/availability';
import { attachRegistration, createHold, releaseHold, releaseOwnHolds, setMeeting } from '../../../lib/sessions/db';
import { signBookingToken, BOOKING_PATH } from '../../../lib/sessions/link';
import { formatInTz } from '../../../lib/workshops/time';

export const prerender = false;

// Checkout for an individual session (/sessions). The buyer picked a moment
// the page showed as free; it is checked again against the calendar and the
// bookings right now, then taken for them (a hold, atomic — two buyers can't
// both get it) before the payment page opens. The Stripe page closes after 30
// minutes, inside the hold. The payment rides course_registrations under
// product slug `individual-session`; on payment notifyCourseOrder confirms the
// booking (src/lib/sessions/confirm.ts).
type Body = {
  start?: string; // ISO instant of the chosen moment
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string;
  timezone?: string; // the browser's IANA zone
  note?: string;
  consent_terms?: boolean;
  provider?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validTz(tz: string | null | undefined): string | null {
  const t = (tz ?? '').trim().slice(0, 64);
  if (!t) return null;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: t });
    return t;
  } catch {
    return null;
  }
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  let bookingId: number | null = null;

  try {
    let payload: Body;
    try {
      payload = (await request.json()) as Body;
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const settings = await loadSessionSettings(env.DB);
    if (!bookingOpen(settings)) return json({ error: 'Booking is not open yet.' }, 400);

    const firstName = (payload.first_name ?? '').trim().slice(0, 100);
    const lastName = (payload.last_name ?? '').trim().slice(0, 100);
    const email = (payload.email ?? '').trim().toLowerCase().slice(0, 254);
    const countryCode = (payload.country ?? '').trim().toUpperCase();
    const note = (payload.note ?? '').trim().slice(0, 2000) || null;
    const timezone = validTz(payload.timezone) ?? edgeTimezone(locals);
    const provider = parseProvider(payload.provider);
    if (provider === 'paypal' && !paypalConfigured(env)) {
      return json({ error: 'PayPal is not available right now. Please pay by card.' }, 400);
    }
    if (!firstName || !lastName || !email) return json({ error: 'First name, last name and email are required.' }, 400);
    if (!EMAIL_RE.test(email)) return json({ error: 'Please enter a valid email address.' }, 400);
    if (!countryCode || !findCountry(countryCode)) return json({ error: 'Please select your country from the list.' }, 400);
    if (!payload.consent_terms) return json({ error: 'Please agree to the terms to continue.' }, 400);

    // Is the moment still on offer — right now, not when the page loaded? An
    // unpaid hold of their own on it (a second try) doesn't count.
    const startIso = Number.isFinite(Date.parse(payload.start ?? '')) ? new Date(payload.start!).toISOString() : '';
    if (startIso) await releaseOwnHolds(env.DB, email, startIso).catch(() => {});
    const av = await loadAvailability(env, settings);
    if (!av.ok) return json({ error: 'The calendar could not be read just now — please try again in a minute.' }, 503);
    const offered = findOfferedSlot(av, payload.start ?? '');
    if (!offered) return json({ error: 'That moment is no longer free — please choose another.', taken: true }, 409);

    bookingId = await createHold(env.DB, {
      startsAtUtc: offered.slot.startUtc,
      endsAtUtc: offered.slot.endUtc,
      durationMin: settings.durationMin,
      bufferMin: settings.bufferMin,
      sourceEventId: offered.slot.eventId,
      email,
      firstName,
      lastName,
      timezone,
      note,
    });
    if (!bookingId) return json({ error: 'Someone has just taken that moment — please choose another.', taken: true }, 409);
    // The link on the "Boekingen" event, as the meeting's fallback (a Zoom
    // meeting of its own replaces it on payment when the API is connected).
    if (offered.window?.joinUrl) {
      await setMeeting(env.DB, bookingId, {
        zoomMeetingId: null,
        joinUrl: offered.window.joinUrl,
        passcode: offered.window.passcode,
        source: 'calendar',
      });
    }

    const currency = sessionCurrencyForCountry(countryCode);
    const priceCents = sessionPriceCents(settings.priceEurCents, currency);
    const whenBrussels = formatInTz(offered.slot.startUtc, 'Europe/Brussels');
    const label = `${SESSION_PRODUCT_LABEL} — ${whenBrussels}`;

    const registrationId = await createPendingCourseRegistration(env.DB, {
      email,
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      phone: null,
      phone_country: null,
      company_name: null,
      vat_number: null,
      product_slug: SESSION_PRODUCT_SLUG,
      activate_choice: null,
      language_choice: null,
      source_variant: 'direct',
      timezone,
      amount_cents: priceCents,
      currency,
      consent_terms: true,
      payment_plan: 'full',
      installments_total: 1,
      provider,
    });
    await attachRegistration(env.DB, bookingId, registrationId);

    const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');
    const token = await signBookingToken(env.ADMIN_SESSION_SECRET, bookingId);
    const successPath = `${BOOKING_PATH}?t=${encodeURIComponent(token)}&welcome=1`;
    // Backing out of the payment page frees the moment at once (/sessions
    // reads ?release=), so it isn't kept from the next person for 35 minutes.
    const cancelUrl = `${baseUrl}/sessions?release=${encodeURIComponent(token)}#book`;

    if (provider === 'paypal') {
      const order = await createPaypalOrder({
        env,
        currency,
        items: [{ name: label, amountMinor: priceCents, category: 'DIGITAL_GOODS' }],
        customId: encodeCustomId('course', registrationId),
        description: label,
        softDescriptor: 'SONGDANCE',
        invoiceId: `session-${bookingId}-${registrationId}`,
        returnUrl: `${baseUrl}/api/payments/paypal-return?dest=${encodeURIComponent(successPath)}`,
        cancelUrl,
        brandName: 'Songdance',
        payer: { email, firstName, lastName, countryCode },
        requestId: `session-${bookingId}-reg-${registrationId}-pp`,
      });
      await attachPaypalOrderToCourse(env.DB, registrationId, order.id);
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'course.checkout.paypal.order.created',
        source: 'system',
        external_id: `local-course-pp-${registrationId}`,
        payload: { course_registration_id: registrationId, order_id: order.id, product_slug: SESSION_PRODUCT_SLUG, booking_id: bookingId, currency, amount_cents: priceCents },
      });
      return json({ checkout_url: order.approveUrl, booking_id: bookingId });
    }

    let customerId: string | undefined;
    try {
      const cust = await createCustomer({
        secretKey: env.STRIPE_SECRET_KEY,
        email,
        name: `${firstName} ${lastName}`,
        country: countryCode,
        description: `${firstName} ${lastName} · individual session ${bookingId} · reg ${registrationId}`,
        metadata: {
          course_registration_id: String(registrationId),
          contact_first_name: firstName,
          contact_last_name: lastName,
          product_slug: SESSION_PRODUCT_SLUG,
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
      // Only methods that settle on the spot: a moment can't wait days for a
      // SEPA debit to clear. And the page closes inside the hold.
      immediate_methods_only: true,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60 + 30,
      line_items: [
        {
          name: label,
          amount_cents: priceCents,
          currency: currency.toLowerCase(),
          quantity: 1,
          product_metadata: { tax_class: 'eservice', product_slug: SESSION_PRODUCT_SLUG },
        },
      ],
      metadata: {
        course_registration_id: String(registrationId),
        session_booking_id: String(bookingId),
        product_slug: SESSION_PRODUCT_SLUG,
        source_variant: 'direct',
        payment_plan: 'full',
        first_name: firstName,
        last_name: lastName,
        country: countryCode,
        currency,
        tax_class: 'eservice',
      },
      idempotency_key: `session-${bookingId}-reg-${registrationId}`,
    });
    await attachStripeSessionToCourse(env.DB, registrationId, session.id);
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'course.checkout.session.created',
      source: 'system',
      external_id: `local-course-${registrationId}`,
      payload: { course_registration_id: registrationId, session_id: session.id, product_slug: SESSION_PRODUCT_SLUG, booking_id: bookingId, currency, amount_cents: priceCents },
    });
    return json({ checkout_url: session.url, booking_id: bookingId });
  } catch (err) {
    // The payment page never opened: give the moment back.
    if (bookingId) await releaseHold(locals.runtime.env.DB, bookingId).catch(() => {});
    await logEventSafe(locals.runtime.env.DB, {
      registration_id: null,
      kind: 'course.checkout.error',
      source: 'system',
      payload: { error: String(err), product: SESSION_PRODUCT_SLUG },
    });
    const message = String(err).replace(/^Error:\s*/, '');
    return json({ error: `Could not start checkout: ${message}` }, 500);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
