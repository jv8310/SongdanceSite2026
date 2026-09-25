// Internal "SD-REPORT" ops digests — a daily snapshot every morning and a
// wider weekly snapshot every Tuesday, mailed to the team (jacob@ / support@).
// NOT customer-facing: subject is prefixed `SD-REPORT:` for inbox filtering,
// recipients come from REPORTS_TO (falling back to ORDER_NOTIFICATIONS_TO, then
// ADMIN_EMAIL, then jacob@songdance.co).
//
// What it covers, for the window:
//   • Workshop registrations  — new paid/coupon seats, per workshop.
//   • Course sales            — 12-week / certification / grief etc.
//   • Bump offers             — both the workshop order bump (workshop_purchases)
//                               and the course checkout order bumps (the `bumps`
//                               JSON on course_registrations).
//   • Ad economics            — spend, cost per registration and ROAS per
//                               product (workshop / masterclass).
//   • Money, two ways         — SOLD and CASH IN, side by side.
//
// Sold vs cash in. A 3×/6×/12× course plan is one sale — the buyer signed for
// every installment — but the money arrives a month at a time. The digest used
// to show only one hybrid of the two: each sale at the installments it had
// collected so far, on the day it was sold. So a €797 certification bought on
// a 3× plan entered yesterday's report at €266, and the second and third
// installments of every older plan never appeared in any report at all. Now:
//   • Sold    — what the window sold, every sale at its FULL value (a plan's
//               whole total, plus the bumps bought with it), on the day it was
//               sold. The same figure ad attribution uses (contractedMinorOf) —
//               the ad-economics cards, /admin/workshops/performance, and what
//               Meta is told — so ROAS here is ROAS there.
//   • Cash in — what was actually charged in the window: first payments on new
//               sales, installments falling due on older plans, less refunds
//               (computeCourseCashIn). What reaches the bank.
// Workshop tickets, masterclass seats and their bumps are paid in full at
// checkout, so they read the same in both columns.
//
// Numbers reuse the exact same compute functions as /admin/stats
// (computeStats, computeCourseSales, computeCourseCashIn,
// computeWorkshopPerformance) with the same live-FX + Quaderno money context,
// so every figure here is on the dashboard for the same window. Windows are
// resolved against the business timezone (Europe/Brussels) just like the
// stats-page presets, so "yesterday" / "last 7 days" line up with the
// dashboard's own presets.
//
// Timing & idempotency: runReports rides the existing hourly cron. The first
// tick at/after 08:00 Brussels each day stakes a unique `pending` row in the
// `events` audit log (external_id `report-daily-<date>` / `report-weekly-<date>`)
// and, having claimed it, sends — so the report goes out once per day even if the
// cron fires several times, and a missed 08:00 tick is caught up later the same
// day. The claim is a two-phase mark: `pending` before the send, promoted to
// `sent` only once Resend accepts it. A send failure drops the pending claim so
// a later tick retries; and a claim that was staked but never confirmed (the
// isolate died mid-send, stranding a `pending` row) is reclaimed by a later tick
// once it goes stale — so a dropped report is retried, never lost for the day.

import {
  computeStats,
  computeCourseSales,
  computeCourseCashIn,
  computeWorkshopPerformance,
  computeRegistrationsByDay,
  resolveMoneyOpts,
  type AudienceAcquisition,
  type MoneyOpts,
} from './stats';
import { shiftDays } from './periods';
import { localHour } from './time';
import { sendEmail } from './resend';
import type { EmailContent } from './emails';

// The business timezone — the same one the stats-page presets resolve "today"
// in (see periods.ts) so report windows match the dashboard.
const BUSINESS_TZ = 'Europe/Brussels';
// The first hourly tick at/after this local hour sends the day's report.
const REPORT_LOCAL_HOUR = 8;

export type ReportEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  REPORTS_TO?: string;
  ORDER_NOTIFICATIONS_TO?: string;
  ADMIN_EMAIL?: string;
  RESEND_REPLY_TO?: string;
  PUBLIC_BASE_URL?: string;
  // Quaderno (VAT netting for standalone course figures — same as the
  // dashboard). Absent → those figures fall back to gross, as before.
  QUADERNO_API_KEY?: string;
  QUADERNO_ACCOUNT?: string;
  QUADERNO_SANDBOX?: string;
};

const DEFAULT_RECIPIENT = 'jacob@songdance.co';
const DEFAULT_BASE_URL = 'https://songdance.co';

// ── Data ────────────────────────────────────────────────────────────────────

// One product's ad economics — the stats page's ad-economics card, as a row.
export type ReportAudience = {
  registrations: number;
  // The prospecting spend charged to this product's seats, day by day.
  adSpendEurMinor: number;
  costPerRegistrationEurMinor: number | null;
  // Tickets, bumps and the courses these registrants bought, each course sale
  // in full.
  revenueEurMinor: number;
  roas: number | null;
};

