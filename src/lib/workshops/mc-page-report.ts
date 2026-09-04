// Did a change to the masterclass page sell more masterclass seats?
//
// One report per bookmarked change (experiments.ts) — removing the workshop
// dates, adding the order bump, whatever comes next. The windows and the
// funnel are the same every time; a change opts into the extra tiles that are
// meaningful for it (`showWorkshopSwitch` / `showBumpTakeUp`), so a bookmark
// never inherits a tile of noise from the one before it.
//
// The site keeps no page-view analytics, so "conversion" here is measured on
// the only funnel the database actually holds: a registration row is written
// at `prepared` the moment someone submits the form (before the gateway), and
// flips to `paid`/`coupon` when the seat is secured. Started → secured is
// therefore a real rate, and it is the one this change should move.
//
// The comparison is anchored on a bookmarked page change (experiments.ts) and
// runs two windows of the same length either side of it, so a fortnight after
// is read against the fortnight before rather than against all of history.
//
// The second half of the question — how many people the masterclass page sent
// to a €22 workshop instead — needs `signup_page` (migration 0083), which only
// exists from the day this shipped. Rows before it are NULL: unknown, not
// zero, and the report says so rather than reporting a 0.

import { grossEurMinor } from './stats';
import { MASTERCLASS_PAGE } from './signup-page';
import type { PageChange } from './experiments';

export type FunnelWindow = {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  days: number;
  started: number; // registration rows created (form submitted)
  secured: number; // paid or comped
  securedRate: number; // secured / started, 0 when nothing started
  revenueEurMinor: number;
  perDay: number; // secured per day, so unequal windows still compare
  /** Secured seats that added the order bump, and what it earned. */
  bump: { taken: number; rate: number; revenueEurMinor: number };
};

export type McPageReport = {
  change: PageChange;
  before: FunnelWindow;
  after: FunnelWindow;
  /** after.securedRate − before.securedRate, in percentage points. */
  rateDeltaPoints: number;
  /** Workshop seats started from the masterclass page (NULL-safe, see below). */
  workshopFromMcPage: {
    tracked: boolean; // is any signup_page recorded in the window at all?
    started: number;
    secured: number;
    revenueEurMinor: number;
    /** Registrations in the window whose page was never recorded. */
    unknownPage: number;
  };
};

type RegRow = {
  payment_status: string;
  amount_minor: number | null;
  currency: string | null;
  settlement_amount_minor: number | null;
  settlement_currency: string | null;
  // The bump, from the two signals that grant it (see bump.ts): a recorded
  // ledger line, or the ticked box on a seat that has no line (a comped seat
  // never writes one). `wants_bump` is the intent — the question this panel
  // asks — and the ledger is what was actually charged for it.
  wants_bump: number | null;
  bump_amount_minor: number | null;
  bump_currency: string | null;
};

const SECURED = new Set(['paid', 'coupon']);

// A registration joined to its latest paid/refunded payment, restricted to
// sessions whose main product is (or is not) a masterclass, over a date range.
// `signupPage` narrows further to rows that recorded that page.
function regQuery(opts: { masterclass: boolean; signupPage?: string }) {
  return `
    SELECT r.payment_status, r.wants_bump,
           p.amount_minor, p.currency,
           p.settlement_amount_minor, p.settlement_currency,
           b.amount_minor AS bump_amount_minor, b.currency AS bump_currency
      FROM workshop_registrations r
      JOIN workshops w ON w.id = r.workshop_id
      LEFT JOIN workshop_products mp ON mp.id = w.main_product_id
      LEFT JOIN (
        SELECT registration_id, amount_minor, currency,
               settlement_amount_minor, settlement_currency,
               ROW_NUMBER() OVER (PARTITION BY registration_id ORDER BY id DESC) AS rn
          FROM workshop_payments
         WHERE status IN ('paid','refunded')
      ) p ON p.registration_id = r.id AND p.rn = 1
      LEFT JOIN (
        SELECT registration_id, amount_minor, currency,
               ROW_NUMBER() OVER (PARTITION BY registration_id ORDER BY id DESC) AS rn
          FROM workshop_purchases
         WHERE product_type = 'bump'
      ) b ON b.registration_id = r.id AND b.rn = 1
     WHERE date(r.created_at) BETWEEN ? AND ?
       AND COALESCE(mp.slug,'') ${opts.masterclass ? 'LIKE' : 'NOT LIKE'} '%masterclass%'
       ${opts.signupPage ? 'AND r.signup_page = ?' : ''}`;
}

