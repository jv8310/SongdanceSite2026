// POST { email, country? } → pricing for the 12-Week SVH course, including the
// workshop-linked discount (auto-applied by email match).
//
// The price is revealed once an email is entered. If that email holds a secured
// seat at a workshop, a 20% discount is live — before the workshop (no
// countdown) and for 48h after it (with a countdown). The discount and its
// expiry are derived here server-side; the checkout endpoint re-derives them
// independently, so the displayed price can never be spoofed into the charge.

import type { APIRoute } from 'astro';
import {
  twelveWeekCurrencyForCountry,
  priceCents,
  monthlyCents,
  installmentTotalCents,
  applyDiscountCents,
  bestDiscountStatus,
  anchorMsFromWorkshop,
  DISCOUNT_PERCENT,
  INSTALLMENT_COUNT,
} from '../../../lib/courses/twelve-week';
import { listSecuredWorkshopLinksByEmail } from '../../../lib/workshops/db';

export const prerender = false;

type Body = { email?: string; country?: string };

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const email = (payload.email ?? '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400);
  }

  try {
    const links = await listSecuredWorkshopLinksByEmail(env.DB, email);
    const discount = bestDiscountStatus(
      links.map((l) => anchorMsFromWorkshop(l.starts_at_utc, l.ends_at_utc)),
      Date.now(),
    );

    // Currency: explicit country wins, then the country on their workshop
    // registration, then the edge geo header, else EUR.
    const headerCountry = request.headers.get('CF-IPCountry') ?? '';
    const countryCode = (
      payload.country ||
      links[0]?.country ||
      headerCountry ||
      ''
    ).toUpperCase();
    const currency = twelveWeekCurrencyForCountry(countryCode);

    const baseFull = priceCents(currency);
    const baseMonthly = monthlyCents(currency);
    const eligible = discount.eligible;

    // Best-effort name prefill from the workshop registration.
    const fullName = (links[0]?.name ?? '').trim();
    const [firstName, ...rest] = fullName ? fullName.split(/\s+/) : [];
    const lastName = rest.join(' ');

    return json({
      email,
      currency,
      price_cents: baseFull,
      installment_count: INSTALLMENT_COUNT,
      installment_monthly_cents: baseMonthly,
      installment_total_cents: installmentTotalCents(currency),
      discount: {
        eligible,
        kind: discount.kind,
        percent: eligible ? DISCOUNT_PERCENT : 0,
        expires_at_ms: discount.expiresAtMs,
        price_cents: eligible ? applyDiscountCents(baseFull) : baseFull,
        monthly_cents: eligible ? applyDiscountCents(baseMonthly) : baseMonthly,
      },
      first_name: firstName || undefined,
      last_name: lastName || undefined,
      country: countryCode || undefined,
    });
  } catch (err) {
    // Soft failure: still let the buyer see the (full) price rather than block.
    const currency = twelveWeekCurrencyForCountry((payload.country ?? '').toUpperCase());
    return json({
      email,
      currency,
      price_cents: priceCents(currency),
      installment_count: INSTALLMENT_COUNT,
      installment_monthly_cents: monthlyCents(currency),
      installment_total_cents: installmentTotalCents(currency),
      discount: {
        eligible: false,
        kind: 'none',
        percent: 0,
        expires_at_ms: null,
        price_cents: priceCents(currency),
        monthly_cents: monthlyCents(currency),
      },
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