export type ReportData = {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  registrations: {
    total: number; // new paid/coupon seats in the window
    // `seats` = every seat that session holds now, not just the new ones.
    byWorkshop: Array<{ title: string; count: number; seats: number; date: string }>;
  };
  courseSales: {
    total: number;
    plans: number; // of `total`, bought on a 3×/6×/12× payment plan
    fullValueEurMinor: number; // course lines, every installment counted
    chargedEurMinor: number; // course lines, charged so far (= the stats page's course tiles)
    byProduct: Array<{
      label: string; count: number; plans: number;
      fullValueEurMinor: number; chargedEurMinor: number;
    }>;
  };
  // Workshop order bump (workshop_purchases, product_type='bump').
  workshopBumps: { count: number; netEurMinor: number };
  // Course checkout order bumps (the `bumps` JSON on course_registrations).
  courseBumps: {
    count: number;
    eurMinor: number;
    byLabel: Array<{ label: string; count: number; eurMinor: number }>;
  };
  // Everything the window SOLD, at full value.
  sold: {
    ticketsEurMinor: number; // workshop tickets, masterclass excluded
    masterclassEurMinor: number;
    workshopBumpsEurMinor: number;
    workshopCourseAddonsEurMinor: number; // course add-ons sold via a workshop checkout
    courseSalesEurMinor: number; // standalone course sales, whole plan
    courseBumpsEurMinor: number;
    totalEurMinor: number;
    // Of the course sales above, what is still to be charged on their plans.
    stillToBillEurMinor: number;
  };
  // What was CHARGED in the window.
  cash: {
    workshopEurMinor: number; // tickets + masterclass + workshop bumps + add-ons (paid at checkout)
    courseFirstPaymentsEurMinor: number; // a one-off in full, a plan's first installment
    courseBumpsEurMinor: number;
    installmentsEurMinor: number; // later installments on plans sold earlier
    installmentCount: number;
    refundsEurMinor: number; // course refunds issued in the window (to subtract)
    refundCount: number;
    totalEurMinor: number;
  };
  ads: {
    spendEurMinor: number; // all campaigns
    prospectingEurMinor: number; // TOF campaigns
    retargetingEurMinor: number;
    roas: number | null; // sold ÷ all spend — blended, courses counted in full
    workshop: ReportAudience;
    masterclass: ReportAudience;
  };
  // Per day across the window (the weekly digest's table).
  daily: Array<{
    date: string;
    registrations: number;
    adSpendEurMinor: number;
    soldEurMinor: number;
    cashInEurMinor: number;
  }>;
};

const toEnd = (to: string) => `${to} 23:59:59`;

function audienceLine(a: AudienceAcquisition): ReportAudience {
  return {
    registrations: a.registrations,
    adSpendEurMinor: Math.round(a.allocatedCostEurMinor),
    costPerRegistrationEurMinor:
      a.costPerRegistrationEurMinor != null ? Math.round(a.costPerRegistrationEurMinor) : null,
    revenueEurMinor: a.revenueEurMinor,
    roas: a.roas,
  };
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = shiftDays(d, 1)) out.push(d);
  return out;
}

// Gather every figure for [from, to]. Pure read; safe to call for a preview.
// `money` (live FX + Quaderno VAT netting) keeps the digest's course figures
// identical to the dashboard's — omit it and they fall back to gross/fallback.
export async function gatherReportData(
  db: D1Database,
  from: string,
  to: string,
  money?: MoneyOpts,
): Promise<ReportData> {
  const [stats, courses, cashIn, perf, regsByDay] = await Promise.all([
    computeStats(db, { from, to, money }),
    computeCourseSales(db, { from, to, money }),
    computeCourseCashIn(db, { from, to, money }),
    computeWorkshopPerformance(db, { from, to, money }),
    computeRegistrationsByDay(db, { from, to }),
  ]);

  // New registrations (secured seats) per workshop in the window. Grouped by
  // workshop id (not just title), since the same title (e.g. "Somatic Vocal
  // Healing Workshop") recurs across many scheduled instances — the date is
  // what tells two rows apart. `seats` is where that session stands now.
  const regRes = await db
    .prepare(
      `SELECT w.title AS title, w.starts_at_utc AS starts_at_utc,
              w.display_tz AS display_tz, w.is_replay AS is_replay, COUNT(*) AS n,
              (SELECT COUNT(*) FROM workshop_registrations s
                WHERE s.workshop_id = w.id AND s.payment_status IN ('paid','coupon')) AS seats
         FROM workshop_registrations r
         JOIN workshops w ON w.id = r.workshop_id
        WHERE r.payment_status IN ('paid','coupon')
          AND r.created_at >= ? AND r.created_at <= ?
        GROUP BY w.id
        ORDER BY n DESC, w.title`,
    )
    .bind(from, toEnd(to))
    .all<{
      title: string;
      starts_at_utc: string;
      display_tz: string;
      is_replay: number;
      n: number;
      seats: number;
    }>();
  const byWorkshop = (regRes.results ?? []).map((r) => ({
    title: r.title,
    count: r.n,
    seats: r.seats,
    date: r.is_replay ? 'On demand' : workshopDateLabel(r.starts_at_utc, r.display_tz),
  }));
  const regTotal = byWorkshop.reduce((s, r) => s + r.count, 0);

  const t = stats.totals;
  // The workshop engine's figures are paid in full at checkout: the same money
  // in both columns.
  const workshopEurMinor = t.netEurMinor;
  const soldTotal = workshopEurMinor + courses.totalSoldEurMinor;
  const cashTotal = workshopEurMinor + cashIn.totalEurMinor;
  // Ad spend off the performance report, as /admin/stats reads it.
  const spend = perf.adSpendEurMinor;

  const engineByDay = new Map(stats.daily.map((d) => [d.date, d]));
  const soldByDay = new Map(courses.daily.map((d) => [d.date, d.soldEurMinor]));
  const cashByDay = new Map(cashIn.daily.map((d) => [d.date, d.eurMinor]));
  const regsOnDay = new Map(regsByDay.days.map((d) => [d.date, d.count]));
  const daily = eachDay(from, to).map((date) => {
    const engine = engineByDay.get(date)?.netEurMinor ?? 0;
    return {
      date,
      registrations: regsOnDay.get(date) ?? 0,
      adSpendEurMinor: engineByDay.get(date)?.adSpendEurMinor ?? 0,
      soldEurMinor: engine + (soldByDay.get(date) ?? 0),
      cashInEurMinor: engine + (cashByDay.get(date) ?? 0),
    };
  });

  return {
    from,
    to,
    registrations: { total: regTotal, byWorkshop },
    courseSales: {
      total: courses.totalCount,
      plans: courses.planCount,
      fullValueEurMinor: courses.totalFullValueEurMinor,
      chargedEurMinor: courses.totalNetEurMinor,
      byProduct: courses.byProduct.map((p) => ({
        label: p.label,
        count: p.count,
        plans: p.planCount,
        fullValueEurMinor: p.fullValueEurMinor,
        chargedEurMinor: p.netEurMinor,
      })),
    },
    workshopBumps: { count: t.bumpCount, netEurMinor: t.bumpNetEurMinor },
    courseBumps: courses.bumps,
    sold: {
      ticketsEurMinor: t.ticketNetEurMinor,
      masterclassEurMinor: t.masterclassNetEurMinor,
      workshopBumpsEurMinor: t.bumpNetEurMinor,
      workshopCourseAddonsEurMinor: t.courseNetEurMinor,
      courseSalesEurMinor: courses.totalFullValueEurMinor,
      courseBumpsEurMinor: courses.bumps.eurMinor,
      totalEurMinor: soldTotal,
      stillToBillEurMinor: Math.max(0, courses.totalFullValueEurMinor - courses.totalNetEurMinor),
    },
    cash: {
      workshopEurMinor,
      courseFirstPaymentsEurMinor: cashIn.firstPaymentsEurMinor,
      courseBumpsEurMinor: cashIn.bumpsEurMinor,
      installmentsEurMinor: cashIn.installmentsEurMinor,
      installmentCount: cashIn.installmentCount,
      refundsEurMinor: cashIn.refundsEurMinor,
      refundCount: cashIn.refundCount,
      totalEurMinor: cashTotal,
    },
    ads: {
      spendEurMinor: spend,
      prospectingEurMinor: perf.acquisitionSpendEurMinor,
      retargetingEurMinor: perf.retargetingSpendEurMinor,
      roas: spend > 0 ? soldTotal / spend : null,
      workshop: audienceLine(perf.audiences.workshop),
      masterclass: audienceLine(perf.audiences.masterclass),
    },
    daily,
  };
}

