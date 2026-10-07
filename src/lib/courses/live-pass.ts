// The live pass: the weekly Q&As and the monthly deepening session, bought as
// a NUMBER of sessions — for anyone whose course no longer includes them (or
// never did). Sold by the month, counted by the session:
//
//   1 month   €52                  4 Q&As and 1 deepening session
//   3 months  3 × €52, 15% off     €132    12 Q&As and 3 deepening sessions
//   6 months  6 × €52, 25% off     €234    24 Q&As and 6 deepening sessions
//
// A pass holds exactly that many sessions — the next ones on the member app's
// calendar from the day it starts — and access ends after the last of them
// (Jacob, October 2026). A week without a Q&A costs nobody a session, and two
// passes queue: the second picks up with the session after the first one's
// last. The sessions are counted by the member app (songdance-app,
// apps/api/src/lib/live-pass.ts), which holds the calendar; this site never
// knows which session a pass ends on, and never says so.
//
// Plus one add-on, sold only with a pass: **Extend my certification window**
// (+20% of the pass). It keeps the window to apply for certification open for
// the pass's months (1, 3 or 6, counted from the day its sessions start, behind
// any earlier pass's months) — for a 9-month (certification) student whose
// window has closed, and for the CEEE 2025 cohort, who hold the course without
// the right to certify (`cert_no_certification`). Nobody else is shown it: the
// page hides it until the address says they hold the certification course, and
// the checkout refuses it otherwise.
//
// Prices are floored to whole units (5 for the krona family), so the advertised
// discount is never under-delivered and the add-on never costs more than 20%:
// €132.60 → €132, and €26.40 → €26. Other currencies scale the €52 month with the
// albums' EUR-relative ratios (albumPriceCents) and take the same discounts.
//
// A pass starts on the day it is bought — unless the buyer's course still gives
// them the live sessions: then it starts the day after those end, so nobody
// pays twice for the same session and a pass always extends what they have.
// That means the certification course (site order, or the Drip-only holders)
// or the 12 weeks of a 12-week course bought on the site (a 12-week student's
// pass picks up where the 12 weeks end; the page also offers them the 9-month
// certification course). An earlier pass does not move the start: the member
// app queues the sessions, so a pass bought while another runs is never left
// with a gap between the two.
//
// The dates are computed at checkout (shown to the buyer before they pay) and
// again when the payment lands, and written onto the order (migration 0089,
// UTC instants bounding Brussels days): `access_starts_at` = the day the pass
// begins, which the member app reads to count its sessions from;
// `access_ends_at` = the end of the pass's months, which only the
// certification-window extension uses (the member app ignores it on a paid
// pass: the pass ends with its last session).
//
// Rides the ordinary course machinery under product slugs `live-pass-1m` /
// `-3m` / `-6m`; the add-on is a row in the `bumps` JSON (`cert-extension`), so
// every money report already counts it.

import { formatMoney, type SupportedCurrency } from '../workshops/currency';
import { businessDayOf, businessWindowUtc } from '../workshops/periods';
import { albumPriceCents } from '../music/product';
import { addDays, addMonths } from './cert-access';
import { parsePurchasedBumps } from './db';

export const LIVE_PASS_MONTHS = [1, 3, 6] as const;
export type LivePassMonths = (typeof LIVE_PASS_MONTHS)[number];

export const LIVE_PASS_MONTHLY_EUR_CENTS = 5200;
export const LIVE_PASS_DISCOUNT_PERCENT: Record<LivePassMonths, number> = { 1: 0, 3: 15, 6: 25 };
export const CERT_EXTENSION_PERCENT = 20;

export const LIVE_PASS_SLUG_PREFIX = 'live-pass-';
export const CERT_EXTENSION_SLUG = 'cert-extension';
export const LIVE_PASS_DRIP_TAG = 'prod_LivePass';
export const CERT_EXTENSION_DRIP_TAG = 'prod_CertExtension';
export const LIVE_PASS_DRIP_EVENT = 'Completed live pass purchase';
export const LIVE_PASS_PAGE_PATH = '/courses/live-pass';

export const CERT_EXTENSION_LABEL = 'Extend my certification window';

export function livePassSlug(months: LivePassMonths): `live-pass-${number}m` {
  return `live-pass-${months}m`;
}

export function isLivePassSlug(slug: string | null | undefined): boolean {
  return !!slug && livePassMonthsOf(slug) !== null;
}

