// POST { email, currency? } → { variant, currency, offers, twelve_week_week?, course_portal_url? }
// Drives the variant block on /courses/certification.
//
// Currency: detected from geo by default (US → USD, GB → GBP, else EUR),
// but the client may pass an explicit `currency` to override — used when
// the buyer changes the country dropdown on the form (and wants the prices
// to follow their billing country, not their IP).
//
// Failure mode: if Drip is unreachable, return variant E (newcomer) rather
// than blocking the visitor — better to show *some* offer than nothing.

import type { APIRoute } from 'astro';
import { getSubscriber } from '../../../lib/registrations/drip';
import {
  decideVariant,
  getBundleOffer,
  type Currency,
} from '../../../lib/courses/variant';
import {
  listSecuredWorkshopLinksByEmail,
  listReplayViewAnchorsByEmail,
} from '../../../lib/workshops/db';
import {
  twelveWeekCurrencyForCountry,
  priceCents,
  monthlyCents,
  applyPercentCents,
  bestDiscountStatus,
  anchorMsFromWorkshop,
  effectiveTwelveWeekDiscount,
  parseUrlDiscountPercent,
  INSTALLMENT_COUNT,
} from '../../../lib/courses/twelve-week';

export const prerender = false;

type Body = {
  email?: string;
  currency?: string;
  country?: string;
  discount_percent?: number | string;
};

// The discounted 12-week course, surfaced on the cert page when the email has a
// live workshop discount (or a ?discount= override). The cert/bundle prices are
// untouched — the discount only ever reduces the 12-week price.
async function buildTwelveWeekOffer(
  env: App.Locals['runtime']['env'],
  email: string,
  countryCode: string,
  overridePercent: number,
) {
  const links = await listSecuredWorkshopLinksByEmail(env.DB, email);
  const replayAnchors = await listReplayViewAnchorsByEmail(env.DB, email);
  const workshopStatus = bestDiscountStatus(
    [
      ...links.map((l) => anchorMsFromWorkshop(l.starts_at_utc, l.ends_at_utc)),
      ...replayAnchors,
    ],
    Date.now(),
  );
  const eff = effectiveTwelveWeekDiscount(workshopStatus, overridePercent);
  if (!eff.eligible) return undefined;

  const code = (countryCode || links[0]?.country || '').toUpperCase();
  const currency = twelveWeekCurrencyForCountry(code);
  const baseFull = priceCents(currency);
  const baseMonthly = monthlyCents(currency);
  return {
    currency,
    base_full_cents: baseFull,
    price_cents: applyPercentCents(baseFull, eff.percent),
    base_monthly_cents: baseMonthly,
    monthly_cents: applyPercentCents(baseMonthly, eff.percent),
    installment_count: INSTALLMENT_COUNT,
    discount: {
      eligible: true,
      percent: eff.percent,
      kind: eff.kind,
      expires_at_ms: eff.expiresAtMs,
    },
  };
}

function detectCurrency(locals: App.Locals, request: Request): Currency {
  const cf = (locals.runtime as any)?.cf;
  const cfCountry = (cf?.country as string | undefined) ?? null;
  const headerCountry = request.headers.get('CF-IPCountry');
  const raw = (cfCountry || headerCountry || '').toUpperCase();
  if (raw === 'US') return 'USD';
  if (raw === 'GB') return 'GBP';
  return 'EUR';
}

function parseCurrency(raw: unknown): Currency | null {
  if (raw === 'USD' || raw === 'GBP' || raw === 'EUR') return raw;
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
  const headerCountry = request.headers.get('CF-IPCountry') ?? '';
  const countryCode = (payload.country || headerCountry || '').toUpperCase();

  try {
    const sub = await getSubscriber(
      { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID },
      email,
    );
    const decision = decideVariant(sub, {
      coursePortalUrl: env.SVH_CERT_PORTAL_URL,
      currency,
    });
    // Already-enrolled (variant C) folks have moved past the foundation — no
    // 12-week cross-sell for them.
    const twelve_week_offer =
      decision.variant === 'C'
        ? undefined
        : await buildTwelveWeekOffer(env, email, countryCode, overridePercent);
    return json({ ...decision, twelve_week_offer });
  } catch (err) {
    // Soft failure — treat as newcomer so the page still works. Derive the
    // save amount from the offer itself so we don't drift when prices move.
    const bundle = getBundleOffer(currency);
    const symbol = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : '€';
    const save = bundle.base_price - bundle.price;
    return json({
      variant: 'E',
      currency,
      offers: [
        {
          ...bundle,
          save_note: `Save ${symbol}${save} — mid-cohort discount applied`,
        },
      ],
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