// ── Email rendering (internal, light theme — mirrors orders/notification.ts) ──

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Money reads the way /admin/stats prints it: cents in tables, whole euros in
// the headline cards, thousands grouped.
const eur = (m: number) =>
  (m < 0 ? '−€' : '€') +
  (Math.abs(m) / 100).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0 = (m: number) =>
  (m < 0 ? '−€' : '€') + Math.round(Math.abs(m) / 100).toLocaleString('en-IE');
const roasStr = (v: number | null) => (v != null ? v.toFixed(2) + '×' : '—');
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// "Mon 29 Jun 2026" — formatted as a calendar date (UTC, so the YYYY-MM-DD
// label never shifts a day).
function dayLabel(ymd: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${ymd}T12:00:00Z`));
}

// "29 Jun" — compact, for the per-day table.
function shortDay(ymd: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${ymd}T12:00:00Z`));
}

// "Mon 15 Jun 2026" for a scheduled workshop instance, in its own display
// timezone (falls back to UTC if the tz is bad/unknown).
function workshopDateLabel(startsAtUtc: string, displayTz: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: displayTz,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(startsAtUtc));
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(startsAtUtc));
  }
}

const C = {
  bg: '#f3f4f6',
  card: '#ffffff',
  border: '#e5e7eb',
  ink: '#111827',
  muted: '#6b7280',
  faint: '#9ca3af',
};

function sectionLabel(text: string): string {
  return `<p style="margin:22px 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${C.faint};">${escapeHtml(text)}</p>`;
}

