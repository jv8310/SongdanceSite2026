import type { APIRoute } from 'astro';
import {
  getProductBySlug,
  getTierBySlug,
  computeTierAvailability,
  createPendingRegistration,
  attachStripeSession,
  attachPaypalOrder,
  logEventSafe,
  pickRoomForTier,
  getSpecialRoomByRole,
  type SpecialRole,
} from '../../../lib/registrations/db';
import {
  applyClaim,
  applyHolds,
  attachRegistration,
  countActiveOffersByTier,
  getLiveOfferByToken,
  releaseClaimCheckoutHold,
} from '../../../lib/registrations/waitlist';
import { edgeTimezone } from '../../../lib/geo';
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

export const prerender = false;

const HOLD_MINUTES = 30;

// Tier slugs eligible for each opt-in role.
const FIRE_KEEPER_TIERS = new Set(['common-space']);
const COOK_HELP_TIERS = new Set(['common-space', 'shared-bedroom']);

// Cook help: pay 30% less on the chosen tier. Fire keeper is a room
// upgrade only — no price change.
const COOK_HELP_DISCOUNT = 0.30;

// Secret Easter-egg discount, unlocked on the registration page by
// dragging the heart into the house. 10% off the running total.
const EASTER_EGG_DISCOUNT = 0.10;

