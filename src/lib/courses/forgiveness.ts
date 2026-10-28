// The Forgiveness Course — four live sessions on Zoom with Daniela Hess & Jacob,
// December 2026, lifetime access to the replays.
//
// Sold like the Grief Course (./grief.ts): one product, one price, full payment
// only, B2C by default with an optional company + VAT number, the URL discount
// (`?discount=N`) and the owner's free link (`?adiscount=100`). The ASJ and
// Grief order bumps (./bumps.ts) ride the same checkout, as on the 12-week and
// certification checkouts.
//
// Where the buyer goes: the member app. A paid `forgiveness-course` row opens
// the course `forgiveness-course` in the CiRCLE (songdance-app,
// SITE_SLUG_TO_PRODUCTS), and the four sessions live on the app's calendar,
// tagged with that product, so the Zoom link is handed out there. The replays
// become the course's four lessons. Nothing here touches Zoom.
//
// The dates are Jacob's Google Calendar ("Forgiveness Course 1" … "4"), read on
// 28 October 2026: 19:00–21:00 Brussels time. Stored as UTC instants so every
// page and email prints them on the reader's own clock (formatInTz).
//
// On payment the shared paid-handler tags the Drip subscriber with
// `prod_Forgiveness` and the site sends the buyer's confirmation itself (Drip
// has no workflow for this course): ./emails/confirmation.ts.

import {
  currencyForCountry,
  isSupportedCurrency,
  type SupportedCurrency,
} from '../workshops/currency';
import { formatInTz } from '../workshops/time';

export type ForgivenessCurrency = SupportedCurrency;

export const FORGIVENESS_PRODUCT_SLUG = 'forgiveness-course';
export const FORGIVENESS_DRIP_TAG = 'prod_Forgiveness';
export const FORGIVENESS_DRIP_EVENT = 'Completed Forgiveness course registration';
export const FORGIVENESS_LABEL = 'The Forgiveness Course';

// Regional price points (major units), on the same EUR-relative ratios as the
// rest of the catalogue (grief.ts, the albums), rounded to clean headline
// numbers. Price points, NOT runtime FX: edit a number to retune a market.
export const FORGIVENESS_PRICE: Record<ForgivenessCurrency, number> = {
  EUR: 147,
  USD: 147,
  GBP: 129,
  CAD: 215,
  CHF: 139,
  AUD: 245,
  NZD: 275,
  NOK: 1695,
  SEK: 1645,
  DKK: 1095,
};

export type ForgivenessSession = {
  n: 1 | 2 | 3 | 4;
  title: string;
  startsAtUtc: string;
  endsAtUtc: string;
};

// The four live sessions. 19:00–21:00 in Brussels (CET, UTC+1 in December).
export const FORGIVENESS_SESSIONS: ForgivenessSession[] = [
  { n: 1, title: 'The dynamics of forgiveness', startsAtUtc: '2026-12-06T18:00:00Z', endsAtUtc: '2026-12-06T20:00:00Z' },
  { n: 2, title: 'Forgiving others', startsAtUtc: '2026-12-09T18:00:00Z', endsAtUtc: '2026-12-09T20:00:00Z' },
  { n: 3, title: 'Forgiving self', startsAtUtc: '2026-12-13T18:00:00Z', endsAtUtc: '2026-12-13T20:00:00Z' },
  { n: 4, title: 'Forgiving separation', startsAtUtc: '2026-12-16T18:00:00Z', endsAtUtc: '2026-12-16T20:00:00Z' },
];

export const FORGIVENESS_SESSION_MINUTES = 120;

// The day range in words, for headlines: "6–16 December 2026".
export const FORGIVENESS_DATES_LABEL = '6–16 December 2026';

// Registration stays open until the last session has ended: someone who joins
// after the first class still receives everything (the replays are posted
// within 24 hours, and the rest is live).
export function forgivenessRegistrationOpen(nowMs: number = Date.now()): boolean {
  const last = FORGIVENESS_SESSIONS[FORGIVENESS_SESSIONS.length - 1];
  return nowMs < Date.parse(last.endsAtUtc);
}

// The sessions still ahead (none once the last has started).
export function upcomingForgivenessSessions(nowMs: number = Date.now()): ForgivenessSession[] {
  return FORGIVENESS_SESSIONS.filter((s) => Date.parse(s.startsAtUtc) > nowMs);
}

// One session as a reader in `timezone` sees it: "Sunday" · "6 December" ·
// "19:00 Brussels time" (the city, on that place's own clock — formatInTz).
// An unknown zone falls back to Brussels, the clock the sessions are held on.
export type ForgivenessSessionView = ForgivenessSession & {
  weekday: string;
  date: string;
  time: string;
  // "Sun 6 Dec, 19:00 Brussels time", for one-line lists.
  short: string;
};

export function forgivenessSessionsIn(timezone: string | null | undefined): ForgivenessSessionView[] {
  let tz = (timezone || '').trim() || 'Europe/Brussels';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
  } catch {
    tz = 'Europe/Brussels';
  }
  const part = (iso: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...o }).format(new Date(iso));
  return FORGIVENESS_SESSIONS.map((s) => ({
    ...s,
    weekday: part(s.startsAtUtc, { weekday: 'long' }),
    date: part(s.startsAtUtc, { day: 'numeric', month: 'long' }),
    time: formatInTz(s.startsAtUtc, tz, { weekday: undefined, day: undefined, month: undefined, year: undefined }),
    short: formatInTz(s.startsAtUtc, tz, { year: undefined }),
  }));
}

export type ForgivenessOffer = {
  slug: typeof FORGIVENESS_PRODUCT_SLUG;
  label: string;
  currency: ForgivenessCurrency;
  price: number;
  price_cents: number;
};

export function forgivenessOffer(currency: ForgivenessCurrency): ForgivenessOffer {
  const price = FORGIVENESS_PRICE[currency];
  return {
    slug: FORGIVENESS_PRODUCT_SLUG,
    label: FORGIVENESS_LABEL,
    currency,
    price,
    price_cents: price * 100,
  };
}

// Country (ISO-2) → the currency we price the course in (US→USD, GB→GBP, …,
// everywhere we hold no price point → EUR).
export function forgivenessCurrencyForCountry(
  country: string | null | undefined,
): ForgivenessCurrency {
  const c = currencyForCountry(country);
  return isSupportedCurrency(c) ? c : 'EUR';
}