// A row of stat cards (label + big number + optional small line under it).
function statCards(cards: Array<{ label: string; value: string; sub?: string }>): string {
  const cells = cards
    .map(
      (c) =>
        `<td valign="top" style="padding:6px;width:${Math.floor(100 / cards.length)}%;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafb;border:1px solid ${C.border};border-radius:10px;">
            <tr><td style="padding:14px 16px;">
              <p style="margin:0 0 4px;font-size:12px;color:${C.muted};">${escapeHtml(c.label)}</p>
              <p style="margin:0;font-size:22px;font-weight:600;color:${C.ink};white-space:nowrap;">${escapeHtml(c.value)}</p>
              ${c.sub ? `<p style="margin:4px 0 0;font-size:11px;color:${C.faint};">${escapeHtml(c.sub)}</p>` : ''}
            </td></tr>
          </table>
        </td>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -6px;"><tr>${cells}</tr></table>`;
}

// A headered data table. `boldLast` sets the final row off as a total.
function dataTable(headers: string[], rows: string[][], opts: { boldLast?: boolean } = {}): string {
  const head = headers
    .map(
      (h, i) =>
        `<th align="${i === 0 ? 'left' : 'right'}" style="padding:6px 10px;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:${C.faint};border-bottom:1px solid ${C.border};font-weight:600;">${escapeHtml(h)}</th>`,
    )
    .join('');
  const body = rows
    .map((cells, r) => {
      const total = opts.boldLast && r === rows.length - 1;
      return `<tr>${cells
        .map(
          (c, i) =>
            `<td align="${i === 0 ? 'left' : 'right'}" style="padding:7px 10px;font-size:13px;color:${
              total || i === 0 ? C.ink : C.muted
            };font-weight:${total ? '600' : '400'};border-${total ? 'top' : 'bottom'}:1px solid ${
              total ? C.border : '#f1f2f4'
            };white-space:${i === 0 ? 'normal' : 'nowrap'};">${escapeHtml(c)}</td>`,
        )
        .join('')}</tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${head}</tr>${body}</table>`;
}

function note(text: string): string {
  return `<p style="margin:8px 0 0;font-size:12px;line-height:1.55;color:${C.muted};">${escapeHtml(text)}</p>`;
}

function emptyNote(text: string): string {
  return `<p style="margin:2px 0 0;font-size:13px;color:${C.faint};font-style:italic;">${escapeHtml(text)}</p>`;
}

// The Sold / Cash in table, as rows — shared by the HTML and the text part so
// the two can never list different lines. `null` = not applicable ("—").
type MoneyRow = { label: string; sold: number | null; cash: number | null; total?: boolean };

function moneyRows(data: ReportData): MoneyRow[] {
  const s = data.sold;
  const c = data.cash;
  const rows: MoneyRow[] = [
    { label: 'Workshop tickets', sold: s.ticketsEurMinor, cash: s.ticketsEurMinor },
    { label: 'Masterclass', sold: s.masterclassEurMinor, cash: s.masterclassEurMinor },
    { label: 'Workshop order bumps', sold: s.workshopBumpsEurMinor, cash: s.workshopBumpsEurMinor },
  ];
  if (s.workshopCourseAddonsEurMinor !== 0) {
    rows.push({
      label: 'Course add-ons (via workshop)',
      sold: s.workshopCourseAddonsEurMinor,
      cash: s.workshopCourseAddonsEurMinor,
    });
  }
  rows.push(
    { label: 'Course sales', sold: s.courseSalesEurMinor, cash: c.courseFirstPaymentsEurMinor },
    { label: 'Course order bumps', sold: s.courseBumpsEurMinor, cash: c.courseBumpsEurMinor },
    {
      label: `Installments on earlier plans${c.installmentCount ? ` (${c.installmentCount})` : ''}`,
      sold: null,
      cash: c.installmentsEurMinor,
    },
  );
  if (c.refundsEurMinor !== 0) {
    rows.push({ label: `Course refunds (${c.refundCount})`, sold: null, cash: -c.refundsEurMinor });
  }
  rows.push({ label: 'Total', sold: s.totalEurMinor, cash: c.totalEurMinor, total: true });
  return rows;
}

const cell = (v: number | null) => (v == null ? '—' : eur(v));

function stillToBillNote(data: ReportData): string | null {
  const s = data.sold;
  if (s.stillToBillEurMinor <= 0) return null;
  return `${eur(s.stillToBillEurMinor)} of these course sales is still to be charged on their payment plans (${plural(
    data.courseSales.plans,
    'plan',
  )}) — counted in full under Sold today, it reaches Cash in one installment at a time.`;
}

function audienceRows(data: ReportData): string[][] {
  const row = (name: string, a: ReportAudience) => [
    name,
    String(a.registrations),
    eur(a.adSpendEurMinor),
    a.costPerRegistrationEurMinor != null ? eur(a.costPerRegistrationEurMinor) : '—',
    eur(a.revenueEurMinor),
    roasStr(a.roas),
  ];
  return [row('Workshop', data.ads.workshop), row('Masterclass', data.ads.masterclass)];
}

// The shared frame + the sections common to both digests.
function renderReport(opts: {
  kindLabel: string;
  rangeLabel: string;
  data: ReportData;
  extraSectionsHtml?: string;
  baseUrl: string;
  dashboardQuery: string;
}): string {
  const { kindLabel, rangeLabel, data, extraSectionsHtml, baseUrl, dashboardQuery } = opts;
  const b = baseUrl.replace(/\/$/, '');
  const ads = data.ads;

  const snapshot = statCards([
    { label: 'Registrations', value: String(data.registrations.total) },
    {
      label: 'Course sales',
      value: String(data.courseSales.total),
      sub: data.courseSales.plans ? `${data.courseSales.plans} on a plan` : undefined,
    },
    { label: 'Sold', value: eur0(data.sold.totalEurMinor), sub: 'courses in full' },
    { label: 'Cash in', value: eur0(data.cash.totalEurMinor), sub: 'actually charged' },
  ]);

  // Ad-efficiency headline — spend, blended ROAS on full value, and the price
  // of a seat per product ('—' when there's nothing to divide).
  const seat = (a: ReportAudience) =>
    a.costPerRegistrationEurMinor != null ? eur(a.costPerRegistrationEurMinor) : '—';
  const adEfficiency = statCards([
    {
      label: 'Ad spend',
      value: eur0(ads.spendEurMinor),
      sub: ads.spendEurMinor > 0 ? `${eur0(ads.prospectingEurMinor)} prospecting` : undefined,
    },
    { label: 'Blended ROAS', value: roasStr(ads.roas), sub: 'sold ÷ ad spend' },
    { label: 'Workshop seat', value: seat(ads.workshop), sub: 'cost / registration' },
    { label: 'Masterclass seat', value: seat(ads.masterclass), sub: 'cost / registration' },
  ]);

  const regSection =
    sectionLabel('Workshop registrations') +
    (data.registrations.byWorkshop.length
      ? dataTable(
          ['Workshop', 'Date', 'New', 'Seats now'],
          data.registrations.byWorkshop.map((w) => [w.title, w.date, String(w.count), String(w.seats)]),
        )
      : emptyNote('No new registrations in this window.'));

  const courseSection =
    sectionLabel('Course sales') +
    (data.courseSales.byProduct.length
      ? dataTable(
          ['Product', 'Sales', 'Full value', 'Charged'],
          data.courseSales.byProduct.map((p) => [
            p.plans ? `${p.label} · ${p.plans} on a plan` : p.label,
            String(p.count),
            eur(p.fullValueEurMinor),
            eur(p.chargedEurMinor),
          ]),
        )
      : emptyNote('No course sales in this window.'));

  // Bump offers — workshop order bump + course checkout order bumps.
  const bumpRows: string[][] = [];
  if (data.workshopBumps.count > 0) {
    bumpRows.push([
      'Workshop order bump',
      String(data.workshopBumps.count),
      eur(data.workshopBumps.netEurMinor),
    ]);
  }
  for (const bump of data.courseBumps.byLabel) {
    bumpRows.push([`Course bump · ${bump.label}`, String(bump.count), eur(bump.eurMinor)]);
  }
  const bumpSection =
    sectionLabel('Bump offers') +
    (bumpRows.length
      ? dataTable(['Offer', 'Taken', 'Revenue'], bumpRows)
      : emptyNote('No bump add-ons taken in this window.'));

  const econSection =
    sectionLabel('Ad economics') +
    dataTable(['Product', 'Regs', 'Ad spend', 'Per reg', 'Made back', 'ROAS'], audienceRows(data)) +
    note(
      'Each product is charged only its own campaigns’ prospecting spend, priced day by day; made back = the tickets, bumps and courses those registrants bought, each course in full. Same figures as the ad-economics cards on the dashboard.',
    );

  const toBill = stillToBillNote(data);
  const revenueSection =
    sectionLabel('Money') +
    dataTable(
      ['', 'Sold', 'Cash in'],
      moneyRows(data).map((r) => [r.label, cell(r.sold), cell(r.cash)]),
      { boldLast: true },
    ) +
    note(
      'Sold = what this window sold, every payment plan at its full value. Cash in = what was actually charged in it: first payments on new sales, installments falling due on earlier plans, less refunds.',
    ) +
    (toBill ? note(toBill) : '');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(
    kindLabel,
  )}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.ink};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
    <tr><td align="center" style="padding:28px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:${C.card};border:1px solid ${C.border};border-radius:12px;">
        <tr><td style="padding:22px 26px 6px;">
          <p style="margin:0 0 2px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${C.faint};">Songdance · internal report</p>
          <h1 style="margin:0;font-size:20px;font-weight:600;color:${C.ink};">${escapeHtml(kindLabel)}</h1>
          <p style="margin:4px 0 0;font-size:14px;color:${C.muted};">${escapeHtml(rangeLabel)}</p>
        </td></tr>
        <tr><td style="padding:16px 20px 0;">${snapshot}</td></tr>
        <tr><td style="padding:6px 20px 0;">${adEfficiency}</td></tr>
        <tr><td style="padding:0 26px;">
          ${revenueSection}
          ${econSection}
          ${regSection}
          ${courseSection}
          ${bumpSection}
          ${extraSectionsHtml ?? ''}
        </td></tr>
        <tr><td style="padding:18px 26px 26px;">
          <a href="${b}/admin/stats?${escapeHtml(dashboardQuery)}" style="display:inline-block;padding:9px 16px;background:${C.ink};color:#ffffff;font-size:13px;text-decoration:none;border-radius:8px;">Open this window on the dashboard →</a>
        </td></tr>
      </table>
      <p style="margin:14px 0 0;font-size:11px;color:${C.faint};line-height:1.6;max-width:560px;">Automated report · Songdance. Every figure is net of VAT, in EUR at the live exchange rates, over UTC calendar days — the same conventions and the same calculations as the stats dashboard. A payment plan counts in full under Sold on the day it was sold (as the ad-economics cards and Meta count it); Cash in dates each installment on its monthly schedule.</p>
    </td></tr>
  </table>
</body></html>`;
  return html;
}

