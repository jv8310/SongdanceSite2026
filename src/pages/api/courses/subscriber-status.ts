// POST { email, currency?, country?, discount_percent? } → { variant, currency,
// offers, path?, course_portal_url? }. Drives the variant block on
// /courses/certification.
//
// Currency: detected from geo by default (US → USD, GB → GBP, else EUR),
// but the client may pass an explicit `currency` to override — used when
// the buyer changes the country dropdown on the form (and wants the prices
// to follow their billing country, not their IP).
//
// `path`: when the buyer's variant is offered the Certification path (the
// `cc-bundle` product), we attach its two-line-item pricing — cert at its
// standard price + the workshop-discounted 12-week, in the same currency. The
// discount only ever touches the 12-week portion; the cert/bundle sticker
// prices are unaffected. This is the same pricing the checkout re-derives.
//
// Failure mode: if Drip is unreachable, return variant E (newcomer) rather
// than blocking the visitor — better to show *some* offer than nothing.

import type { APIRoute } from 'astro';
import { getSubscriber } from '../../../lib/registrations/drip';
import {
  currencyForCountry,
  formatMoney,
  isSupportedCurrency,
} from '../../../lib/workshops/currency';
import {
  decideVariant,
  getBundleOffer,
  applyLaunchPromoToOffer,
  type Currency,
  type Offer,
} from '../../../lib/courses/variant';
import { parseUrlDiscountPercent } from '../../../lib/courses/twelve-week';
import { launchPromoActive } from '../../../lib/promo';
import {
  buildCertificationPathPricing,
  deriveTwelveWeekDiscount,
} from '../../../lib/courses/path';

export const prerender = false;

type Body = {
  email?: string;
  currency?: string;
  country?: string;
  discount_percent?: number | string;
};

function detectCurrency(locals: App.Locals, request: Request): Currency {
  const cf = (locals.runtime as any)?.cf;
  const cfCountry = (cf?.country as string | undefined) ?? null;
  const headerCountry = request.headers.get('CF-IPCountry');
  const raw = (cfCountry || headerCountry || '').toUpperCase();
  const cur = currencyForCountry(raw);
  return isSupportedCurrency(cur) ? (cur as Currency) : 'EUR';
}

function parseCurrency(raw: unknown): Currency | null {
  if (typeof raw === 'string' && isSupportedCurrency(raw)) {
    return raw.toUpperCase() as Currency;
  }
  return null;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Client-provided currency wins over geo so the country dropdown can
  // drive the displayed currency.
  const currency: Currency =
    parseCurrency(payload.currency) ?? detectCurrency(locals, request);

  const email = (payload.email ?? '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400);
  }

  const overridePercent = parseUrlDiscountPercent(payload.discount_percent);
  // The launch promo replaces the cert's mid-cohort price (50% off the list)
  // for display, unless a ?discount=N override is in play (which wins outright).
  const promoForCert = overridePercent === 0 && launchPromoActive();
  const promoOffers = (offers: Offer[]): Offer[] =>
    promoForCert ? offers.map((o) => applyLaunchPromoToOffer(o)) : offers;

  // The Certification path pricing, in the buyer's currency. Best-effort —
  // a DB hiccup must not block the offer (the client falls back to the flat
  // bundle price when `path` is missing).
  async function pathPricingFor(cur: Currency) {
    try {
      const eff = await deriveTwelveWeekDiscount(env.DB, email, overridePercent);
      return buildCertificationPathPricing(cur, eff);
    } catch {
      return undefined;
    }
  }

  try {
    const sub = await getSubscriber(
      { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID },
      email,
    );
    const decision = decideVariant(sub, {
      coursePortalUrl: env.SVH_CERT_PORTAL_URL,
      currency,
    });
    // Attach path pricing whenever the path (cc-bundle) is one of the offers.
    const offersHaveBundle = decision.offers.some((o) => o.slug === 'cc-bundle');
    const path = offersHaveBundle
      ? await pathPricingFor(decision.currency)
      : undefined;
    return json({ ...decision, offers: promoOffers(decision.offers), path });
  } catch (err) {
    // Soft failure — treat as newcomer so the page still works. Derive the
    // save amount from the offer itself so we don't drift when prices move.
    const bundle = getBundleOffer(currency);
    const save = (bundle.base_price - bundle.price) * 100;
    const fallbackOffer = promoForCert
      ? applyLaunchPromoToOffer(bundle)
      : {
          ...bundle,
          save_note: `Save ${formatMoney(save, currency)} — mid-cohort discount applied`,
        };
    return json({
      variant: 'E',
      currency,
      offers: [fallbackOffer],
      path: await pathPricingFor(currency),
      degraded: true,
      error: String(err),
    });
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