export function livePassMonthsOf(slug: string | null | undefined): LivePassMonths | null {
  const m = /^live-pass-(\d+)m$/.exec(slug ?? '');
  const n = m ? Number(m[1]) : NaN;
  return (LIVE_PASS_MONTHS as readonly number[]).includes(n) ? (n as LivePassMonths) : null;
}

export function parseLivePassMonths(raw: unknown): LivePassMonths | null {
  const n = Number(raw);
  return (LIVE_PASS_MONTHS as readonly number[]).includes(n) ? (n as LivePassMonths) : null;
}

// What a pass holds: 4 Q&As and 1 deepening session a month. The member app
// counts the same numbers (packages/shared/src/products.ts, livePassSessions).
export const LIVE_PASS_SESSIONS_PER_MONTH = { qa: 4, deepening: 1 } as const;

export function livePassSessions(months: LivePassMonths): { qa: number; deepening: number } {
  return { qa: LIVE_PASS_SESSIONS_PER_MONTH.qa * months, deepening: LIVE_PASS_SESSIONS_PER_MONTH.deepening * months };
}

// "12 Q&As and 3 deepening sessions" — always in numerals.
export function livePassContents(months: LivePassMonths): string {
  const { qa, deepening } = livePassSessions(months);
  return `${qa} Q&As and ${deepening} deepening session${deepening === 1 ? '' : 's'}`;
}

export function livePassLabel(months: LivePassMonths): string {
  return months === 1 ? 'Live pass · 1 month' : `Live pass · ${months} months`;
}

// "Live pass · 3 months" for a live-pass slug, else null — for the label maps.
export function livePassLabelForSlug(slug: string): string | null {
  const months = livePassMonthsOf(slug);
  return months ? livePassLabel(months) : null;
}

// ── Prices ──────────────────────────────────────────────────────────────────

function stepCents(currency: SupportedCurrency): number {
  return (currency === 'NOK' || currency === 'SEK' || currency === 'DKK' ? 5 : 1) * 100;
}

function floorTo(cents: number, step: number): number {
  return Math.floor(cents / step) * step;
}

// One month at the full price, in a market.
export function livePassMonthlyCents(currency: SupportedCurrency): number {
  return albumPriceCents(LIVE_PASS_MONTHLY_EUR_CENTS, currency);
}

// The pass, discounted for its length and floored to a whole unit.
export function livePassPriceCents(months: LivePassMonths, currency: SupportedCurrency): number {
  const full = livePassMonthlyCents(currency) * months;
  return floorTo((full * (100 - LIVE_PASS_DISCOUNT_PERCENT[months])) / 100, stepCents(currency));
}

// The certification-window add-on: 20% of the pass it rides on, floored.
export function certExtensionPriceCents(months: LivePassMonths, currency: SupportedCurrency): number {
  return floorTo((livePassPriceCents(months, currency) * CERT_EXTENSION_PERCENT) / 100, stepCents(currency));
}

export type LivePassOffer = {
  months: LivePassMonths;
  currency: SupportedCurrency;
  price_cents: number;
  full_cents: number; // months × the monthly price, before the discount
  discount_percent: number;
  extension_cents: number;
};

export function livePassOffer(months: LivePassMonths, currency: SupportedCurrency): LivePassOffer {
  return {
    months,
    currency,
    price_cents: livePassPriceCents(months, currency),
    full_cents: livePassMonthlyCents(currency) * months,
    discount_percent: LIVE_PASS_DISCOUNT_PERCENT[months],
    extension_cents: certExtensionPriceCents(months, currency),
  };
}

export function livePassPriceLabel(months: LivePassMonths, currency: SupportedCurrency): string {
  return formatMoney(livePassPriceCents(months, currency), currency);
}

// ── The period ──────────────────────────────────────────────────────────────

// startsOn: the day the pass begins — the member app counts its sessions from
// here. endsOn: the last day of its months, counted from startsOn or from the
// day after an earlier pass's months, whichever is later — what the
// certification-window extension runs to. Both YYYY-MM-DD Brussels, inclusive.
export type LivePassPeriod = { startsOn: string; endsOn: string };

// The rule, as a pure function. `busyUntil` holds the last day of what already
// gives the buyer live sessions through a course (inclusive Brussels days): the
// pass starts the day after the latest of them, or today when they are all
// behind. `passesUntil` holds the last day of their earlier passes' months:
// those never move the start (the member app queues the sessions), only where
// this pass's own months — and so an extension bought with it — begin.
export function livePassPeriod(input: {
  today: string;
  months: LivePassMonths;
  busyUntil: Array<string | null | undefined>;
  passesUntil?: Array<string | null | undefined>;
}): LivePassPeriod {
  const after = (from: string, untils: Array<string | null | undefined>) => {
    let day = from;
    for (const until of untils) {
      if (!until) continue;
      const next = addDays(until, 1);
      if (next > day) day = next;
    }
    return day;
  };
  const startsOn = after(input.today, input.busyUntil);
  const monthsFrom = after(startsOn, input.passesUntil ?? []);
  return { startsOn, endsOn: addDays(addMonths(monthsFrom, input.months), -1) };
}