// Plain-text counterpart (compact but complete).
function renderReportText(kindLabel: string, rangeLabel: string, data: ReportData): string {
  const ads = data.ads;
  const lines: string[] = [kindLabel, rangeLabel, ''];
  const seat = (a: ReportAudience) =>
    a.costPerRegistrationEurMinor != null ? eur(a.costPerRegistrationEurMinor) : '—';
  lines.push(
    `Registrations: ${data.registrations.total} · Course sales: ${data.courseSales.total} · Sold: ${eur(
      data.sold.totalEurMinor,
    )} · Cash in: ${eur(data.cash.totalEurMinor)}`,
    `Ad spend: ${eur(ads.spendEurMinor)} · Blended ROAS: ${roasStr(ads.roas)} · Workshop seat: ${seat(
      ads.workshop,
    )} · Masterclass seat: ${seat(ads.masterclass)}`,
    '',
    'MONEY (sold · cash in)',
  );
  for (const r of moneyRows(data)) lines.push(`  ${r.label}: ${cell(r.sold)} · ${cell(r.cash)}`);
  const toBill = stillToBillNote(data);
  if (toBill) lines.push(`  ${toBill}`);
  lines.push('', 'AD ECONOMICS (regs · ad spend · per reg · made back · ROAS)');
  for (const [name, ...rest] of audienceRows(data)) lines.push(`  ${name}: ${rest.join(' · ')}`);
  lines.push('', 'WORKSHOP REGISTRATIONS');
  if (data.registrations.byWorkshop.length) {
    for (const w of data.registrations.byWorkshop)
      lines.push(`  ${w.title} (${w.date}): +${w.count} · ${w.seats} seats now`);
  } else lines.push('  (none)');
  lines.push('', 'COURSE SALES (full value · charged)');
  if (data.courseSales.byProduct.length) {
    for (const p of data.courseSales.byProduct)
      lines.push(
        `  ${p.label}: ${p.count}${p.plans ? ` (${p.plans} on a plan)` : ''} · ${eur(p.fullValueEurMinor)} · ${eur(
          p.chargedEurMinor,
        )}`,
      );
  } else lines.push('  (none)');
  lines.push('', 'BUMP OFFERS');
  if (data.workshopBumps.count > 0)
    lines.push(`  Workshop order bump: ${data.workshopBumps.count} · ${eur(data.workshopBumps.netEurMinor)}`);
  for (const bump of data.courseBumps.byLabel)
    lines.push(`  Course bump · ${bump.label}: ${bump.count} · ${eur(bump.eurMinor)}`);
  if (data.workshopBumps.count === 0 && data.courseBumps.byLabel.length === 0)
    lines.push('  (none)');
  return lines.join('\n');
}

// The dashboard link opens on the report's own window.
const dashboardQuery = (data: ReportData) =>
  `preset=custom&from=${data.from}&to=${data.to}`;

