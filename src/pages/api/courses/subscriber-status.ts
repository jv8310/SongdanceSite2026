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
  bundleWorkshopDiscountCents,
  type Currency,
  type WorkshopDiscount,
} from '../../../lib/courses/variant';
import { listSecuredWorkshopLinksByEmail } from '../../../lib/workshops/db';
import {
  bestDiscountStatus,
  anchorMsFromWorkshop,
} from '../../../lib/courses/twelve-week';

export const prerender = false;

type Body = { email?: string; currency?: string };

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

  try {
    const sub = await getSubscriber(
      { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID },
      email,
    );
    const decision = decideVariant(sub, {
      coursePortalUrl: env.SVH_CERT_PORTAL_URL,
      currency,
    });
    const workshop_discount = await deriveWorkshopDiscount(env.DB, email, currency);
    return json({ ...decision, workshop_discount });
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

// The bundle's workshop discount: same 20%/48h window as the standalone
// 12-week course, derived from the buyer's secured workshop registrations.
// Soft-fails to "no discount" so a DB blip never blocks the page. The checkout
// endpoint re-derives this independently, so the price can't be spoofed.
async function deriveWorkshopDiscount(
  db: D1Database,
  email: string,
  currency: Currency,
): Promise<WorkshopDiscount> {
  try {
    const links = await listSecuredWorkshopLinksByEmail(db, email);
    const status = bestDiscountStatus(
      links.map((l) => anchorMsFromWorkshop(l.starts_at_utc, l.ends_at_utc)),
      Date.now(),
    );
    return {
      eligible: status.eligible,
      kind: status.kind,
      expires_at_ms: status.expiresAtMs,
      off_cents: status.eligible ? bundleWorkshopDiscountCents(currency) : 0,
    };
  } catch {
    return { eligible: false, kind: 'none', expires_at_ms: null, off_cents: 0 };
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
