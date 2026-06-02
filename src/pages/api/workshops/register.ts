import type { APIRoute } from 'astro';
import { createCheckoutSession } from '../../../lib/registrations/stripe';
import { logEvent } from '../../../lib/registrations/db';
import {
  getProductById,
  getPublishedWorkshopBySlug,
  resolvePrice,
  upsertRegistration,
  setRegistrationPaymentStatus,
} from '../../../lib/workshops/db';
import { currencyForCountry } from '../../../lib/workshops/currency';
import { runWorkshopPaidSideEffects } from '../../../lib/workshops/paid-handler';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Body = {
  workshop_slug?: string;
  name?: string;
  email?: string;
  phone?: string;
  country?: string; // ISO-2
  timezone?: string; // IANA
  bump?: boolean;
  coupon?: string;
  meta_event_id?: string;
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const slug = (payload.workshop_slug ?? '').trim();
  const name = (payload.name ?? '').trim();
  const email = (payload.email ?? '').trim().toLowerCase();
  const country = (payload.country ?? '').trim().toUpperCase() || null;
  const timezone = (payload.timezone ?? '').trim() || null;
  const wantsBump = payload.bump === true;
  const coupon = (payload.coupon ?? '').trim();
  const metaEventId = (payload.meta_event_id ?? '').trim() || null;

  if (!slug || !name || !EMAIL_RE.test(email)) {
    return json({ error: 'Please enter your name and a valid email address.' }, 400);
  }

  const workshop = await getPublishedWorkshopBySlug(env.DB, slug);
  if (!workshop || !workshop.main_product_id) {
    return json({ error: 'This workshop isn’t open for registration right now.' }, 404);
  }

  const currency = currencyForCountry(country);

  const ticketProduct = await getProductById(env.DB, workshop.main_product_id);
  const ticketPrice = await resolvePrice(env.DB, workshop.main_product_id, currency);
  if (!ticketProduct || !ticketPrice) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.price.missing', payload: { slug, currency } });
    return json({ error: 'Pricing isn’t available right now. Please email info@songdance.co.' }, 500);
  }

  // Resolve the bump only if the workshop has one and the buyer opted in.
  let bumpProduct = null;
  let bumpPrice = null;
  if (wantsBump && workshop.bump_product_id) {
    bumpProduct = await getProductById(env.DB, workshop.bump_product_id);
    bumpPrice = await resolvePrice(env.DB, workshop.bump_product_id, ticketPrice.currency);
  }
  const realBump = !!(bumpProduct && bumpPrice);

  const registrationId = await upsertRegistration(env.DB, {
    workshop_id: workshop.id,
    name,
    email,
    phone: (payload.phone ?? '').trim() || null,
    country,
    currency: ticketPrice.currency,
    timezone,
    wants_bump: realBump,
    source_tag: workshop.source_tag,
  });

  // ── Free-coupon path: skip Stripe, grant access immediately. ──────────
  if (coupon && workshop.free_coupon && coupon === workshop.free_coupon) {
    await setRegistrationPaymentStatus(env.DB, registrationId, 'coupon');
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'workshop.coupon.redeemed',
      external_id: `workshop-coupon-${registrationId}`,
      payload: { workshop_id: workshop.id, registration_id: registrationId },
    });
    const ctx: any = locals.runtime?.ctx;
    const sideEffects = runWorkshopPaidSideEffects(env, { registrationId });
    if (ctx?.waitUntil) ctx.waitUntil(sideEffects);
    else await sideEffects.catch(() => {});
    const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
    return json({ redirect_url: `${base}/workshop/success?rid=${registrationId}` });
  }

  // ── Paid path: Stripe Checkout. ───────────────────────────────────────
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const totalMinor = ticketPrice.amountMinor + (realBump ? bumpPrice!.amountMinor : 0);
  const lineCurrency = ticketPrice.currency.toLowerCase();

  const lineItems = [
    {
      name: workshop.title,
      amount_cents: ticketPrice.amountMinor,
      currency: lineCurrency,
      quantity: 1,
      product_metadata: { tax_class: ticketProduct.tax_code },
    },
    ...(realBump
      ? [
          {
            name: bumpProduct!.name,
            amount_cents: bumpPrice!.amountMinor,
            currency: lineCurrency,
            quantity: 1,
            product_metadata: { tax_class: bumpProduct!.tax_code },
          },
        ]
      : []),
  ];

  let session;
  try {
    session = await createCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      customer_email: email,
      success_url: `${base}/workshop/success?rid=${registrationId}&cs={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/w/${workshop.slug}?canceled=1`,
      payment_intent_description: workshop.title,
      line_items: lineItems,
      metadata: {
        workshop_registration_id: String(registrationId),
        workshop_id: String(workshop.id),
        bump: realBump ? bumpProduct!.slug : '',
        country: country ?? '',
        currency: ticketPrice.currency,
        timezone: timezone ?? '',
        meta_event_id: metaEventId ?? '',
        source_tag: workshop.source_tag ?? '',
        total_minor: String(totalMinor),
      },
      idempotency_key: `wreg-${registrationId}-${totalMinor}-${realBump ? 1 : 0}`,
    });
  } catch (err) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.checkout.error', payload: { registration_id: registrationId, error: String(err) } });
    return json({ error: 'We couldn’t start checkout. Please try again, or email info@songdance.co.' }, 502);
  }

  await logEvent(env.DB, {
    registration_id: null,
    kind: 'workshop.checkout.created',
    external_id: `workshop-checkout-${registrationId}`,
    payload: { registration_id: registrationId, session_id: session.id, total_minor: totalMinor, currency: ticketPrice.currency, bump: realBump },
  });

  return json({ checkout_url: session.url, registration_id: registrationId });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