export function buildDailyReportEmail(data: ReportData, baseUrl: string): EmailContent {
  const kindLabel = 'Daily report';
  const rangeLabel = dayLabel(data.to);
  const subject = `SD-REPORT · Daily · ${dayLabel(data.to)} — ${data.registrations.total} reg · ${plural(
    data.courseSales.total,
    'course sale',
  )} · ${eur0(data.sold.totalEurMinor)} sold · ${eur0(data.cash.totalEurMinor)} cash in`;
  return {
    subject,
    html: renderReport({ kindLabel, rangeLabel, data, baseUrl, dashboardQuery: dashboardQuery(data) }),
    text: renderReportText(kindLabel, rangeLabel, data),
  };
}

export function buildWeeklyReportEmail(data: ReportData, baseUrl: string): EmailContent {
  const kindLabel = 'Weekly report';
  const rangeLabel = `${dayLabel(data.from)} – ${dayLabel(data.to)}`;

  // The week at a glance, one row per day, plus the week's total.
  const dailySection =
    data.daily.length > 0
      ? sectionLabel('By day') +
        dataTable(
          ['Day', 'Regs', 'Ad spend', 'Sold', 'Cash in'],
          [
            ...data.daily.map((d) => [
              shortDay(d.date),
              String(d.registrations),
              eur(d.adSpendEurMinor),
              eur(d.soldEurMinor),
              eur(d.cashInEurMinor),
            ]),
            [
              'Week',
              String(data.daily.reduce((s, d) => s + d.registrations, 0)),
              eur(data.ads.spendEurMinor),
              eur(data.sold.totalEurMinor),
              eur(data.cash.totalEurMinor),
            ],
          ],
          { boldLast: true },
        )
      : '';

  const subject = `SD-REPORT · Weekly · ${shortDay(data.from)}–${shortDay(data.to)} — ${data.registrations.total} reg · ${plural(
    data.courseSales.total,
    'course sale',
  )} · ${eur0(data.sold.totalEurMinor)} sold · ${eur0(data.cash.totalEurMinor)} cash in`;
  const text =
    renderReportText(kindLabel, rangeLabel, data) +
    '\n\nBY DAY (regs · ad spend · sold · cash in)\n' +
    data.daily
      .map(
        (d) =>
          `  ${shortDay(d.date)}: ${d.registrations} · ${eur(d.adSpendEurMinor)} · ${eur(d.soldEurMinor)} · ${eur(
            d.cashInEurMinor,
          )}`,
      )
      .join('\n');
  return {
    subject,
    html: renderReport({
      kindLabel,
      rangeLabel,
      data,
      baseUrl,
      extraSectionsHtml: dailySection,
      dashboardQuery: dashboardQuery(data),
    }),
    text,
  };
}

// ── Recipients + idempotency ──────────────────────────────────────────────

function reportRecipients(env: ReportEnv): string[] {
  const raw = (env.REPORTS_TO ?? env.ORDER_NOTIFICATIONS_TO ?? '').trim();
  const list = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length) return list;
  if (env.ADMIN_EMAIL) return [env.ADMIN_EMAIL];
  return [DEFAULT_RECIPIENT];
}

// A claim is a two-phase mark so a report that is claimed but never actually
// delivered can't be lost for the day. The claim row is written `pending`
// before the send and promoted to `sent` (confirmReport) only once Resend has
// accepted it. If the isolate is evicted between the claim commit and the send
// completing — the hourly cron fires several concurrent waitUntil tasks on a
// limited budget — the row is stranded `pending`; a later tick reclaims it
// (STALE_CLAIM_MINUTES after it was staked) and retries, instead of skipping
// the day forever because a row simply exists. A confirmed `sent` row is never
// reclaimed, so a delivered report is never duplicated by the retry path.
const STALE_CLAIM_MINUTES = 30; // < the hourly tick interval, ≫ a normal send

async function claimReport(db: D1Database, externalId: string): Promise<boolean> {
  // Fresh claim: nobody has staked this date yet.
  const ins = await db
    .prepare(
      `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id, payload_json)
       VALUES (NULL, 'report.sent', 'system', ?, 'pending')`,
    )
    .bind(externalId)
    .run();
  if ((ins.meta?.changes ?? 0) > 0) return true;

  // A row already exists. Take it over only if a previous tick staked it but
  // never confirmed the send (still `pending`) and it has gone stale — i.e. the
  // send was dropped, not delivered. A `sent` row (or a fresh pending one still
  // in flight) is left alone. Re-stamping created_at re-arms the staleness
  // window for this attempt.
  const takeover = await db
    .prepare(
      `UPDATE events
          SET created_at = datetime('now')
        WHERE external_id = ? AND kind = 'report.sent'
          AND payload_json = 'pending'
          AND created_at <= datetime('now', ?)`,
    )
    .bind(externalId, `-${STALE_CLAIM_MINUTES} minutes`)
    .run();
  return (takeover.meta?.changes ?? 0) > 0;
}

