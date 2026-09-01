import type { APIRoute } from 'astro';
import {
  getProductBySlug,
  getTierBySlug,
  computeTierAvailability,
  createPendingRegistration,
  attachStripeSession,
  attachPaypalOrder,
  logEventSafe,
} from '../../../lib/registrations/db';
import {
  attachRegistration,
  countActiveOffersByTier,
  dateRangeLabel,
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
import {
  BANK_TRANSFER,
  encodeCustomId,
  parseProvider,
  wantsBankTransfer,
} from '../../../lib/payments/provider';
import {
  BANK_TRANSFER_HOLD_DAYS,
  BANK_TRANSFER_HOLD_MINUTES,
  bankTransferDetails,
  sendBankTransferInstructions,
} from '../../../lib/registrations/bank-transfer';
import { findCountry } from '../../../lib/countries';

export const prerender = false;

// The Dolphin & Sound Retreat offers three cabin types, each its own tier:
//   twin-lower   — twin cabin, lower deck (porthole)     · €1995 per person
//   twin-upper   — twin cabin, upper deck (sea views)    · €2495 per person
//   double-lower — double-bed cabin, lower deck          · €3990 for two
// Availability is driven by the smart room model (see migration 0025): twin
// cabins are sold bed-by-bed; the double cabin is sold as a whole unit. A
// fourth, non-public "single-lower" tier exists only for record-keeping.
const PRODUCT_SLUG = 'dolphin-and-sound-2026';
const PUBLIC_TIER_SLUGS = ['twin-lower', 'twin-upper', 'double-lower'] as const;
type PublicTierSlug = (typeof PUBLIC_TIER_SLUGS)[number];
const HOLD_MINUTES = 30;

// You may reserve your place with a 50% deposit and settle the balance before
// 1 September 2026 (mirrors the long-running deposit option on the old site).
const DEPOSIT_FRACTION = 0.5;
const BALANCE_DUE = 'before 1 September 2026';

// The double cabin is priced for two people sharing; everything else is
// per person. Used only for the human-readable label on the form.
function unitLabel(slug: string): string {
  return slug === 'double-lower' ? 'for two people' : 'per person';
}

// GET → per-cabin prices + live availability for the registration form.
//
// `?claim=<token>` is a waiting-list claim link: it excludes that person's own
// hold, so the cabin being kept for them reads as open — for them only.
export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;
  const product = await getProductBySlug(env.DB, PRODUCT_SLUG);
  if (!product) return json({ error: 'Unknown product' }, 404);

  const claim = await resolveClaim(env.DB, product.id, url.searchParams.get('claim'));
  const [rawAvailability, holds] = await Promise.all([
    computeTierAvailability(env.DB, product.id),
    countActiveOffersByTier(env.DB, product.id, { exceptEntryId: claim?.id ?? null }),
  ]);
  const bySlug = new Map(rawAvailability.map((a) => [a.tier.slug, a]));

  const tiers = PUBLIC_TIER_SLUGS.map((slug) => {
    const a = bySlug.get(slug);
    if (!a) return null;
    const price = a.tier.price_cents;
    // Places promised to people on the waiting list are not on sale.
    const remaining = Math.max(0, a.remaining - (holds.get(a.tier.id) ?? 0));
    return {
      slug,
      name: a.tier.name,
      price_cents: price,
      deposit_cents: Math.round(price * DEPOSIT_FRACTION),
      remaining,
      capacity: a.capacity,
      sold_out: remaining <= 0,
      unit_label: unitLabel(slug),
    };
  }).filter((t): t is NonNullable<typeof t> => t !== null);

  const totalRemaining = tiers.reduce((n, t) => n + Math.max(0, t.remaining), 0);

  return new Response(
    JSON.stringify({ tiers, total_remaining: totalRemaining, balance_due: BALANCE_DUE }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
};

type Body = {
  tier_slug?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string; // ISO-2
  phone_country?: string; // ISO-2
  phone?: string; // local number, no dial prefix
  company_name?: string;
  vat_number?: string;
  roommate_pref?: string;
  dietary?: string;
  notes?: string;
  payment_mode?: 'full' | 'deposit';
  consent_terms?: boolean;
  provider?: string; // 'stripe' (default) | 'paypal' | 'bank_transfer'
  claim_token?: string; // waiting-list claim link
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

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const tierSlug = (payload.tier_slug ?? '').trim() as PublicTierSlug;
  const firstName = (payload.first_name ?? '').trim();
  const lastName = (payload.last_name ?? '').trim();
  const email = (payload.email ?? '').trim().toLowerCase();
  const countryCode = (payload.country ?? '').trim().toUpperCase();
  const phoneCountryCode = (payload.phone_country ?? '').trim().toUpperCase();
  const phoneLocal = (payload.phone ?? '').trim();
  const companyName = (payload.company_name ?? '').trim();
  const vatNumber = (payload.vat_number ?? '').trim();
  const isDeposit = payload.payment_mode === 'deposit';
  // Three ways to pay. Bank transfer is not a gateway, so it is read
  // separately from parseProvider (which only ever yields stripe/paypal) and
  // short-circuits the whole gateway half of this handler further down.
  const byBankTransfer = wantsBankTransfer(payload.provider);
  const provider = byBankTransfer ? BANK_TRANSFER : parseProvider(payload.provider);
  if (provider === 'paypal' && !paypalConfigured(env)) {
    return json({ error: 'PayPal is not available right now. Please pay by card.' }, 400);
  }

  if (!PUBLIC_TIER_SLUGS.includes(tierSlug)) {
    return json({ error: 'Please choose a cabin.' }, 400);
  }
  if (!firstName || !lastName || !email) {
    return json({ error: 'Please fill in your first name, last name and email.' }, 400);
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
  if (vatNumber && !companyName) {
    return json(
      { error: 'Please add your company name to use a VAT number.' },
      400,
    );
  }
  if (!payload.consent_terms) {
    return json({ error: 'Please agree to the terms and conditions to continue.' }, 400);
  }

  const product = await getProductBySlug(env.DB, PRODUCT_SLUG);
  if (!product) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'checkout.product.unknown',
      payload: { product_slug: PRODUCT_SLUG },
    });
    return json(
      { error: 'This retreat isn\'t available right now. Please refresh, or email info@songdance.co.' },
      404,
    );
  }

  const tier = await getTierBySlug(env.DB, product.id, tierSlug);
  if (!tier) {
    return json(
      { error: 'This cabin isn\'t available right now. Please refresh, or email info@songdance.co.' },
      404,
    );
  }

  // Capacity guard — computed from the room model so cross-cabin coupling
  // (a solo-locked double, the reserved host cabin) is respected, then minus
  // any place currently promised to someone on the waiting list. A claim link
  // excludes its own hold, so the invited guest can book what's kept for them.
  const claim = await resolveClaim(env.DB, product.id, payload.claim_token);
  // A second run at the same claim link replaces the first, rather than
  // holding a second place alongside it.
  await releaseClaimCheckoutHold(env.DB, claim);
  const [availability, holds] = await Promise.all([
    computeTierAvailability(env.DB, product.id),
    countActiveOffersByTier(env.DB, product.id, { exceptEntryId: claim?.id ?? null }),
  ]);
  const tierAvail = availability.find((a) => a.tier.id === tier.id);
  const heldForWaitlist = holds.get(tier.id) ?? 0;
  if (!tierAvail || tierAvail.remaining - heldForWaitlist <= 0) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'checkout.tier.full',
      payload: { tier_slug: tierSlug, held_for_waitlist: heldForWaitlist },
    });
    const heldOut = !!tierAvail && tierAvail.remaining > 0;
    return json(
      {
        error: heldOut
          ? 'That cabin is being held for someone on the waiting list. Please choose another, or put your name down and we\'ll come back to you.'
          : 'That cabin is fully booked. Please choose another, or join the waiting list below.',
      },
      409,
    );
  }

  // No cabin is assigned yet. Policy ("free until paid"): a pending/unpaid
  // registration must not hold a cabin — the place stays open for others
  // until the deposit/payment actually lands, at which point the paid path
  // (Stripe webhook / PayPal fulfilment / admin "Mark paid") places the guest
  // via assignRoomOnPaid. The capacity guard above still blocks a genuinely
  // sold-out tier (counted from paid + held bookings).

  // Deposit = 50% now, balance settled before the cut-off. The balance is
  // tracked on the registration (balance_due_cents) so the admin can later
  // send a Stripe link for the remainder.
  const fullCents = tier.price_cents;
  const depositCents = Math.round(fullCents * DEPOSIT_FRACTION);
  const amountCents = isDeposit ? depositCents : fullCents;
  const balanceCents = isDeposit ? fullCents - depositCents : 0;
  const eur = (c: number) => `€${(c / 100).toFixed(2).replace(/\.00$/, '')}`;

  const depositNote = isDeposit
    ? `50% deposit paid (${eur(depositCents)}); balance ${eur(balanceCents)} due ${BALANCE_DUE}.`
    : null;
  const combinedNotes = [payload.notes?.trim() || null, depositNote]
    .filter(Boolean)
    .join(' — ') || null;

  const phoneCountry = findCountry(phoneCountryCode);
  const phoneE164 = phoneCountry
    ? `+${phoneCountry.dial}${phoneLocal.replace(/[^0-9]/g, '')}`
    : phoneLocal;

  // The receipt line — reused as the PaymentIntent / PayPal item name.
  const lineItemName = isDeposit
    ? `${product.name} — ${tier.name} (50% deposit, balance ${eur(balanceCents)} due ${BALANCE_DUE})`
    : `${product.name} — ${tier.name}`;

  const registrationId = await createPendingRegistration(env.DB, {
    product_id: product.id,
    tier_id: tier.id,
    inventory_unit_id: null,
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
    roommate_pref: payload.roommate_pref?.trim() || null,
    dietary: payload.dietary?.trim() || null,
    notes: combinedNotes,
    consent_framework: true,
    consent_terms: payload.consent_terms === true,
    amount_cents: amountCents,
    currency: product.currency,
    // A transfer takes days to arrive, so the place is held for days — at 30
    // minutes it would be resold under someone who has already sent the money.
    hold_minutes: byBankTransfer ? BANK_TRANSFER_HOLD_MINUTES : HOLD_MINUTES,
    balance_due_cents: balanceCents,
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

  // ── Bank-transfer branch. No gateway is touched at all: the booking is
  //    written (pending, held for BANK_TRANSFER_HOLD_DAYS above), the guest
  //    is emailed the account details, and the cabin is confirmed by hand
  //    from /admin/retreats/<slug> once the money lands — which is also when
  //    assignRoomOnPaid places them, exactly as on the paid gateway paths.
  if (byBankTransfer) {
    const details = bankTransferDetails({
      registrationId,
      amountCents,
      currency: product.currency,
      email,
    });
    await logEventSafe(env.DB, {
      registration_id: registrationId,
      kind: 'checkout.bank_transfer.created',
      external_id: `local-checkout-bt-${registrationId}`,
      payload: {
        tier: tier.slug,
        room_assignment: 'deferred-until-paid',
        payment_mode: isDeposit ? 'deposit' : 'full',
        amount_cents: amountCents,
        deposit_balance_cents: balanceCents,
        reference: details.reference,
        hold_days: BANK_TRANSFER_HOLD_DAYS,
      },
    });
    // A failed send is logged, not fatal — the booking stands and the details
    // are on screen either way.
    await sendBankTransferInstructions(env, {
      registration: {
        id: registrationId,
        email,
        first_name: firstName,
        name: `${firstName} ${lastName}`.trim(),
        amount_cents: amountCents,
        currency: product.currency,
      },
      retreat_name: product.name,
      when_label: dateRangeLabel(product.starts_at, product.ends_at),
      tier_name: tier.name,
      deposit_note: isDeposit
        ? `This is the 50% deposit. The remaining ${eur(balanceCents)} is due ${BALANCE_DUE}, and we'll send you a link for it nearer the time.`
        : null,
    });
    return json({
      bank_transfer: { ...details, hold_days: BANK_TRANSFER_HOLD_DAYS },
      registration_id: registrationId,
    });
  }

  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');

  // ── PayPal branch (one-off / 50% deposit). Same receipt line as Stripe so
  //    the PayPal→Quaderno invoice reads right; physical event → physical goods.
  if (provider === 'paypal') {
    const order = await createPaypalOrder({
      env,
      currency: product.currency,
      items: [
        {
          name: lineItemName,
          description: tier.description ?? undefined,
          amountMinor: amountCents,
          category: 'PHYSICAL_GOODS',
        },
      ],
      customId: encodeCustomId('retreat', registrationId),
      description: lineItemName,
      softDescriptor: 'SONGDANCE',
      invoiceId: `reg-${registrationId}`,
      returnUrl: `${baseUrl}/api/payments/paypal-return?dest=${encodeURIComponent('/registrations/thanks')}`,
      cancelUrl: `${baseUrl}/retreats/dolphin-and-sound#register`,
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
        room_assignment: 'deferred-until-paid',
        payment_mode: isDeposit ? 'deposit' : 'full',
        amount_cents: amountCents,
        deposit_balance_cents: balanceCents,
      },
    });
    return json({ checkout_url: order.approveUrl, registration_id: registrationId });
  }

  // Pre-create a Stripe Customer so Checkout pre-fills email/name/country
  // (and attaches the VAT number for B2B). Mirrors the château flow.
  let customerId: string | undefined;
  const taxIdType = vatNumber ? stripeTaxIdTypeFor(countryCode) : null;
  try {
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
    await logEventSafe(env.DB, {
      registration_id: registrationId,
      kind: 'stripe.customer.error',
      payload: { error: String(err) },
    });
  }

  const session = await createCheckoutSession({
    secretKey: env.STRIPE_SECRET_KEY,
    enablePaypal: paypalEnabled(env),
    ...(customerId ? { customer: customerId } : { customer_email: email }),
    success_url: `${baseUrl}/registrations/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/retreats/dolphin-and-sound#register`,
    payment_intent_description: lineItemName,
    line_items: [
      {
        name: lineItemName,
        description: tier.description ?? undefined,
        amount_cents: amountCents,
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
      payment_mode: isDeposit ? 'deposit' : 'full',
      deposit_balance_cents: String(balanceCents),
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
      room_assignment: 'deferred-until-paid',
      payment_mode: isDeposit ? 'deposit' : 'full',
      amount_cents: amountCents,
      deposit_balance_cents: balanceCents,
    },
  });

  return json({ checkout_url: session.url, registration_id: registrationId });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
