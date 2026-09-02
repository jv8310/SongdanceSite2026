import type { APIRoute } from 'astro';
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
import { logEventSafe } from '../../../lib/registrations/db';
import {
  getProductById,
  getPublishedWorkshopBySlug,
  resolvePrice,
  upsertRegistration,
  setRegistrationPaymentStatus,
} from '../../../lib/workshops/db';
import { currencyForCountry } from '../../../lib/workshops/currency';
import { isMasterclassSlug, resolveWorkshopBumpProductId } from '../../../lib/workshops/bump';
import { runWorkshopPaidSideEffects } from '../../../lib/workshops/paid-handler';
import {
  applyDiscountPercent,
  resolveTicketDiscountPercent,
} from '../../../lib/workshops/discount';
import { resolveReferralForCheckout } from '../../../lib/workshops/share';

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
  company_name?: string; // B2B (masterclass)
  vat_number?: string; // B2B (masterclass)
  coupon?: string;
  discount?: string; // public ticket discount — only "50" is honored
  adiscount?: string; // owner secret ticket discount — any 1–100
  meta_event_id?: string;
  audience?: string; // door-set from the workshop page, e.g. "3" or "1,3"
  provider?: string; // 'stripe' (default) | 'paypal'
};

// Normalize the door-set to a sorted, deduped "1,3" form (doors 1–3 only).
// Anything else — junk, empty, tampered values — collapses to null.
function normalizeAudience(raw: string): string | null {
  const doors = Array.from(
    new Set(
      raw
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((d) => d === 1 || d === 2 || d === 3),
    ),
  ).sort();
  return doors.length ? doors.join(',') : null;
}

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
  const companyName = (payload.company_name ?? '').trim();
  const vatNumber = (payload.vat_number ?? '').trim().replace(/\s+/g, '');
  const coupon = (payload.coupon ?? '').trim();
  const metaEventId = (payload.meta_event_id ?? '').trim() || null;
  const audience = normalizeAudience(payload.audience ?? '');
  const provider = parseProvider(payload.provider);
  if (provider === 'paypal' && !paypalConfigured(env)) {
    return json({ error: 'PayPal is not available right now. Please pay by card.' }, 400);
  }

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
    await logEventSafe(env.DB, { registration_id: null, kind: 'workshop.price.missing', payload: { slug, currency } });
    return json({ error: 'Pricing isn’t available right now. Please email info@songdance.co.' }, 500);
  }

  const isMasterclass = isMasterclassSlug(ticketProduct.slug);

  // ── Ticket discount (?discount=50 public · ?adiscount=N owner) ─────────
  // Applies to the TICKET only; the order bump is never discounted. The
  // promo(s) are folded in here, now that we know the product: the launch sale
  // for any ticket, plus — for a masterclass — its standalone launch offer,
  // which keeps the masterclass at 50% after the launch sale closes. A public
  // ?discount=50 "share with a friend" link STACKS on the promo (75% while it
  // runs); a bespoke ?adiscount=N (owner) link is the better of it and the promo.
  const discountPct = resolveTicketDiscountPercent(
    { discount: payload.discount, adiscount: payload.adiscount },
    Date.now(),
    { isMasterclass },
  );
  const ticketAmountMinor = applyDiscountPercent(ticketPrice.amountMinor, discountPct);

  // The bump: the workshop's own, or — for a masterclass without one — the
  // default pack, so it's offered (and chargeable) on masterclass dates too.
  // Resolved through the shared helper, which is also what the registration
  // calendar prices and what paid-handler tags, so the three can't drift.
  const bumpProductId = await resolveWorkshopBumpProductId(
    env.DB,
    workshop,
    ticketProduct.slug,
  );

  // Resolve the bump only if there is one and the buyer opted in.
  let bumpProduct = null;
  let bumpPrice = null;
  if (wantsBump && bumpProductId) {
    bumpProduct = await getProductById(env.DB, bumpProductId);
    bumpPrice = await resolvePrice(env.DB, bumpProductId, ticketPrice.currency);
  }
  const realBump = !!(bumpProduct && bumpPrice);

  // Did a friend's share link bring them here? The sd_ref cookie was set when
  // they landed on it (see src/middleware.ts) and outlives that visit, so this
  // credits the sale even when they came back days later on a bare URL. Never
  // credits the sharer their own re-registration.
  const referral = await resolveReferralForCheckout(
    env.DB,
    env.ADMIN_SESSION_SECRET,
    request,
    email,
  );

  const { id: registrationId, token: accessToken } = await upsertRegistration(env.DB, {
    workshop_id: workshop.id,
    name,
    email,
    phone: (payload.phone ?? '').trim() || null,
    country,
    currency: ticketPrice.currency,
    timezone,
    company_name: companyName || null,
    vat_number: vatNumber || null,
    wants_bump: realBump,
    source_tag: workshop.source_tag,
    audience,
    referred_by_id: referral?.referredById ?? null,
    referral_channel: referral?.channel ?? null,
  });

  // ── Free-coupon path: skip Stripe, grant access immediately. ──────────
  if (coupon && workshop.free_coupon && coupon === workshop.free_coupon) {
    await setRegistrationPaymentStatus(env.DB, registrationId, 'coupon');
    await logEventSafe(env.DB, {
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
    return json({ redirect_url: `${base}/workshop/success?t=${accessToken}` });
  }

  // ── Paid path. ────────────────────────────────────────────────────────
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const totalMinor = ticketAmountMinor + (realBump ? bumpPrice!.amountMinor : 0);
  const lineCurrency = ticketPrice.currency.toLowerCase();

  // ── Fully-discounted (£0) path: comp the seat, skip the gateway. ───────
  // A 100% ticket discount (e.g. ?adiscount=100) with no paid bump leaves
  // nothing to charge. Both Stripe and PayPal REJECT a zero-amount checkout, so
  // the gateway call would throw and surface "We couldn't start checkout" —
  // exactly what a fully-comped registrant hit. So when there's nothing to
  // charge, grant access immediately, the same way the free-coupon path above
  // does. (Ticking the order bump pushes totalMinor above zero, so a paid bump
  // still goes through checkout normally — which is why it worked with the
  // journey added but failed on the bare free ticket.)
  if (totalMinor === 0) {
    await setRegistrationPaymentStatus(env.DB, registrationId, 'coupon');
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'workshop.free.granted',
      external_id: `workshop-free-${registrationId}`,
      payload: {
        workshop_id: workshop.id,
        registration_id: registrationId,
        discount_pct: discountPct || null,
      },
    });
    const ctx: any = locals.runtime?.ctx;
    const sideEffects = runWorkshopPaidSideEffects(env, { registrationId });
    if (ctx?.waitUntil) ctx.waitUntil(sideEffects);
    else await sideEffects.catch(() => {});
    return json({ redirect_url: `${base}/workshop/success?t=${accessToken}` });
  }

  // ── PayPal branch (one-off ticket + optional bump). Item names feed the
  //    PayPal→Quaderno connector; success lands on the same /workshop/success.
  if (provider === 'paypal') {
    const ppItems = [
      {
        name: discountPct ? `${workshop.title} (${discountPct}% off)` : workshop.title,
        amountMinor: ticketAmountMinor,
        category: 'DIGITAL_GOODS' as const,
      },
      ...(realBump
        ? [
            {
              name: bumpProduct!.name,
              amountMinor: bumpPrice!.amountMinor,
              category: 'DIGITAL_GOODS' as const,
            },
          ]
        : []),
    ];
    let order;
    try {
      order = await createPaypalOrder({
        env,
        currency: ticketPrice.currency,
        items: ppItems,
        customId: encodeCustomId('workshop', registrationId),
        description: workshop.title,
        softDescriptor: 'SONGDANCE',
        invoiceId: `wreg-${registrationId}`,
        returnUrl: `${base}/api/payments/paypal-return?dest=${encodeURIComponent(`/workshop/success?t=${accessToken}`)}`,
        cancelUrl: `${base}/w/${workshop.slug}?canceled=1`,
        brandName: 'Songdance',
        payer: { email, countryCode: country ?? undefined },
        requestId: `wreg-${registrationId}-pp-${totalMinor}-${realBump ? 1 : 0}`,
      });
    } catch (err) {
      await logEventSafe(env.DB, { registration_id: null, kind: 'workshop.checkout.paypal.error', payload: { registration_id: registrationId, error: String(err) } });
      return json({ error: 'We couldn’t start PayPal checkout. Please try again, or pay by card.' }, 502);
    }
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'workshop.checkout.paypal.created',
      external_id: `workshop-checkout-pp-${registrationId}`,
      payload: { registration_id: registrationId, order_id: order.id, total_minor: totalMinor, currency: ticketPrice.currency, bump: realBump, discount_pct: discountPct || null },
    });
    return json({ checkout_url: order.approveUrl, registration_id: registrationId });
  }

  const lineItems = [
    {
      name: discountPct ? `${workshop.title} (${discountPct}% off)` : workshop.title,
      amount_cents: ticketAmountMinor,
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

  // B2B (masterclass): when a VAT number is given, pre-create a Stripe Customer
  // with the VAT as tax_id_data, so the Quaderno-Stripe sync issues the invoice
  // reverse-charge. Otherwise we just pass the email. Never block the
  // registration on customer creation — fall back to email on any error.
  let customerId: string | undefined;
  if (companyName || vatNumber) {
    const taxIdType = vatNumber ? stripeTaxIdTypeFor(country ?? '') : null;
    try {
      const cust = await createCustomer({
        secretKey: env.STRIPE_SECRET_KEY,
        email,
        name: companyName || name,
        country: country ?? undefined,
        description: companyName
          ? `${companyName} · ${name} · workshop reg ${registrationId}`
          : `${name} · workshop reg ${registrationId}`,
        tax_id:
          companyName && vatNumber && taxIdType
            ? { type: taxIdType, value: vatNumber }
            : undefined,
        metadata: {
          workshop_registration_id: String(registrationId),
          ...(companyName ? { company_name: companyName } : {}),
        },
        // Stable per registration: a retry reuses the same Stripe customer
        // rather than minting a new id each attempt (which would both pile up
        // duplicate customers and change the Checkout Session body, tripping
        // Stripe's idempotency check on the session retry).
        idempotencyKey: `wreg-cust-${registrationId}`,
      });
      customerId = cust.id;
    } catch (err) {
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'workshop.customer.error',
        payload: { registration_id: registrationId, error: String(err) },
      });
    }
  }

  let session;
  try {
    session = await createCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      enablePaypal: paypalEnabled(env),
      ...(customerId ? { customer: customerId } : { customer_email: email }),
      success_url: `${base}/workshop/success?t=${accessToken}&cs={CHECKOUT_SESSION_ID}`,
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
        audience: audience ?? '',
        total_minor: String(totalMinor),
        discount_pct: discountPct ? String(discountPct) : '',
      },
      idempotency_key: `wreg-${registrationId}-${totalMinor}-${realBump ? 1 : 0}`,
    });
  } catch (err) {
    await logEventSafe(env.DB, { registration_id: null, kind: 'workshop.checkout.error', payload: { registration_id: registrationId, error: String(err) } });
    return json({ error: 'We couldn’t start checkout. Please try again, or email info@songdance.co.' }, 502);
  }

  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'workshop.checkout.created',
    external_id: `workshop-checkout-${registrationId}`,
    payload: { registration_id: registrationId, session_id: session.id, total_minor: totalMinor, currency: ticketPrice.currency, bump: realBump, discount_pct: discountPct || null },
  });

  return json({ checkout_url: session.url, registration_id: registrationId });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