// Promote a claim to `sent` once the email is actually out, so the retry path
// never reclaims it. Best-effort: if this write is lost the row stays `pending`
// and a later tick may re-send (a rare duplicate is preferable to a silent miss).
async function confirmReport(db: D1Database, externalId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE events SET payload_json = 'sent'
        WHERE external_id = ? AND kind = 'report.sent'`,
    )
    .bind(externalId)
    .run();
}

// Drop an unconfirmed claim so the next tick retries promptly. Only removes a
// still-`pending` row — never a confirmed send.
async function releaseReport(db: D1Database, externalId: string): Promise<void> {
  await db
    .prepare(
      `DELETE FROM events
        WHERE external_id = ? AND kind = 'report.sent' AND payload_json = 'pending'`,
    )
    .bind(externalId)
    .run();
}

// The Brussels calendar date (YYYY-MM-DD) at `now`.
function businessDate(now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ }).format(new Date(now));
}

// Day-of-week for a YYYY-MM-DD calendar date (0=Sun … 2=Tue … 6=Sat).
function dayOfWeek(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

export type RunReportsResult = { daily: boolean; weekly: boolean };

// Called from the hourly cron. Sends the daily digest (for "yesterday") once
// per day from the first tick at/after 08:00 Brussels, and additionally the
// weekly digest (the 7 days ending yesterday) on Tuesdays. Idempotent and
// best-effort: never throws, releases its claim on failure so a later tick
// retries.
export async function runReports(env: ReportEnv, now = Date.now()): Promise<RunReportsResult> {
  const result: RunReportsResult = { daily: false, weekly: false };
  if (!env.RESEND_API_KEY) return result;
  // Hold until the local working morning. Earlier ticks no-op; the first tick
  // at/after 08:00 Brussels sends, and a missed tick is caught up later the day.
  if (localHour(BUSINESS_TZ, now) < REPORT_LOCAL_HOUR) return result;

  const today = businessDate(now);
  const yesterday = shiftDays(today, -1);
  const baseUrl = (env.PUBLIC_BASE_URL && env.PUBLIC_BASE_URL.trim()) || DEFAULT_BASE_URL;
  const money = await resolveMoneyOpts(env.DB, env);

  result.daily = await sendOne(
    env,
    `report-daily-${yesterday}`,
    () => gatherReportData(env.DB, yesterday, yesterday, money),
    (data) => buildDailyReportEmail(data, baseUrl),
  );

  if (dayOfWeek(today) === 2 /* Tuesday */) {
    const weekTo = yesterday;
    const weekFrom = shiftDays(weekTo, -6);
    result.weekly = await sendOne(
      env,
      `report-weekly-${weekTo}`,
      () => gatherReportData(env.DB, weekFrom, weekTo, money),
      (data) => buildWeeklyReportEmail(data, baseUrl),
    );
  }

  return result;
}

// ── Manual on-demand send (admin "Send now" from /admin/emails) ─────────────
// Force-send a report for a given date with REAL data — the escape hatch for a
// digest the cron dropped (e.g. an isolate evicted mid-send before the retry
// path shipped). Unlike runReports this ignores the once-per-day `events` claim
// and the 08:00 hold: it always builds and sends, so it can never be silently
// no-op'd by a stale claim. Windows resolve in Brussels time, same as the cron.
//   • daily  — the single day `date` (default: yesterday).
//   • weekly — the 7 days ending on `date` (default: yesterday).
// `to` overrides the recipients (else the usual REPORTS_TO chain). Throws on a
// send failure so the caller can surface the reason.
export async function sendReportNow(
  env: ReportEnv,
  opts: { kind: 'daily' | 'weekly'; date?: string; to?: string[]; now?: number },
): Promise<{ subject: string; recipients: string[]; from: string; to: string }> {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');
  const now = opts.now ?? Date.now();
  const baseUrl = (env.PUBLIC_BASE_URL && env.PUBLIC_BASE_URL.trim()) || DEFAULT_BASE_URL;
  const defaultDate = shiftDays(businessDate(now), -1); // yesterday, Brussels
  const target = (opts.date && opts.date.trim()) || defaultDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new Error(`Bad date: ${target}`);

  const from = opts.kind === 'weekly' ? shiftDays(target, -6) : target;
  const to = target;
  const data = await gatherReportData(env.DB, from, to, await resolveMoneyOpts(env.DB, env));
  const content =
    opts.kind === 'weekly'
      ? buildWeeklyReportEmail(data, baseUrl)
      : buildDailyReportEmail(data, baseUrl);

  const recipients = opts.to && opts.to.length ? opts.to : reportRecipients(env);
  await sendEmail({
    apiKey: env.RESEND_API_KEY,
    to: recipients,
    replyTo: env.RESEND_REPLY_TO,
    subject: content.subject,
    html: content.html,
    text: content.text,
    // Distinct ref so a manual send never collides with the cron's daily claim.
    entityRefId: `report-${opts.kind}-manual-${target}`,
  });
  return { subject: content.subject, recipients, from, to };
}

// ── Sample data (drives the /admin/emails preview + test-send) ──────────────

export function sampleDailyReportData(): ReportData {
  // A certification on a 3× plan (full value €659, first installment €220
  // charged) and a 12-week paid in full; one older plan billed its second
  // installment the same day.
  return {
    from: '2026-06-29',
    to: '2026-06-29',
    registrations: {
      total: 7,
      byWorkshop: [
        { title: 'Somatic Vocal Healing Workshop', count: 5, seats: 23, date: 'Mon 29 Jun 2026' },
        { title: 'SVH Masterclass', count: 2, seats: 11, date: 'Wed 1 Jul 2026' },
      ],
    },
    courseSales: {
      total: 2,
      plans: 1,
      fullValueEurMinor: 111350,
      chargedEurMinor: 67400,
      byProduct: [
        { label: 'Certification — cert only', count: 1, plans: 1, fullValueEurMinor: 65900, chargedEurMinor: 21950 },
        { label: '12-Week SVH Course', count: 1, plans: 0, fullValueEurMinor: 45450, chargedEurMinor: 45450 },
      ],
    },
    workshopBumps: { count: 3, netEurMinor: 2230 },
    courseBumps: {
      count: 1,
      eurMinor: 8180,
      byLabel: [{ label: 'The Authentic Singing Journey', count: 1, eurMinor: 8180 }],
    },
    sold: {
      ticketsEurMinor: 9090,
      masterclassEurMinor: 7270,
      workshopBumpsEurMinor: 2230,
      workshopCourseAddonsEurMinor: 0,
      courseSalesEurMinor: 111350,
      courseBumpsEurMinor: 8180,
      totalEurMinor: 138120,
      stillToBillEurMinor: 43950,
    },
    cash: {
      workshopEurMinor: 18590,
      courseFirstPaymentsEurMinor: 67400,
      courseBumpsEurMinor: 8180,
      installmentsEurMinor: 21950,
      installmentCount: 1,
      refundsEurMinor: 0,
      refundCount: 0,
      totalEurMinor: 116120,
    },
    ads: {
      spendEurMinor: 14200,
      prospectingEurMinor: 11800,
      retargetingEurMinor: 2400,
      roas: 9.73,
      workshop: {
        registrations: 5,
        adSpendEurMinor: 5400,
        costPerRegistrationEurMinor: 1080,
        revenueEurMinor: 65180,
        roas: 12.07,
      },
      masterclass: {
        registrations: 2,
        adSpendEurMinor: 6400,
        costPerRegistrationEurMinor: 3200,
        revenueEurMinor: 74400,
        roas: 11.63,
      },
    },
    daily: [
      {
        date: '2026-06-29',
        registrations: 7,
        adSpendEurMinor: 14200,
        soldEurMinor: 138120,
        cashInEurMinor: 116120,
      },
    ],
  };
}

export function sampleWeeklyReportData(): ReportData {
  const daily: ReportData['daily'] = (
    [
      ['2026-06-22', 9, 8200, 47800, 31500],
      ['2026-06-23', 6, 7900, 104410, 42900],
      ['2026-06-24', 4, 7400, 21300, 36100],
      ['2026-06-25', 8, 9100, 139600, 64200],
      ['2026-06-26', 3, 6800, 12700, 29800],
      ['2026-06-27', 5, 8700, 51900, 71900],
      ['2026-06-28', 3, 7300, 28100, 18400],
    ] as const
  ).map(([date, registrations, adSpendEurMinor, soldEurMinor, cashInEurMinor]) => ({
    date,
    registrations,
    adSpendEurMinor,
    soldEurMinor,
    cashInEurMinor,
  }));

  return {
    from: '2026-06-22',
    to: '2026-06-28',
    registrations: {
      total: 38,
      byWorkshop: [
        { title: 'Somatic Vocal Healing Workshop', count: 18, seats: 31, date: 'Mon 22 Jun 2026' },
        { title: 'Somatic Vocal Healing Workshop', count: 11, seats: 14, date: 'Fri 26 Jun 2026' },
        { title: 'SVH Masterclass', count: 9, seats: 17, date: 'Thu 25 Jun 2026' },
      ],
    },
    courseSales: {
      total: 7,
      plans: 4,
      fullValueEurMinor: 305550,
      chargedEurMinor: 151480,
      byProduct: [
        { label: 'Certification — cert only', count: 2, plans: 2, fullValueEurMinor: 131800, chargedEurMinor: 43900 },
        { label: '12-Week SVH Course', count: 4, plans: 2, fullValueEurMinor: 163650, chargedEurMinor: 97480 },
        { label: 'The Grief Course', count: 1, plans: 0, fullValueEurMinor: 10100, chargedEurMinor: 10100 },
      ],
    },
    workshopBumps: { count: 14, netEurMinor: 10400 },
    courseBumps: {
      count: 4,
      eurMinor: 24460,
      byLabel: [
        { label: 'The Authentic Singing Journey', count: 2, eurMinor: 16360 },
        { label: 'The Grief Course', count: 2, eurMinor: 8100 },
      ],
    },
    sold: {
      ticketsEurMinor: 32700,
      masterclassEurMinor: 32700,
      workshopBumpsEurMinor: 10400,
      workshopCourseAddonsEurMinor: 0,
      courseSalesEurMinor: 305550,
      courseBumpsEurMinor: 24460,
      totalEurMinor: 405810,
      stillToBillEurMinor: 154070,
    },
    cash: {
      workshopEurMinor: 75800,
      courseFirstPaymentsEurMinor: 151480,
      courseBumpsEurMinor: 24460,
      installmentsEurMinor: 65560,
      installmentCount: 4,
      refundsEurMinor: 22500,
      refundCount: 1,
      totalEurMinor: 294800,
    },
    ads: {
      spendEurMinor: 55400,
      prospectingEurMinor: 46100,
      retargetingEurMinor: 9300,
      roas: 7.33,
      workshop: {
        registrations: 29,
        adSpendEurMinor: 24900,
        costPerRegistrationEurMinor: 859,
        revenueEurMinor: 198400,
        roas: 7.97,
      },
      masterclass: {
        registrations: 9,
        adSpendEurMinor: 21200,
        costPerRegistrationEurMinor: 2356,
        revenueEurMinor: 141300,
        roas: 6.67,
      },
    },
    daily,
  };
}

async function sendOne(
  env: ReportEnv,
  externalId: string,
  gather: () => Promise<ReportData>,
  build: (data: ReportData) => EmailContent,
): Promise<boolean> {
  let claimed = false;
  try {
    claimed = await claimReport(env.DB, externalId);
    if (!claimed) return false; // already sent (or in flight) today
    const data = await gather();
    const content = build(data);
    await sendEmail({
      apiKey: env.RESEND_API_KEY!,
      to: reportRecipients(env),
      replyTo: env.RESEND_REPLY_TO,
      subject: content.subject,
      html: content.html,
      text: content.text,
      entityRefId: externalId,
    });
    // Delivered — promote the claim so the stale-claim retry never re-sends it.
    await confirmReport(env.DB, externalId).catch(() => {});
    return true;
  } catch (err) {
    // Surface the reason (the caller only logs on success) and drop the
    // unconfirmed claim so a later hourly tick retries this same day.
    console.error(`[reports] send failed for ${externalId}`, err);
    if (claimed) await releaseReport(env.DB, externalId).catch(() => {});
    return false;
  }
}
