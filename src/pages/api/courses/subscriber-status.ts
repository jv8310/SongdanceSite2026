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
  currencyForCountry,
  formatMoney,
  isSupportedCurrency,
} from '../../../lib/workshops/currency';
import {
  decideVariant,
  getBundleOffer,
  type Currency,
} from '../../../lib/courses/variant';

export const prerender = false;

type Body = { email?: string; currency?: string };

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

  try {
    const sub = await getSubscriber(
      { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID },
      email,
    );
    const decision = decideVariant(sub, {
      coursePortalUrl: env.SVH_CERT_PORTAL_URL,
      currency,
    });
    return json(decision);
  } catch (err) {
    // Soft failure — treat as newcomer so the page still works. Derive the
    // save amount from the offer itself so we don't drift when prices move.
    const bundle = getBundleOffer(currency);
    const save = (bundle.base_price - bundle.price) * 100;
    return json({
      variant: 'E',
      currency,
      offers: [
        {
          ...bundle,
          save_note: `Save ${formatMoney(save, currency)} — mid-cohort discount applied`,
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
