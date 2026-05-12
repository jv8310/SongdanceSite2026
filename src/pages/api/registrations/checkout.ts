import type { APIRoute } from 'astro';
import {
  getProductBySlug,
  getTierBySlug,
  getTierAvailability,
  createPendingRegistration,
  attachStripeSession,
  logEvent,
} from '../../../lib/registrations/db';
import { createCheckoutSession } from '../../../lib/registrations/stripe';

export const prerender = false;

const HOLD_MINUTES = 30;

type Body = {
  product_slug?: string;
  tier_slug?: string;
  name?: string;
  email?: string;
  phone?: string;
  country?: string;
  roommate_pref?: string;
  dietary?: string;
  notes?: string;
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const productSlug = (payload.product_slug ?? '').trim();
  const tierSlug = (payload.tier_slug ?? '').trim();
  const name = (payload.name ?? '').trim();
  const email = (payload.email ?? '').trim().toLowerCase();

  if (!productSlug || !tierSlug || !name || !email) {
    return json(
      { error: 'product_slug, tier_slug, name and email are required' },
      400,
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Invalid email' }, 400);
  }

  const product = await getProductBySlug(env.DB, productSlug);
  if (!product) return json({ error: 'Unknown product' }, 404);

  const tier = await getTierBySlug(env.DB, product.id, tierSlug);
  if (!tier) return json({ error: 'Unknown tier' }, 404);

  const avail = await getTierAvailability(env.DB, tier.id);
  if (avail.remaining <= 0) {
    return json(
      { error: 'This tier is fully booked. Please choose another tier or join the waitlist.' },
      409,
    );
  }

  const registrationId = await createPendingRegistration(env.DB, {
    product_id: product.id,
    tier_id: tier.id,
    name,
    email,
    phone: payload.phone?.trim() || null,
    country: payload.country?.trim() || null,
    roommate_pref: payload.roommate_pref?.trim() || null,
    dietary: payload.dietary?.trim() || null,
    notes: payload.notes?.trim() || null,
    amount_cents: tier.price_cents,
    currency: product.currency,
    hold_minutes: HOLD_MINUTES,
  });

  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const session = await createCheckoutSession({
    secretKey: env.STRIPE_SECRET_KEY,
    customer_email: email,
    success_url: `${baseUrl}/registrations/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/ritual-of-belonging#register`,
    line_items: [
      {
        name: `${product.name} — ${tier.name}`,
        description: tier.description ?? undefined,
        amount_cents: tier.price_cents,
        currency: product.currency.toLowerCase(),
        quantity: 1,
      },
    ],
    metadata: {
      registration_id: String(registrationId),
      product_slug: product.slug,
      tier_slug: tier.slug,
    },
    idempotency_key: `reg-${registrationId}`,
  });

  await attachStripeSession(env.DB, registrationId, session.id);
  await logEvent(env.DB, {
    registration_id: registrationId,
    kind: 'checkout.session.created',
    external_id: `local-checkout-${registrationId}`,
    payload: { session_id: session.id, tier: tier.slug },
  });

  return json({ checkout_url: session.url, registration_id: registrationId });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
