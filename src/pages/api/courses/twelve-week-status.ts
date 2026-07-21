// POST { email, country?, force_pro?, discount_percent? } → pricing for the
// 12-Week SVH course, including the workshop-linked discount (auto-applied by
// email match) and the certification course as a second, buyable offer — now
// offered to everyone, not just "pro" emails (`is_pro` is still reported for
// analytics / segmentation).
//
// The price is revealed once an email is entered. If that email holds a secured
// seat at a workshop (or has watched its replay), a 20% discount is live —
// before the workshop (no countdown) and for 48h after the later of the
// workshop end / last replay view (with a countdown). A `?discount=N` URL
// override (1–99) replaces that 20% with N% and carries no countdown.
//
// The discount only ever reduces the 12-week price — never the certification.
// All of it is re-derived in the checkout endpoint, so the displayed price can
// never be spoofed into the charge.

import type { APIRoute } from 'astro';
import {
  twelveWeekCurrencyForCountry,
  priceCents,
  monthlyCents,
  monthlyCents6x,
  monthlyCents12x,
  installmentTotalCents,
  applyPercentCents,
  bestDiscountStatus,
  anchorMsFromWorkshop,
  effectiveTwelveWeekDiscount,
  parseUrlDiscountPercent,
  INSTALLMENT_COUNT,
  INSTALLMENT_COUNT_6X,
  INSTALLMENT_COUNT_12X,
} from '../../../lib/courses/twelve-week';
import {
  listSecuredWorkshopLinksByEmail,
  listReplayViewAnchorsByEmail,
  emailIsProFromLinks,
} from '../../../lib/workshops/db';
import type { Currency } from '../../../lib/courses/variant';
import { buildCertificationPathPricing } from '../../../lib/courses/path';
import type { EffectiveDiscount } from '../../../lib/courses/twelve-week';
import { getSubscriber } from '../../../lib/registrations/drip';
import { eligibleBumpOffers } from '../../../lib/courses/bumps';
import { deckGiftStatus, DECK_GIFT_INACTIVE } from '../../../lib/courses/deck-promo';

export const prerender = false;

type Body = {
  email?: string;
  country?: string;
  force_pro?: boolean;
  discount_percent?: number | string;
};

