// Course-checkout endpoint. Slimmer than the retreat checkout:
//   - no rooms / no tiers / no inventory
//   - B2C by default, B2B optional (company + EU VAT number attached to the
//     Stripe Customer as tax_id_data so Quaderno applies reverse-charge)
//
// Inputs come from the variant block on /courses/certification. The variant
// itself is recorded on the row so we can audit later why a person was
// offered the bundle vs. cert-only.
//
// payment_plan:
//   'full'        → one-off PaymentIntent via Stripe Checkout (mode=payment)
//   '3x'/'6x'/'12x' → monthly Subscription via Stripe Checkout
//                   (mode=subscription), cancels itself after N invoices.
//                   The 12-month ladder is hidden on the page unless the
//                   visitor arrives with `?installment=12`.
//
// Tax / Quaderno: every line item carries product_metadata.tax_class =
// 'eservice'. The Quaderno-Stripe sync reads this to apply destination-VAT
// rules for digital services (EU consumer → buyer-country VAT; EU business
// with VAT id → reverse-charge; non-EU → out of EU VAT scope).
//
// Every code path returns JSON on failure (never an HTML 500), so the
// frontend can render the actual error instead of the generic
// "could not reach the server" fallback that fires when res.json() throws.

import type { APIRoute } from 'astro';
import {
  createPendingCourseRegistration,
  attachStripeSessionToCourse,
  attachStripeSubscriptionToCourse,
  attachPaypalOrderToCourse,
  attachPaypalSubscriptionToCourse,
  type ActivateChoice,
  type CourseProductSlug,
  type PaymentPlan,
} from '../../../lib/courses/db';
import { logEventSafe } from '../../../lib/registrations/db';
import {
  createCheckoutSession,
  createCustomer,
  paypalEnabled,
  createSubscriptionCheckoutSession,
  stripeTaxIdTypeFor,
} from '../../../lib/registrations/stripe';
import {
  paypalConfigured,
  createOrder as createPaypalOrder,
  createSubscription as createPaypalSubscription,
} from '../../../lib/payments/paypal';
import { encodeCustomId, parseProvider } from '../../../lib/payments/provider';
import { findCountry } from '../../../lib/countries';
import { formatMoney, isSupportedCurrency } from '../../../lib/workshops/currency';
import {
  getBundleOffer,
  getCertOffer,
  applyLaunchPromoToOffer,
  decideVariant,
  type Currency,
  type InstallmentPlan,
  type Offer,
  type Variant,
} from '../../../lib/courses/variant';
import { getSubscriber } from '../../../lib/registrations/drip';
import { launchPromoActive, LAUNCH_PROMO_PERCENT } from '../../../lib/promo';
import {
  buildCertificationPathPricing,
  buildGermanCertificationPathPricing,
  deriveTwelveWeekDiscount,
  germanCertOffer,
  GERMAN_CERT_DISCOUNT_PERCENT,
  type CertificationPathPricing,
} from '../../../lib/courses/path';
import {
  resolveCourseDiscountPercent,
  isFreeCourseCheckout,
} from '../../../lib/courses/discount';
import { fulfilFreeCourseRegistration } from '../../../lib/courses/free-checkout';
import { edgeTimezone } from '../../../lib/geo';
import {
  deriveDeckGift,
  DECK_GIFT_BUMP_SLUG,
  normalizeDeckGiftShipping,
} from '../../../lib/courses/deck-promo';
import { bumpOffer, isBumpSlug, BUMPS, type BumpSlug } from '../../../lib/courses/bumps';

export const prerender = false;

// Resolve the installment ladder for the chosen payment plan. Returns null
// for 'full' (one-off) or when the offer doesn't carry that ladder.
function installmentPlanFor(
  offer: Offer,
  paymentPlan: PaymentPlan,
): InstallmentPlan | undefined {
  if (paymentPlan === '3x') return offer.installments;
  if (paymentPlan === '6x') return offer.installments_6x;
  if (paymentPlan === '12x') return offer.installments_12x;
  return undefined;
}