// The UTC instants written onto the order: the first moment of the first day
// and the first moment after the last day, both in Brussels.
export function livePassInstants(p: LivePassPeriod): { startsAt: string; endsAt: string } {
  const w = businessWindowUtc(p.startsOn, p.endsOn);
  return { startsAt: w.start as string, endsAt: w.end as string };
}

// ── Reading paid passes ─────────────────────────────────────────────────────

export type PaidLivePass = {
  id: number;
  email: string;
  months: LivePassMonths;
  certExtension: boolean;
  startsOn: string;
  endsOn: string;
  paidOn: string;
};

type PassRow = {
  id: number;
  email: string;
  product_slug: string;
  bumps: string | null;
  paid_at: string | null;
  created_at: string;
  access_starts_at?: string | null;
  access_ends_at?: string | null;
};

export function hasCertExtension(bumps: string | null | undefined): boolean {
  return parsePurchasedBumps(bumps ?? null).some((b) => b.slug === CERT_EXTENSION_SLUG);
}

function toPaidPass(r: PassRow): PaidLivePass | null {
  const months = livePassMonthsOf(r.product_slug);
  if (!months) return null;
  const paidOn = businessDayOf(r.paid_at ?? r.created_at);
  // The stored period, when the payment wrote one; otherwise (paid before
  // migration 0089, or the write failed) the plain rule from the paid day.
  let startsOn: string;
  let endsOn: string;
  if (r.access_starts_at && r.access_ends_at) {
    startsOn = businessDayOf(r.access_starts_at);
    endsOn = addDays(businessDayOf(r.access_ends_at), -1);
  } else {
    ({ startsOn, endsOn } = livePassPeriod({ today: paidOn, months, busyUntil: [] }));
  }
  return {
    id: r.id,
    email: r.email.trim().toLowerCase(),
    months,
    certExtension: hasCertExtension(r.bumps),
    startsOn,
    endsOn,
    paidOn,
  };
}

// Every paid pass (one address, or everyone), oldest first. Reads the period
// columns when they exist; a preview runs against the live D1 before migration
// 0089 is applied, so their absence falls back to the plain rule.
export async function listPaidLivePasses(db: D1Database, email?: string): Promise<PaidLivePass[]> {
  const slugs = LIVE_PASS_MONTHS.map(livePassSlug);
  const ph = slugs.map(() => '?').join(',');
  const byEmail = email ? ' AND lower(email) = ?' : '';
  const binds = [...slugs, ...(email ? [email.trim().toLowerCase()] : [])];
  const query = (cols: string) =>
    db
      .prepare(
        `SELECT id, email, product_slug, bumps, paid_at, created_at${cols}
           FROM course_registrations
          WHERE status = 'paid' AND product_slug IN (${ph})${byEmail}
          ORDER BY COALESCE(paid_at, created_at), id`,
      )
      .bind(...binds)
      .all<PassRow>();
  let rows: PassRow[];
  try {
    rows = (await query(', access_starts_at, access_ends_at')).results ?? [];
  } catch {
    rows = (await query('')).results ?? [];
  }
  return rows.map(toPaidPass).filter((p): p is PaidLivePass => p !== null);
}

// The last day of each address's latest certification extension (the end of
// that pass's months).
export async function loadCertExtensions(db: D1Database, email?: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const p of await listPaidLivePasses(db, email)) {
    if (!p.certExtension) continue;
    const prev = out.get(p.email);
    if (!prev || p.endsOn > prev) out.set(p.email, p.endsOn);
  }
  return out;
}

// Write the period onto the order. Never throws: before migration 0089 there
// is nowhere to write it, and readers fall back to the paid day.
export async function recordLivePassPeriod(db: D1Database, id: number, p: LivePassPeriod): Promise<boolean> {
  const { startsAt, endsAt } = livePassInstants(p);
  try {
    await db
      .prepare(`UPDATE course_registrations SET access_starts_at = ?, access_ends_at = ? WHERE id = ?`)
      .bind(startsAt, endsAt, id)
      .run();
    return true;
  } catch {
    return false;
  }
}