// The certification course is only priced in EUR/USD/GBP; everything else maps
// to EUR (same as the certification page's own default).
function certCurrencyFor(currency: string): Currency {
  return currency === 'USD' ? 'USD' : currency === 'GBP' ? 'GBP' : 'EUR';
}

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

  const overridePercent = parseUrlDiscountPercent(payload.discount_percent);

  try {
    // Best-effort, kicked off concurrently with the DB lookups: read the
    // buyer's Drip tags so we only offer order bumps for products they don't
    // already own. `null` (Drip unreachable OR unknown email) → offer all.
    const subPromise = getSubscriber(
      { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID },
      email,
    ).catch(() => null);

    const links = await listSecuredWorkshopLinksByEmail(env.DB, email);
    const replayAnchors = await listReplayViewAnchorsByEmail(env.DB, email);
    // The 48h window restarts on the later of: workshop end, or replay view.
    const anchors = [
      ...links.map((l) => anchorMsFromWorkshop(l.starts_at_utc, l.ends_at_utc)),
      ...replayAnchors,
    ];
    const workshopStatus = bestDiscountStatus(anchors, Date.now());
    const eff = effectiveTwelveWeekDiscount(workshopStatus, overridePercent);

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

    // The Certification path is offered to everyone now (not just pro), so it's
    // always priced: cert (standard price) + the same workshop-discounted
    // 12-week, in the certification currency (EUR/USD/GBP). `is_pro` is still
    // reported (forced via ?audience=pro, or detected from a pro workshop door /
    // masterclass seat) for analytics / segmentation, but no longer gates the
    // offer.
    const isPro = payload.force_pro === true || emailIsProFromLinks(links);
    const path = buildCertificationPathPricing(certCurrencyFor(currency), eff);

    // Best-effort name prefill from the workshop registration.
    const fullName = (links[0]?.name ?? '').trim();
    const [firstName, ...rest] = fullName ? fullName.split(/\s+/) : [];
    const lastName = rest.join(' ');

    // Order bumps the buyer doesn't already own, priced in their currency.
    const sub = await subPromise;
    const bumps = eligibleBumpOffers(currency, sub ? sub.tags : null);

    const baseMonthly6x = monthlyCents6x(currency);
    const baseMonthly12x = monthlyCents12x(currency);

    return json({
      email,
      currency,
      price_cents: baseFull,
      installment_count: INSTALLMENT_COUNT,
      installment_monthly_cents: baseMonthly,
      installment_total_cents: installmentTotalCents(currency),
      // Longer installment ladders (6× / 12×). Shown on the page only when
      // unlocked by a hand-shared ?installment=6/12 link; always priced here so
      // the client has the figures ready when it is.
      installment_6x_count: INSTALLMENT_COUNT_6X,
      installment_monthly_6x_cents: baseMonthly6x,
      installment_12x_count: INSTALLMENT_COUNT_12X,
      installment_monthly_12x_cents: baseMonthly12x,
      discount: {
        eligible: eff.eligible,
        kind: eff.kind,
        percent: eff.percent,
        expires_at_ms: eff.expiresAtMs,
        price_cents: applyPercentCents(baseFull, eff.percent),
        monthly_cents: applyPercentCents(baseMonthly, eff.percent),
        monthly_6x_cents: applyPercentCents(baseMonthly6x, eff.percent),
        monthly_12x_cents: applyPercentCents(baseMonthly12x, eff.percent),
      },
      is_pro: isPro,
      bumps,
      path,
      // The post-workshop Song Deck gift window (start → end + 1h of the
      // buyer's live session). The checkout re-derives it, so this is display
      // truth only.
      deck_gift: deckGiftStatus(links),
      first_name: firstName || undefined,
      last_name: lastName || undefined,
      country: countryCode || undefined,
    });
  } catch (err) {
    // Soft failure: still let the buyer see the (full) price rather than block.
    const currency = twelveWeekCurrencyForCountry((payload.country ?? '').toUpperCase());
    const baseFull = priceCents(currency);
    const baseMonthly = monthlyCents(currency);
    // Honour a URL override even on the degraded path (no DB needed for it).
    const isPro = payload.force_pro === true;
    const degradedEff: EffectiveDiscount = {
      eligible: overridePercent > 0,
      percent: overridePercent,
      kind: overridePercent > 0 ? 'override' : 'none',
      expiresAtMs: null,
    };
    const baseMonthly6x = monthlyCents6x(currency);
    const baseMonthly12x = monthlyCents12x(currency);
    return json({
      email,
      currency,
      price_cents: baseFull,
      installment_count: INSTALLMENT_COUNT,
      installment_monthly_cents: baseMonthly,
      installment_total_cents: installmentTotalCents(currency),
      installment_6x_count: INSTALLMENT_COUNT_6X,
      installment_monthly_6x_cents: baseMonthly6x,
      installment_12x_count: INSTALLMENT_COUNT_12X,
      installment_monthly_12x_cents: baseMonthly12x,
      discount: {
        eligible: overridePercent > 0,
        kind: overridePercent > 0 ? 'override' : 'none',
        percent: overridePercent,
        expires_at_ms: null,
        price_cents: applyPercentCents(baseFull, overridePercent),
        monthly_cents: applyPercentCents(baseMonthly, overridePercent),
        monthly_6x_cents: applyPercentCents(baseMonthly6x, overridePercent),
        monthly_12x_cents: applyPercentCents(baseMonthly12x, overridePercent),
      },
      is_pro: isPro,
      // Drip wasn't consulted on the degraded path → offer all bumps (fail open).
      bumps: eligibleBumpOffers(currency, null),
      // The Certification path is offered to everyone — price it even here.
      path: buildCertificationPathPricing(certCurrencyFor(currency), degradedEff),
      deck_gift: DECK_GIFT_INACTIVE,
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