type Body = {
  product_slug?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string;       // ISO-2
  phone_country?: string; // ISO-2
  phone?: string;
  company_name?: string;
  vat_number?: string;
  activate_choice?: string;
  source_variant?: string;
  consent_terms?: boolean;
  payment_plan?: string;
  currency?: string;
  discount_percent?: number | string;
  adiscount_percent?: number | string;
  provider?: string; // 'stripe' (default) | 'paypal'
  // Order-bump slugs the buyer ticked ('asj' | 'grief'). Validated + priced
  // server-side; never discounted.
  bumps?: string[];
  // Song Deck gift shipping address (only meaningful while the gift window is
  // live; ignored otherwise). Verified client-side via /api/courses/verify-address.
  shipping_name?: string;
  shipping_line1?: string;
  shipping_line2?: string;
  shipping_city?: string;
  shipping_region?: string;
  shipping_postal_code?: string;
  shipping_country?: string; // ISO-2
  shipping_phone?: string;
  shipping_verified?: boolean;
};

function offerFor(productSlug: CourseProductSlug, currency: Currency): Offer {
  return productSlug === 'cc-bundle'
    ? getBundleOffer(currency)
    : getCertOffer(currency);
}

function applyDiscount(cents: number, pct: number): number {
  if (pct <= 0) return cents;
  return Math.round((cents * (100 - pct)) / 100);
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  // Wrap the whole handler in try/catch so any unexpected Stripe / D1 /
  // network error still surfaces as a JSON {error} the client can show,
  // instead of a 500 with HTML that res.json() would choke on.
  try {
    let payload: Body;
    try {
      payload = (await request.json()) as Body;
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const productSlug = (payload.product_slug ?? '').trim() as CourseProductSlug;
    const firstName = (payload.first_name ?? '').trim();
    const lastName = (payload.last_name ?? '').trim();
    const email = (payload.email ?? '').trim().toLowerCase();
    const countryCode = (payload.country ?? '').trim().toUpperCase();
    const phoneCountryCode = (payload.phone_country ?? '').trim().toUpperCase();
    const phoneLocal = (payload.phone ?? '').trim();
    const companyName = (payload.company_name ?? '').trim() || null;
    const vatNumberRaw = (payload.vat_number ?? '').trim().replace(/\s+/g, '');
    const vatNumber = vatNumberRaw ? vatNumberRaw.toUpperCase() : null;
    const paymentPlan: PaymentPlan =
      payload.payment_plan === '3x'
        ? '3x'
        : payload.payment_plan === '6x'
          ? '6x'
          : payload.payment_plan === '12x'
            ? '12x'
            : 'full';
    const currencyRaw = (payload.currency ?? '').toUpperCase();
    const currency: Currency = isSupportedCurrency(currencyRaw)
      ? (currencyRaw as Currency)
      : 'EUR';
    // ?discount=N (public, 1–99) or the owner's secret ?adiscount=N (1–100).
    // The secret param is the only route to 100% — a free checkout. For the
    // bundle/cert pricing below, only 1–99 is ever meaningful (a 100% request
    // is intercepted by the free-checkout branch before any pricing runs).
    const discountPct = resolveCourseDiscountPercent({
      discount: payload.discount_percent,
      adiscount: payload.adiscount_percent,
    });
    const provider = parseProvider(payload.provider);
    if (provider === 'paypal' && !paypalConfigured(env)) {
      return json({ error: 'PayPal is not available right now. Please pay by card.' }, 400);
    }

    if (productSlug !== 'cc-cert' && productSlug !== 'cc-bundle') {
      return json({ error: 'Unknown product.' }, 400);
    }
    if (!firstName || !lastName || !email) {
      return json(
        { error: 'First name, last name and email are required.' },
        400,
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Please enter a valid email address.' }, 400);
    }
    if (!countryCode || !findCountry(countryCode)) {
      return json({ error: 'Please select your country from the list.' }, 400);
    }
    if (!phoneCountryCode || !findCountry(phoneCountryCode) || !phoneLocal) {
      return json(
        { error: 'Please enter a phone number with country code.' },
        400,
      );
    }
    if (!payload.consent_terms) {
      return json({ error: 'Please agree to the terms to continue.' }, 400);
    }
    // VAT number requires a company; an isolated VAT without a company is
    // very likely a copy-paste mistake.
    if (vatNumber && !companyName) {
      return json(
        { error: 'Please add your company name to use a VAT number.' },
        400,
      );
    }
    // Lightweight VAT sanity check — Stripe will reject malformed VAT ids
    // with a less friendly message, so we filter the obvious garbage here.
    if (vatNumber && !/^[A-Z]{2}[A-Z0-9]{6,14}$/.test(vatNumber)) {
      return json(
        {
          error:
            'That VAT number does not look right. It should start with the two-letter country code (e.g. BE0123456789).',
        },
        400,
      );
    }

    const activateChoice: ActivateChoice | null =
      payload.activate_choice === 'now' || payload.activate_choice === 'wait'
        ? payload.activate_choice
        : null;

    const sourceVariant = isVariant(payload.source_variant)
      ? payload.source_variant
      : 'direct';

    const phoneCountry = findCountry(phoneCountryCode);
    const phoneE164 = phoneCountry
      ? `+${phoneCountry.dial}${phoneLocal.replace(/[^0-9]/g, '')}`
      : phoneLocal;

    // Free checkout (secret ?adiscount=100): nothing to charge, so fulfil the
    // registration directly instead of opening Stripe — always as a single
    // full €0 grant, never an installment plan. The buyer's activation choice
    // is preserved so Drip tags the certification path correctly. Same
    // paid-side effects (Drip access + SD-ORDER) run inside the helper.
    if (
      isFreeCourseCheckout({
        discount: payload.discount_percent,
        adiscount: payload.adiscount_percent,
      })
    ) {
      const result = await fulfilFreeCourseRegistration(
        env,
        {
          email,
          first_name: firstName,
          last_name: lastName,
          country: countryCode,
          phone: phoneE164,
          phone_country: phoneCountryCode,
          company_name: companyName,
          vat_number: vatNumber,
          product_slug: productSlug,
          activate_choice: activateChoice,
          source_variant: sourceVariant,
          timezone: edgeTimezone(locals),
          amount_cents: 0,
          currency,
          consent_terms: payload.consent_terms === true,
          payment_plan: 'full',
          installments_total: 1,
        },
        {
          thanksPath: '/courses/certification/thanks',
          originalAmountCents: offerFor(productSlug, currency).price_cents,
        },
      );
      return json(result);
    }

    // German 12-week graduate cross-sell (variant G): a buyer tagged
    // prodG_SVH_12w in Drip is offered the cert at 20% off and, on the path, the
    // English 12-week course at 75% off. Eligibility is a Drip tag, so we verify
    // it server-side here — never trusting the client's source_variant — exactly
    // as subscriber-status derived it, so the charge matches what was shown.
    // Only pay the Drip round-trip when the client actually claims variant G
    // (every other checkout is untouched). A tag miss / Drip hiccup falls back
    // to normal pricing: fail-closed, we never grant the discount unverified.
    let germanGrad = false;
    if (sourceVariant === 'G') {
      try {
        const sub = await getSubscriber(
          { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID },
          email,
        );
        germanGrad = decideVariant(sub, { currency }).variant === 'G';
      } catch {
        germanGrad = false;
      }
      if (!germanGrad) {
        await logEventSafe(env.DB, {
          registration_id: null,
          kind: 'course.checkout.german_unverified',
          source: 'system',
          payload: { email, product_slug: productSlug },
        });
      }
    }

    const baseOffer = offerFor(productSlug, currency);
    // Launch promo (cc-cert only here — the cc-bundle path is priced in path.ts):
    // pause the mid-cohort discount and price at 50% off the list/base. A
    // ?discount=N override wins outright, so only apply the promo when there's
    // no override. The bundle/path applies its own promo inside path.ts. A
    // verified German graduate is priced by germanCertOffer instead (below).
    const certPromoApplied =
      productSlug === 'cc-cert' && !germanGrad && discountPct === 0 && launchPromoActive();
    const offer =
      germanGrad && productSlug === 'cc-cert'
        ? germanCertOffer(currency)
        : certPromoApplied
          ? applyLaunchPromoToOffer(baseOffer)
          : baseOffer;

    // The installment ladder for the chosen plan (3 or 6 monthly payments),
    // or undefined for pay-in-full.
    const installmentPlan = installmentPlanFor(offer, paymentPlan);

    // For full pay we charge price_cents once. For an installment plan we
    // charge monthly_cents × count (total may differ by a few cents from the
    // pay-in-full price — see variant.ts).
    if (paymentPlan !== 'full' && !installmentPlan) {
      return json(
        { error: 'This product cannot be purchased in installments.' },
        400,
      );
    }
    // The Certification path (cc-bundle) is offered in full, 3×, or 6× — both
    // its lines carry a 3- and 6-month ladder, but no 12-month plan, so reject a
    // 12× request rather than mischarge against the old flat bundle ladder.
    if (productSlug === 'cc-bundle' && paymentPlan === '12x') {
      return json(
        { error: 'The certification path is available in full, 3, or 6 monthly payments.' },
        400,
      );
    }

    // Price the order. The bundle IS the "Certification path": both lines
    // re-derived server-side from the email so the charge always matches
    // eligibility — during a live workshop window the whole path takes 20%
    // off (CERT_PATH_DISCOUNT_PERCENT in path.ts), and a ?discount=N /
    // ?adiscount=N override takes its own percent off both lines. For cc-cert, the URL
    // ?discount=N still reduces the cert price as before; every monthly
    // installment is discounted.
    let pathPricing: CertificationPathPricing | null = null;
    let chargedPriceCents: number;
    let chargedMonthlyCents: number;
    if (productSlug === 'cc-bundle') {
      // A verified German graduate gets the cert (20% off) + English 12-week
      // (75% off) pairing; everyone else gets the workshop-window pricing (whole
      // path 20% off during a live window; a ?discount override touches only the
      // 12-week line).
      if (germanGrad) {
        pathPricing = buildGermanCertificationPathPricing(currency);
      } else {
        const eff = await deriveTwelveWeekDiscount(env.DB, email, discountPct);
        pathPricing = buildCertificationPathPricing(currency, eff);
      }
      chargedPriceCents = pathPricing.total_cents;
      // 6× draws the longer-term monthly; 3× (and the unused full case) the
      // standard one. installmentPlan below carries the matching count.
      chargedMonthlyCents =
        paymentPlan === '6x'
          ? pathPricing.total_monthly_6x_cents
          : pathPricing.total_monthly_cents;
    } else {
      // cc-cert. A verified German graduate's `offer` is already the 20%-off
      // cert (its list price stays as base_price for the receipt), so no URL
      // discount stacks on top; everyone else gets the ?discount / promo price.
      const certPct = germanGrad ? 0 : discountPct;
      chargedPriceCents = applyDiscount(offer.price_cents, certPct);
      chargedMonthlyCents = installmentPlan
        ? applyDiscount(installmentPlan.monthly_cents, certPct)
        : 0;
    }
    const totalAmountCents = installmentPlan
      ? chargedMonthlyCents * installmentPlan.count
      : chargedPriceCents;
    const installmentsTotal = installmentPlan ? installmentPlan.count : 1;

    // Discount facts for metadata + logging, unified across cert and path.
    // For the promo'd cc-cert, the "original" is the struck list/base price.
    const baseInstallmentPlan = installmentPlanFor(baseOffer, paymentPlan);
    // cc-cert German graduate: the struck "original" is the full cert list price
    // + full ladder (baseOffer), and the effective discount is the flat 20%.
    const effectiveDiscountPct = pathPricing
      ? pathPricing.discount.percent
      : germanGrad
        ? GERMAN_CERT_DISCOUNT_PERCENT
        : certPromoApplied
          ? LAUNCH_PROMO_PERCENT
          : discountPct;
    const originalFullCents = pathPricing
      ? pathPricing.base_total_cents
      : germanGrad
        ? baseOffer.base_price * 100
        : certPromoApplied
          ? baseOffer.base_price * 100
          : offer.price_cents;
    const originalMonthlyCents = pathPricing
      ? paymentPlan === '6x'
        ? pathPricing.base_total_monthly_6x_cents
        : pathPricing.base_total_monthly_cents
      : germanGrad
        ? baseInstallmentPlan?.monthly_cents ?? 0
        : certPromoApplied
          ? baseInstallmentPlan?.monthly_cents ?? 0
          : installmentPlan?.monthly_cents ?? 0;
    const originalAmountForPlan = installmentPlan
      ? originalMonthlyCents * installmentsTotal
      : originalFullCents;
    // Receipt line: spell out both courses for the path.
    const lineItemLabel =
      productSlug === 'cc-bundle'
        ? '12-Week Course + Certification Course'
        : offer.label;

    // ── Order bumps (one-time add-ons: ASJ / Grief) ────────────────────────
    // Validate the ticked slugs, price them server-side (never discounted), and
    // record them on the row so the paid-handler grants each in Drip. They ride
    // the charge as a separate line item (pay in full) or the first installment
    // invoice; amount_cents stays the course/path price only.
    const selectedBumps: BumpSlug[] = Array.isArray(payload.bumps)
      ? Array.from(new Set(payload.bumps.filter(isBumpSlug)))
      : [];
    const bumpOffers = selectedBumps.map((slug) => bumpOffer(slug, currency));
    const bumpTotalCents = bumpOffers.reduce((sum, b) => sum + b.price_cents, 0);
    // Widened to string: the zero-amount Song Deck gift row (below) shares this
    // list but is not a purchasable bump slug.
    const bumpRows: Array<{ slug: string; amount_cents: number }> = bumpOffers.map(
      (b) => ({ slug: b.slug, amount_cents: b.price_cents }),
    );
    const stripeBumpLineItems = bumpOffers.map((b) => ({
      name: BUMPS[b.slug].label,
      amount_cents: b.price_cents,
      currency: currency.toLowerCase(),
      quantity: 1,
      product_metadata: { tax_class: 'eservice', product_slug: BUMPS[b.slug].catalogSlug },
    }));
    const paypalBumpItems = bumpOffers.map((b) => ({
      name: BUMPS[b.slug].label,
      amountMinor: b.price_cents,
      category: 'DIGITAL_GOODS' as const,
    }));

    // Post-workshop Song Deck gift: live from the buyer's workshop start until
    // 1h after it ends (re-derived server-side, same links as the discount).
    // Recorded as a zero-amount bumps row; while live the checkout also collects
    // a shipping address so, on payment, the free deck order is placed directly
    // on Shopify (falling back to the SVH-BONUS claim email when Shopify isn't
    // configured or no address was given) — see src/lib/courses/deck-promo.ts.
    const deckGift = await deriveDeckGift(env.DB, email);
    const deckShipping = deckGift.active
      ? normalizeDeckGiftShipping({
          name: payload.shipping_name || `${firstName} ${lastName}`,
          line1: payload.shipping_line1,
          line2: payload.shipping_line2,
          city: payload.shipping_city,
          region: payload.shipping_region,
          postal_code: payload.shipping_postal_code,
          country: payload.shipping_country || countryCode,
          phone: payload.shipping_phone || phoneE164,
          verified: payload.shipping_verified,
        })
      : null;
    if (deckGift.active) {
      bumpRows.push({ slug: DECK_GIFT_BUMP_SLUG, amount_cents: 0 });
    }

    const registrationId = await createPendingCourseRegistration(env.DB, {
      email,
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      phone: phoneE164,
      phone_country: phoneCountryCode,
      company_name: companyName,
      vat_number: vatNumber,
      product_slug: productSlug,
      activate_choice: activateChoice,
      source_variant: sourceVariant,
      timezone: edgeTimezone(locals),
      bumps: bumpRows.length ? bumpRows : null,
      deck_gift_shipping: deckShipping,
      amount_cents: totalAmountCents,
      currency,
      consent_terms: payload.consent_terms === true,
      payment_plan: paymentPlan,
      installments_total: installmentsTotal,
      provider,
    });

    const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');

    // ── PayPal branch (direct gateway). One-off via Orders API, installments
    //    via Subscriptions API (total_cycles = N). Same receipt label as Stripe
    //    so PayPal's Quaderno connector builds the invoice correctly.
    if (provider === 'paypal') {
      const ppCancelParams = new URLSearchParams();
      if (discountPct > 0) ppCancelParams.set('discount', String(discountPct));
      if (paymentPlan === '12x') ppCancelParams.set('installment', '12');
      const ppCancelQuery = ppCancelParams.toString()
        ? `?${ppCancelParams.toString()}`
        : '';
      const returnUrl = `${baseUrl}/api/payments/paypal-return?dest=${encodeURIComponent('/courses/certification/thanks')}`;
      const cancelUrl = `${baseUrl}/courses/certification${ppCancelQuery}#register`;
      if (paymentPlan !== 'full' && installmentPlan) {
        const sub = await createPaypalSubscription({
          env,
          productName: lineItemLabel,
          productDescription: `${installmentPlan.count} monthly installments of ${formatMoney(chargedMonthlyCents, currency)}${
            bumpOffers.length
              ? ` + one-time add-ons (${formatMoney(bumpTotalCents, currency)})`
              : ''
          }`,
          planName: `${lineItemLabel} — ${installmentPlan.count}-month plan`,
          monthlyAmountMinor: chargedMonthlyCents,
          currency,
          installmentCount: installmentPlan.count,
          // Order bumps ride the first charge as the plan setup fee.
          setupFeeMinor: bumpTotalCents || undefined,
          customId: encodeCustomId('course', registrationId),
          returnUrl,
          cancelUrl,
          brandName: 'Songdance',
          subscriber: { email, firstName, lastName },
          requestId: `course-reg-${registrationId}-pp-${paymentPlan}`,
        });
        await attachPaypalSubscriptionToCourse(env.DB, registrationId, sub.subscriptionId);
        await logEventSafe(env.DB, {
          registration_id: null,
          kind: 'course.checkout.paypal.subscription.created',
          source: 'system',
          external_id: `local-course-pp-${registrationId}-${paymentPlan}`,
          payload: {
            course_registration_id: registrationId,
            subscription_id: sub.subscriptionId,
            product_slug: productSlug,
            currency,
            monthly_amount_cents: chargedMonthlyCents,
            installments_total: installmentPlan.count,
          },
        });
        return json({ checkout_url: sub.approveUrl, course_registration_id: registrationId });
      }
      const order = await createPaypalOrder({
        env,
        currency,
        items: [
          {
            name: lineItemLabel,
            description: companyName ? `Billed to ${companyName}` : undefined,
            amountMinor: chargedPriceCents,
            category: 'DIGITAL_GOODS',
          },
          ...paypalBumpItems,
        ],
        customId: encodeCustomId('course', registrationId),
        description: lineItemLabel,
        softDescriptor: 'SONGDANCE',
        invoiceId: `course-${registrationId}`,
        returnUrl,
        cancelUrl,
        brandName: 'Songdance',
        payer: { email, firstName, lastName, countryCode },
        requestId: `course-reg-${registrationId}-pp`,
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
          product_slug: productSlug,
          currency,
          amount_cents: chargedPriceCents,
        },
      });
      return json({ checkout_url: order.approveUrl, course_registration_id: registrationId });
    }

    // Pre-create the Stripe Customer so the email/name/country pre-fill on
    // the checkout page and Stripe can filter payment methods by country.
    // For subscription mode this is required (the customer carries the
    // payment method that future invoices charge against). For one-off
    // payments it's still nice-to-have but optional.
    //
    // When the buyer provides an EU/UK VAT number we attach it as
    // tax_id_data, which Quaderno reads from the Stripe customer to issue
    // a reverse-charge invoice.
    let customerId: string | undefined;
    const taxIdType = vatNumber
      ? stripeTaxIdTypeFor(vatNumber.slice(0, 2))
      : null;
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
          ? `${companyName} · ${firstName} ${lastName} · course reg ${registrationId}`
          : `${firstName} ${lastName} · course reg ${registrationId}`,
        tax_id:
          vatNumber && taxIdType
            ? { type: taxIdType, value: vatNumber }
            : undefined,
        metadata: {
          course_registration_id: String(registrationId),
          contact_first_name: firstName,
          contact_last_name: lastName,
          product_slug: productSlug,
          payment_plan: paymentPlan,
          // Quaderno reads `tax_class` from the customer too as a fallback
          // for products without explicit tax metadata.
          tax_class: 'eservice',
          ...(companyName ? { company_name: companyName } : {}),
          ...(vatNumber ? { vat_number: vatNumber } : {}),
        },
      });
      customerId = cust.id;
    } catch (err) {
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'stripe.customer.error',
        source: 'system',
        payload: {
          course_registration_id: registrationId,
          error: String(err),
        },
      });
      // For subscription mode the customer is mandatory — bail with a
      // visible error instead of silently falling back to customer_email.
      if (paymentPlan !== 'full') {
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
      product_slug: productSlug,
      activate_choice: activateChoice ?? '',
      source_variant: sourceVariant,
      payment_plan: paymentPlan,
      first_name: firstName,
      last_name: lastName,
      country: countryCode,
      phone: phoneE164,
      currency,
      tax_class: 'eservice',
      ...(selectedBumps.length ? { bumps: selectedBumps.join(',') } : {}),
      ...(deckGift.active ? { deck_gift: '1' } : {}),
      ...(companyName ? { company_name: companyName } : {}),
      ...(vatNumber ? { vat_number: vatNumber } : {}),
      ...(effectiveDiscountPct > 0
        ? {
            discount_percent: String(effectiveDiscountPct),
            ...(pathPricing
              ? { discount_kind: pathPricing.discount.kind }
              : germanGrad
                ? { discount_kind: 'german' }
                : certPromoApplied
                  ? { discount_kind: 'promo' }
                  : {}),
            original_amount_cents: String(originalAmountForPlan),
          }
        : {}),
    };

    // Preserve the discount — and the hidden 12-month unlock — on the cancel
    // URL so the buyer's price (and the plan they picked) doesn't silently
    // reset if they bail out and try again.
    const cancelParams = new URLSearchParams();
    if (discountPct > 0) cancelParams.set('discount', String(discountPct));
    if (paymentPlan === '12x') cancelParams.set('installment', '12');
    const cancelQuery = cancelParams.toString() ? `?${cancelParams.toString()}` : '';
    const successUrl = `${baseUrl}/courses/certification/thanks?session_id={CHECKOUT_SESSION_ID}`;

    // tax_class metadata is attached to the underlying Stripe Product so
    // Quaderno's sync picks it up on every Invoice generated from this
    // session (relevant for the recurring subscription too).
    const productMetadata: Record<string, string> = {
      tax_class: 'eservice',
      product_slug: productSlug,
    };

    if (paymentPlan !== 'full' && installmentPlan && customerId) {
      const session = await createSubscriptionCheckoutSession({
        secretKey: env.STRIPE_SECRET_KEY,
        customer: customerId,
        success_url: successUrl,
        cancel_url: `${baseUrl}/courses/certification${cancelQuery}#register`,
        product_name: offer.label,
        product_description: `${installmentPlan.count} monthly installments of ${formatMoney(chargedMonthlyCents, currency)}`,
        payment_intent_description: offer.label,
        product_metadata: productMetadata,
        monthly_amount_cents: chargedMonthlyCents,
        currency: currency.toLowerCase(),
        installment_count: installmentPlan.count,
        // Order bumps ride the first invoice as one-time line items.
        one_time_line_items: stripeBumpLineItems,
        metadata,
        idempotency_key: `course-reg-${registrationId}-${paymentPlan}${discountPct > 0 ? `-d${discountPct}` : ''}`,
      });

      await attachStripeSessionToCourse(env.DB, registrationId, session.id);
      if (session.subscription) {
        await attachStripeSubscriptionToCourse(
          env.DB,
          registrationId,
          session.subscription,
        );
      }

      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'course.checkout.subscription.created',
        source: 'system',
        external_id: `local-course-${registrationId}-${paymentPlan}`,
        payload: {
          course_registration_id: registrationId,
          session_id: session.id,
          subscription_id: session.subscription,
          product_slug: productSlug,
          currency,
          monthly_amount_cents: chargedMonthlyCents,
          installments_total: installmentPlan.count,
          activate_choice: activateChoice,
          source_variant: sourceVariant,
          company_name: companyName,
          vat_number: vatNumber,
          discount_percent: effectiveDiscountPct,
          original_monthly_amount_cents: originalMonthlyCents,
        },
      });

      return json({
        checkout_url: session.url,
        course_registration_id: registrationId,
      });
    }

    // Default path: one-off payment.
    const session = await createCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      enablePaypal: paypalEnabled(env),
      ...(customerId
        ? { customer: customerId }
        : { customer_email: email }),
      success_url: successUrl,
      cancel_url: `${baseUrl}/courses/certification${cancelQuery}#register`,
      payment_intent_description: offer.label,
      line_items: [
        {
          name: offer.label,
          description: companyName
            ? `${lineItemLabel} · Billed to ${companyName}`
            : productSlug === 'cc-bundle'
              ? lineItemLabel
              : undefined,
          amount_cents: chargedPriceCents,
          currency: currency.toLowerCase(),
          quantity: 1,
          product_metadata: productMetadata,
        },
        ...stripeBumpLineItems,
      ],
      metadata,
      idempotency_key: `course-reg-${registrationId}${discountPct > 0 ? `-d${discountPct}` : ''}`,
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
        product_slug: productSlug,
        currency,
        amount_cents: chargedPriceCents,
        activate_choice: activateChoice,
        source_variant: sourceVariant,
        company_name: companyName,
        vat_number: vatNumber,
        discount_percent: effectiveDiscountPct,
        original_amount_cents: originalFullCents,
      },
    });

    return json({
      checkout_url: session.url,
      course_registration_id: registrationId,
    });
  } catch (err) {
    // Best effort: log the error to D1 so we have a paper trail for prod
    // debugging, then surface a readable message to the user.
    try {
      await locals.runtime.env.DB.prepare(
        `INSERT INTO events (registration_id, kind, source, payload_json)
         VALUES (NULL, 'course.checkout.error', 'system', ?)`,
      )
        .bind(JSON.stringify({ error: String(err) }))
        .run();
    } catch {}
    const message = String(err).replace(/^Error:\s*/, '');
    return json(
      {
        error: `Could not start checkout: ${message}`,
      },
      500,
    );
  }
};

function isVariant(v: unknown): v is Variant {
  return (
    v === 'B1' ||
    v === 'B2' ||
    v === 'G' ||
    v === 'A' ||
    v === 'D' ||
    v === 'E' ||
    v === 'C'
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
