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
import { getAlbum } from '../../../lib/music/db';
import { albumProductSlug } from '../../../lib/music/product';

export const prerender = false;

// Checkout for a music album bought on its own (from /music/<slug> or the
// /music listing). Simplest sibling of the journey checkout: one product, one
// EUR price (admin-set on the album row — no per-market price map, so the
// headline and the charge agree by being the same figure), full payment only,
// B2C. The registration rides the ordinary course_registrations machinery
// under product slug `album-<id>`; on payment the shared paid-handler applies
// the album's Drip tag, and the buyer's paid row itself is a second access key
// (src/lib/music/access.ts) — so the album plays the moment they return.
type Body = {
  album?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string; // ISO-2
  consent_terms?: boolean;
  provider?: string; // 'stripe' (default) | 'paypal'
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

    const albumId = (payload.album ?? '').trim().slice(0, 80);
    const album = albumId ? await getAlbum(env.DB, albumId) : null;
    const priceCents = album?.price_eur_cents ?? 0;
    if (!album || album.published !== 1 || priceCents <= 0) {
      return json({ error: 'This album is not available for purchase right now.' }, 400);
    }
    const slug = albumProductSlug(album.id);

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

    const label = `${album.title} — album`;
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
      amount_cents: priceCents,
      currency: 'EUR',
      consent_terms: payload.consent_terms === true,
      payment_plan: 'full',
      installments_total: 1,
      provider,
    });

    const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');
    // Back to the player page either way: ?welcome=1 shows the "payment
    // received — open it with your email" state on the gate.
    const successPath = `/music/${album.id}?welcome=1`;
    const cancelUrl = `${baseUrl}/music/${album.id}#get`;

    // ── PayPal branch (one-off). Same line-item label as Stripe so PayPal's
    //    Quaderno connector builds the invoice with the right name.
    if (provider === 'paypal') {
      const order = await createPaypalOrder({
        env,
        currency: 'EUR',
        items: [
          {
            name: label,
            amountMinor: priceCents,
            category: 'DIGITAL_GOODS',
          },
        ],
        customId: encodeCustomId('course', registrationId),
        description: label,
        softDescriptor: 'SONGDANCE',
        invoiceId: `album-${album.id}-${registrationId}`,
        returnUrl: `${baseUrl}/api/payments/paypal-return?dest=${encodeURIComponent(successPath)}`,
        cancelUrl,
        brandName: 'Songdance',
        payer: { email, firstName, lastName, countryCode },
        requestId: `album-${album.id}-reg-${registrationId}-pp`,
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
          currency: 'EUR',
          amount_cents: priceCents,
        },
      });
      return json({ checkout_url: order.approveUrl, course_registration_id: registrationId });
    }

    // Pre-create the Stripe Customer so name/email/country pre-fill.
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
      line_items: [
        {
          name: label,
          amount_cents: priceCents,
          currency: 'eur',
          quantity: 1,
          product_metadata: { tax_class: 'eservice', product_slug: slug },
        },
      ],
      metadata: {
        course_registration_id: String(registrationId),
        product_slug: slug,
        source_variant: 'direct',
        payment_plan: 'full',
        first_name: firstName,
        last_name: lastName,
        country: countryCode,
        currency: 'EUR',
        tax_class: 'eservice',
      },
      idempotency_key: `album-${album.id}-reg-${registrationId}`,
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
        currency: 'EUR',
        amount_cents: priceCents,
      },
    });

    return json({ checkout_url: session.url, course_registration_id: registrationId });
  } catch (err) {
    try {
      await locals.runtime.env.DB.prepare(
        `INSERT INTO events (registration_id, kind, source, payload_json)
         VALUES (NULL, 'course.checkout.error', 'system', ?)`,
      )
        .bind(JSON.stringify({ error: String(err), product: 'album' }))
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