type Body = {
  product_slug?: string;
  tier_slug?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string;          // ISO-2
  phone_country?: string;    // ISO-2
  phone?: string;            // local number, no dial prefix
  company_name?: string;
  vat_number?: string;
  dietary?: string;
  notes?: string;
  consent_framework?: boolean;
  consent_terms?: boolean;
  role?: SpecialRole | null;
  easter_egg_discount?: boolean;
  provider?: string; // 'stripe' (default) | 'paypal'
  claim_token?: string; // waiting-list claim link
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
  const firstName = (payload.first_name ?? '').trim();
  const lastName = (payload.last_name ?? '').trim();
  const email = (payload.email ?? '').trim().toLowerCase();
  const countryCode = (payload.country ?? '').trim().toUpperCase();
  const phoneCountryCode = (payload.phone_country ?? '').trim().toUpperCase();
  const phoneLocal = (payload.phone ?? '').trim();
  const companyName = (payload.company_name ?? '').trim();
  const vatNumber = (payload.vat_number ?? '').trim();
  const provider = parseProvider(payload.provider);
  if (provider === 'paypal' && !paypalConfigured(env)) {
    return json({ error: 'PayPal is not available right now. Please pay by card.' }, 400);
  }

  if (!productSlug || !tierSlug || !firstName || !lastName || !email) {
    return json(
      { error: 'first_name, last_name, email, product_slug and tier_slug are required' },
      400,
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400);
  }
  if (!countryCode || !findCountry(countryCode)) {
    return json({ error: 'Please select your country.' }, 400);
  }
  if (!phoneCountryCode || !findCountry(phoneCountryCode) || !phoneLocal) {
    return json({ error: 'Please enter a phone number with country code.' }, 400);
  }
  // Company and VAT are both optional; a VAT number only makes sense
  // alongside a company, so guard that direction. Billing address is
  // collected by Stripe.
  if (vatNumber && !companyName) {
    return json(
      { error: 'Please add your company name to use a VAT number.' },
      400,
    );
  }
  if (!payload.consent_framework || !payload.consent_terms) {
    return json(
      { error: 'Please confirm both agreements to continue.' },
      400,
    );
  }

  const product = await getProductBySlug(env.DB, productSlug);
  if (!product) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'checkout.product.unknown',
      payload: { product_slug: productSlug },
    });
    return json(
      { error: 'This retreat isn\'t available right now. Please refresh the page, or email info@songdance.co.' },
      404,
    );
  }

  const tier = await getTierBySlug(env.DB, product.id, tierSlug);
  if (!tier) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'checkout.tier.unknown',
      payload: { tier_slug: tierSlug, product_slug: productSlug },
    });
    return json(
      { error: 'This room option isn\'t available right now. Please refresh the page and try again, or email info@songdance.co.' },
      404,
    );
  }

  // Validate the opt-in role (fire keeper / cook help) against the chosen
  // tier. These rooms (Paviljoen, Room 5.2) are status='reserved' and
  // ignored by pickRoomForTier — they only get assigned via an explicit
  // opt-in here.
  const role: SpecialRole | null =
    payload.role === 'fire_keeper' || payload.role === 'cook_help'
      ? payload.role
      : null;

  if (role === 'fire_keeper' && !FIRE_KEEPER_TIERS.has(tierSlug)) {
    return json(
      { error: 'The fire keeper role is only available with the Budget Room option.' },
      400,
    );
  }
  if (role === 'cook_help' && !COOK_HELP_TIERS.has(tierSlug)) {
    return json(
      { error: 'Kitchen help is only available with the Budget Room or Shared Room.' },
      400,
    );
  }

  // A place promised to someone on the waiting list is off sale until their
  // offer lapses. The person holding the claim link is the exception: their
  // own hold is excluded and the room their offer names is granted to them
  // (applyClaim) — the same rule the form drew its availability from. Whether
  // the house physically has that room is settled by pickRoomForTier below.
  const claim = await resolveClaim(env.DB, product.id, payload.claim_token);
  // A second run at the same claim link replaces the first, rather than
  // holding a second room alongside it.
  await releaseClaimCheckoutHold(env.DB, claim);
  const waitlistHolds = await countActiveOffersByTier(env.DB, product.id, {
    exceptEntryId: claim?.id ?? null,
  });
  const heldForWaitlist = waitlistHolds.get(tier.id) ?? 0;
  if (heldForWaitlist > 0) {
    const rawAvailability = await computeTierAvailability(env.DB, product.id);
    const availability = applyClaim(applyHolds(rawAvailability, waitlistHolds), claim);
    const tierAvail = availability.find((a) => a.tier.id === tier.id);
    if (!tierAvail || tierAvail.remaining <= 0) {
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'checkout.tier.held_for_waitlist',
        payload: { tier_slug: tierSlug, held_for_waitlist: heldForWaitlist },
      });
      return json(
        {
          error:
            'That room is being held for someone on the waiting list. Please choose another, or put your name down and we\'ll come back to you.',
        },
        409,
      );
    }
  }

  // Pick the room: special role overrides the auto-pick.
  let room;
  if (role === 'fire_keeper') {
    room = await getSpecialRoomByRole(env.DB, product.id, 'fire_keeper');
    if (!room) {
      return json(
        { error: 'The fire keeper place was just taken. Please uncheck that option and try again.' },
        409,
      );
    }
  } else if (role === 'cook_help') {
    room = await getSpecialRoomByRole(env.DB, product.id, 'cook_help');
    if (!room) {
      return json(
        { error: 'The kitchen-help place was just taken. Please uncheck that option and try again.' },
        409,
      );
    }
  } else {
    // Standard auto-pick: "preserve solo, fill shared rooms first" — see
    // pickRoomForTier in db.ts for the priority ladder.
    room = await pickRoomForTier(env.DB, product.id, tierSlug);
    if (!room) {
      return json(
        { error: 'This room option is fully booked. Please choose another, or email info@songdance.co to join the waitlist.' },
        409,
      );
    }
  }

  // Cook help: 30% off the tier price. Fire keeper: no discount (it's a
  // room upgrade, not a price cut).
  const roleDiscountCents =
    role === 'cook_help'
      ? Math.round(tier.price_cents * COOK_HELP_DISCOUNT)
      : 0;
  const amountCents = tier.price_cents - roleDiscountCents;

  // Secret Easter-egg discount: 10% off the running total, applied after
  // any role discount. Unlocked client-side, re-applied (and re-priced)
  // here so the charged amount is always computed server-side.
  const easterEgg = payload.easter_egg_discount === true;
  const easterEggDiscountCents = easterEgg
    ? Math.round(amountCents * EASTER_EGG_DISCOUNT)
    : 0;
  const finalAmountCents = amountCents - easterEggDiscountCents;

  const phoneCountry = findCountry(phoneCountryCode);
  const phoneE164 = phoneCountry
    ? `+${phoneCountry.dial}${phoneLocal.replace(/[^0-9]/g, '')}`
    : phoneLocal;

  // The receipt line — reused as the PaymentIntent / PayPal item name so the
  // Quaderno connector (Stripe or PayPal) picks it up as the invoice line.
  const baseLineItemName =
    role === 'fire_keeper'
      ? `${product.name} — ${tier.name} (fire keeper, Pavilion)`
      : role === 'cook_help'
        ? `${product.name} — ${tier.name} (with kitchen help, 30% off)`
        : `${product.name} — ${tier.name}`;
  const lineItemName = easterEgg
    ? `${baseLineItemName} (10% discount)`
    : baseLineItemName;

  const registrationId = await createPendingRegistration(env.DB, {
    product_id: product.id,
    tier_id: tier.id,
    inventory_unit_id: room.id,
    first_name: firstName,
    last_name: lastName,
    email,
    phone: phoneE164,
    phone_country: phoneCountryCode,
    country: countryCode,
    timezone: edgeTimezone(locals),
    company_name: companyName || null,
    vat_number: vatNumber || null,
    address: null,
    dietary: payload.dietary?.trim() || null,
    notes: payload.notes?.trim() || null,
    consent_framework: payload.consent_framework === true,
    consent_terms: payload.consent_terms === true,
    role,
    role_discount_cents: roleDiscountCents,
    amount_cents: finalAmountCents,
    currency: product.currency,
    hold_minutes: HOLD_MINUTES,
    provider,
  });

  // A claimed place: remember which booking came out of the offer. The entry
  // stays `invited` — so the hold follows them through checkout — until the
  // payment lands (settleWaitlistOnPaid closes it).
  if (claim) {
    await attachRegistration(env.DB, claim.id, registrationId);
    await logEventSafe(env.DB, {
      registration_id: registrationId,
      kind: 'waitlist.claim.checkout',
      payload: { waitlist_id: claim.id, tier_slug: tier.slug },
    });
  }

  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');

  // ── PayPal branch (one-off retreat ticket; a physical event → physical
  //    goods). Same receipt line as Stripe so the PayPal→Quaderno invoice
  //    reads correctly. Gross-inclusive of 21% BE VAT (place-of-supply).
  if (provider === 'paypal') {
    const order = await createPaypalOrder({
      env,
      currency: product.currency,
      items: [
        {
          name: lineItemName,
          description: tier.description ?? undefined,
          amountMinor: finalAmountCents,
          category: 'PHYSICAL_GOODS',
        },
      ],
      customId: encodeCustomId('retreat', registrationId),
      description: lineItemName,
      softDescriptor: 'SONGDANCE',
      invoiceId: `reg-${registrationId}`,
      returnUrl: `${baseUrl}/api/payments/paypal-return?dest=${encodeURIComponent('/registrations/thanks')}`,
      cancelUrl: `${baseUrl}/retreats/ritual-of-belonging#register`,
      brandName: 'Songdance',
      payer: { email, firstName, lastName, countryCode },
      requestId: `reg-${registrationId}-pp`,
    });
    await attachPaypalOrder(env.DB, registrationId, order.id);
    await logEventSafe(env.DB, {
      registration_id: registrationId,
      kind: 'checkout.paypal.order.created',
      external_id: `local-checkout-pp-${registrationId}`,
      payload: {
        order_id: order.id,
        tier: tier.slug,
        auto_assigned_room: room.name,
        auto_assigned_room_id: room.id,
        role: role ?? null,
        amount_cents: finalAmountCents,
      },
    });
    return json({ checkout_url: order.approveUrl, registration_id: registrationId });
  }

  // Always pre-create a Stripe Customer with everything we already know so
  // Stripe Checkout pre-fills email, name and country (and for B2B also
  // attaches the VAT number as a tax_id). The Quaderno-Stripe integration
  // reads these fields off the customer to produce the right invoice.
  //
  // Tax note: this retreat is a physical event in Belgium, so under EU VAT
  // Directive Art. 53 the place-of-supply is Belgium for both B2C and B2B
  // (no reverse-charge for event tickets). All prices are gross-inclusive
  // of 21% Belgian VAT regardless of the buyer's country — Quaderno is
  // configured to apply that rate when it generates the invoice.
  let customerId: string | undefined;
  const taxIdType = vatNumber ? stripeTaxIdTypeFor(countryCode) : null;
  try {
    // For B2B, the billing name should be the company; for B2C it's the
    // person. Either way, country is set so Checkout filters payment
    // methods (Bancontact for BE, iDEAL for NL, etc.) without the buyer
    // needing to pick a country first.
    const billingName = companyName || `${firstName} ${lastName}`;
    const cust = await createCustomer({
      secretKey: env.STRIPE_SECRET_KEY,
      email,
      name: billingName,
      phone: phoneE164,
      country: countryCode,
      description: companyName
        ? `${companyName} · ${firstName} ${lastName} · reg ${registrationId}`
        : `${firstName} ${lastName} · reg ${registrationId}`,
      tax_id:
        companyName && vatNumber && taxIdType
          ? { type: taxIdType, value: vatNumber }
          : undefined,
      metadata: {
        registration_id: String(registrationId),
        contact_first_name: firstName,
        contact_last_name: lastName,
        ...(companyName ? { company_name: companyName } : {}),
      },
    });
    customerId = cust.id;
  } catch (err) {
    // Don't block the registration on customer creation — log and fall
    // back to customer_email. The VAT (if any) is still in our D1 row.
    await logEventSafe(env.DB, {
      registration_id: registrationId,
      kind: 'stripe.customer.error',
      payload: { error: String(err) },
    });
  }

  const session = await createCheckoutSession({
    secretKey: env.STRIPE_SECRET_KEY,
    enablePaypal: paypalEnabled(env),
    ...(customerId
      ? { customer: customerId }
      : { customer_email: email }),
    success_url: `${baseUrl}/registrations/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/retreats/ritual-of-belonging#register`,
    payment_intent_description: lineItemName,
    line_items: [
      {
        name: lineItemName,
        description: tier.description ?? undefined,
        amount_cents: finalAmountCents,
        currency: product.currency.toLowerCase(),
        quantity: 1,
      },
    ],
    metadata: {
      registration_id: String(registrationId),
      product_slug: product.slug,
      tier_slug: tier.slug,
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      phone: phoneE164,
      company_name: companyName,
      vat_number: vatNumber,
      role: role ?? '',
      role_discount_cents: String(roleDiscountCents),
      easter_egg_discount_cents: String(easterEggDiscountCents),
    },
    idempotency_key: `reg-${registrationId}`,
  });

  await attachStripeSession(env.DB, registrationId, session.id);
  await logEventSafe(env.DB, {
    registration_id: registrationId,
    kind: 'checkout.session.created',
    external_id: `local-checkout-${registrationId}`,
    payload: {
      session_id: session.id,
      tier: tier.slug,
      auto_assigned_room: room.name,
      auto_assigned_room_id: room.id,
      role: role ?? null,
      amount_cents: finalAmountCents,
      role_discount_cents: roleDiscountCents,
      easter_egg_discount_cents: easterEggDiscountCents,
    },
  });

  return json({ checkout_url: session.url, registration_id: registrationId });
};

// A waiting-list claim link, if it's real, live, and for this retreat.
async function resolveClaim(
  db: D1Database,
  productId: number,
  token: string | null | undefined,
) {
  if (!token) return null;
  const entry = await getLiveOfferByToken(db, token);
  return entry && entry.product_id === productId ? entry : null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