function summarize(
  rows: RegRow[],
  from: string,
  to: string,
  fxRates?: Record<string, number>,
): FunnelWindow {
  let secured = 0;
  let revenueEurMinor = 0;
  let bumpTaken = 0;
  let bumpRevenueEurMinor = 0;
  for (const row of rows) {
    if (!SECURED.has(row.payment_status)) continue;
    secured += 1;
    // Either signal counts as "they took it"; only a charged line has euros.
    if (row.bump_amount_minor != null || row.wants_bump === 1) bumpTaken += 1;
    if (row.bump_amount_minor != null) {
      bumpRevenueEurMinor += grossEurMinor(
        {
          amount_minor: row.bump_amount_minor,
          currency: row.bump_currency ?? 'EUR',
          settlement_amount_minor: null,
          settlement_currency: null,
        },
        fxRates,
      );
    }
    // A comped seat (and a paid one whose payment row hasn't landed yet) has no
    // amount: worth a registration, worth no euros.
    if (row.amount_minor != null) {
      revenueEurMinor += grossEurMinor(
        {
          amount_minor: row.amount_minor,
          currency: row.currency ?? 'EUR',
          settlement_amount_minor: row.settlement_amount_minor,
          settlement_currency: row.settlement_currency,
        },
        fxRates,
      );
    }
  }
  const days = daysBetween(from, to);
  return {
    from,
    to,
    days,
    started: rows.length,
    secured,
    securedRate: rows.length ? secured / rows.length : 0,
    revenueEurMinor,
    perDay: days ? secured / days : 0,
    bump: {
      taken: bumpTaken,
      rate: secured ? bumpTaken / secured : 0,
      revenueEurMinor: bumpRevenueEurMinor,
    },
  };
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

function shiftDate(day: string, deltaDays: number): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  return new Date(t + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

// The two windows around a bookmarked change. The "after" window runs from the
// change date to `today` (inclusive); "before" is the same number of days
// immediately preceding it, so the two are comparable by construction.
export async function computeMcPageReport(
  db: D1Database,
  change: PageChange,
  opts: { today?: string; money?: { fxRates?: Record<string, number> } } = {},
): Promise<McPageReport> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const fxRates = opts.money?.fxRates;

  const afterFrom = change.date;
  const afterTo = today >= afterFrom ? today : afterFrom;
  const span = daysBetween(afterFrom, afterTo);
  const beforeTo = shiftDate(afterFrom, -1);
  const beforeFrom = shiftDate(beforeTo, -(span - 1));

  const mcSql = regQuery({ masterclass: true });
  const wsSql = regQuery({ masterclass: false, signupPage: MASTERCLASS_PAGE });

  // The two signup_page queries are tolerated rather than trusted: a preview
  // deploy runs against the live database before migration 0083 lands there,
  // and an admin page that 500s over a missing reporting column helps nobody.
  // No column → the panel says "not recorded", which is also the honest answer
  // for every registration made before it existed.
  const [beforeRows, afterRows, wsRows, pageStats] = await Promise.all([
    db.prepare(mcSql).bind(beforeFrom, beforeTo).all<RegRow>(),
    db.prepare(mcSql).bind(afterFrom, afterTo).all<RegRow>(),
    db
      .prepare(wsSql)
      .bind(beforeFrom, afterTo, MASTERCLASS_PAGE)
      .all<RegRow>()
      .catch(() => ({ results: [] as RegRow[] })),
    db
      .prepare(
        `SELECT COUNT(*) AS n,
                SUM(CASE WHEN signup_page IS NULL THEN 1 ELSE 0 END) AS unknown_page
           FROM workshop_registrations
          WHERE date(created_at) BETWEEN ? AND ?`,
      )
      .bind(beforeFrom, afterTo)
      .first<{ n: number; unknown_page: number }>()
      .catch(() => null),
  ]);

  const before = summarize(beforeRows.results ?? [], beforeFrom, beforeTo, fxRates);
  const after = summarize(afterRows.results ?? [], afterFrom, afterTo, fxRates);
  const ws = summarize(wsRows.results ?? [], beforeFrom, afterTo, fxRates);

  const total = pageStats?.n ?? 0;
  const unknown = pageStats?.unknown_page ?? 0;

  return {
    change,
    before,
    after,
    rateDeltaPoints: (after.securedRate - before.securedRate) * 100,
    workshopFromMcPage: {
      tracked: total > unknown,
      started: ws.started,
      secured: ws.secured,
      revenueEurMinor: ws.revenueEurMinor,
      unknownPage: unknown,
    },
  };
}
