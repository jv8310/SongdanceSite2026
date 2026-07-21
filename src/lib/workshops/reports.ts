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
//                               and the 12-week checkout order bumps (the `bumps`
//                               JSON on course_registrations).
//   • Revenue                 — the streams above, summed.
//
// Numbers reuse the exact same compute functions as /admin/stats
// (computeStats + computeCourseSales), so a figure here matches what the
// dashboard shows for the same window. Windows are resolved against the
// business timezone (Europe/Brussels) just like the stats-page presets, so
// "yesterday" / "last 7 days" line up with the dashboard's own presets.
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
  mergeDailyStreams,
  resolveMoneyOpts,
  type MoneyOpts,
  type StreamDay,
} from './stats';
import { FX_TO_EUR, formatMoney } from './currency';
import { shiftDays } from './periods';
import { localHour } from './time';
import { sendEmail } from './resend';
import { parsePurchasedBumps } from '../courses/db';
import { BUMPS, isBumpSlug } from '../courses/bumps';
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

export type ReportData = {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  registrations: {
    total: number; // new paid/coupon seats in the window
    byWorkshop: Array<{ title: string; count: number; date: string }>;
  };
  courseSales: {
    total: number;
    netEurMinor: number;
    byProduct: Array<{ label: string; count: number; netEurMinor: number }>;
  };
  // Workshop order bump (workshop_purchases, product_type='bump').
  workshopBumps: { count: number; netEurMinor: number };
  // 12-week checkout order bumps (the `bumps` JSON on course_registrations).
  courseBumps: {
    count: number;
    eurMinor: number;
    byLabel: Array<{ label: string; count: number; eurMinor: number }>;
  };
  revenue: {
    ticketsNetEurMinor: number; // workshop tickets, masterclass excluded
    masterclassNetEurMinor: number;
    workshopBumpsNetEurMinor: number;
    workshopCourseAddonsNetEurMinor: number; // course add-ons sold via a workshop checkout
    courseSalesNetEurMinor: number; // standalone course sales
    courseBumpsEurMinor: number;
    totalEurMinor: number;
    adSpendEurMinor: number;
    roas: number | null; // matches the dashboard's blended ROAS (excludes course bumps)
    costPerRegEurMinor: number | null; // ad spend ÷ workshop registrations (null if no spend/regs)
  };
  daily: StreamDay[]; // per-day streams over the window (used by the weekly digest)
};

const toEnd = (to: string) => `${to} 23:59:59`;

// Gather every figure for [from, to]. Pure read; safe to call for a preview.
// `money` (live FX + Quaderno VAT netting) keeps the digest's course figures
// identical to the dashboard's — omit it and they fall back to gross/fallback.
export async function gatherReportData(
  db: D1Database,
  from: string,
  to: string,
  money?: MoneyOpts,
): Promise<ReportData> {
  const stats = await computeStats(db, { from, to });
  const courses = await computeCourseSales(db, { from, to, money });

  // New registrations (secured seats) per workshop in the window. Grouped by
  // workshop id (not just title), since the same title (e.g. "Somatic Vocal
  // Healing Workshop") recurs across many scheduled instances — the date is
  // what tells two rows apart.
  const regRes = await db
    .prepare(
      `SELECT w.title AS title, w.starts_at_utc AS starts_at_utc,
              w.display_tz AS display_tz, w.is_replay AS is_replay, COUNT(*) AS n
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
    }>();
  const byWorkshop = (regRes.results ?? []).map((r) => ({
    title: r.title,
    count: r.n,
    date: r.is_replay ? 'On demand' : workshopDateLabel(r.starts_at_utc, r.display_tz),
  }));
  const regTotal = byWorkshop.reduce((s, r) => s + r.count, 0);

  // 12-week checkout order bumps: parse the JSON on course rows paid in the
  // window, convert to EUR with the fallback table (the bump's currency is the
  // course row's currency), aggregate by product label.
  const cbRes = await db
    .prepare(
      `SELECT bumps, currency FROM course_registrations
        WHERE paid_at IS NOT NULL AND status NOT IN ('pending','expired')
          AND bumps IS NOT NULL
          AND paid_at >= ? AND paid_at <= ?`,
    )
    .bind(from, toEnd(to))
    .all<{ bumps: string; currency: string }>();
  const bumpMap = new Map<string, { count: number; eurMinor: number }>();
  let courseBumpCount = 0;
  let courseBumpEurMinor = 0;
  for (const row of cbRes.results ?? []) {
    const rate = FX_TO_EUR[(row.currency || 'EUR').toUpperCase()] ?? 1;
    for (const b of parsePurchasedBumps(row.bumps)) {
      const eur = Math.round(b.amount_cents * rate);
      const label = isBumpSlug(b.slug) ? BUMPS[b.slug].label : b.slug;
      const e = bumpMap.get(label) ?? { count: 0, eurMinor: 0 };
      e.count += 1;
      e.eurMinor += eur;
      bumpMap.set(label, e);
      courseBumpCount += 1;
      courseBumpEurMinor += eur;
    }
  }
  const courseBumpsByLabel = [...bumpMap.entries()]
    .map(([label, v]) => ({ label, count: v.count, eurMinor: v.eurMinor }))
    .sort((a, b) => b.eurMinor - a.eurMinor);

  const t = stats.totals;
  // Total = workshop-engine net (tickets + masterclass + workshop bumps +
  // workshop course add-ons) + standalone course sales + course order bumps.
  const totalEurMinor = t.netEurMinor + courses.totalNetEurMinor + courseBumpEurMinor;
  // ROAS mirrors the dashboard's blended figure (engine net + course sales),
  // so it reconciles with /admin/stats.
  const roasNet = t.netEurMinor + courses.totalNetEurMinor;

  return {
    from,
    to,
    registrations: { total: regTotal, byWorkshop },
    courseSales: {
      total: courses.totalCount,
      netEurMinor: courses.totalNetEurMinor,
      byProduct: courses.byProduct.map((p) => ({
        label: p.label,
        count: p.count,
        netEurMinor: p.netEurMinor,
      })),
    },
    workshopBumps: { count: t.bumpCount, netEurMinor: t.bumpNetEurMinor },
    courseBumps: {
      count: courseBumpCount,
      eurMinor: courseBumpEurMinor,
      byLabel: courseBumpsByLabel,
    },
    revenue: {
      ticketsNetEurMinor: t.ticketNetEurMinor,
      masterclassNetEurMinor: t.masterclassNetEurMinor,
      workshopBumpsNetEurMinor: t.bumpNetEurMinor,
      workshopCourseAddonsNetEurMinor: t.courseNetEurMinor,
      courseSalesNetEurMinor: courses.totalNetEurMinor,
      courseBumpsEurMinor: courseBumpEurMinor,
      totalEurMinor,
      adSpendEurMinor: stats.adSpendEurMinor,
      roas: stats.adSpendEurMinor > 0 ? roasNet / stats.adSpendEurMinor : null,
      // Ad spend ÷ new workshop registrations — same definition the stats page
      // and /ads dashboard use (cost per registration). Null with no spend/regs.
      costPerRegEurMinor:
        stats.adSpendEurMinor > 0 && regTotal > 0
          ? Math.round(stats.adSpendEurMinor / regTotal)
          : null,
    },
    daily: mergeDailyStreams(stats, courses, from, to),
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

const eur = (m: number) => formatMoney(m, 'EUR');

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

// A row of stat cards (label + big number).
function statCards(cards: Array<{ label: string; value: string }>): string {
  const cells = cards
    .map(
      (c) =>
        `<td valign="top" style="padding:6px;width:${Math.floor(100 / cards.length)}%;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafb;border:1px solid ${C.border};border-radius:10px;">
            <tr><td style="padding:14px 16px;">
              <p style="margin:0 0 4px;font-size:12px;color:${C.muted};">${escapeHtml(c.label)}</p>
              <p style="margin:0;font-size:22px;font-weight:600;color:${C.ink};">${escapeHtml(c.value)}</p>
            </td></tr>
          </table>
        </td>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -6px;"><tr>${cells}</tr></table>`;
}

// A two-column "label … value" table.
function kvTable(rows: Array<[string, string]>, opts: { boldLast?: boolean } = {}): string {
  const body = rows
    .map(([label, value], i) => {
      const strong = opts.boldLast && i === rows.length - 1;
      const weight = strong ? '600' : '400';
      const top = strong ? `border-top:1px solid ${C.border};` : '';
      return `<tr>
        <td style="padding:7px 14px 7px 0;font-size:14px;color:${C.muted};vertical-align:top;${top}">${escapeHtml(label)}</td>
        <td align="right" style="padding:7px 0;font-size:14px;font-weight:${weight};color:${C.ink};white-space:nowrap;vertical-align:top;${top}">${escapeHtml(value)}</td>
      </tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>`;
}

// A headered data table.
function dataTable(headers: string[], rows: string[][]): string {
  const head = headers
    .map(
      (h, i) =>
        `<th align="${i === 0 ? 'left' : 'right'}" style="padding:6px 10px;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:${C.faint};border-bottom:1px solid ${C.border};font-weight:600;">${escapeHtml(h)}</th>`,
    )
    .join('');
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells
          .map(
            (c, i) =>
              `<td align="${i === 0 ? 'left' : 'right'}" style="padding:7px 10px;font-size:13px;color:${i === 0 ? C.ink : C.muted};border-bottom:1px solid #f1f2f4;white-space:${i === 0 ? 'normal' : 'nowrap'};">${escapeHtml(c)}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${head}</tr>${body}</table>`;
}

function emptyNote(text: string): string {
  return `<p style="margin:2px 0 0;font-size:13px;color:${C.faint};font-style:italic;">${escapeHtml(text)}</p>`;
}

// The shared frame + the sections common to both digests.
function renderReport(opts: {
  kindLabel: string;
  rangeLabel: string;
  data: ReportData;
  extraSectionsHtml?: string;
  baseUrl: string;
}): string {
  const { kindLabel, rangeLabel, data, extraSectionsHtml, baseUrl } = opts;
  const r = data.revenue;
  const b = baseUrl.replace(/\/$/, '');

  const snapshot = statCards([
    { label: 'Registrations', value: String(data.registrations.total) },
    { label: 'Course sales', value: String(data.courseSales.total) },
    { label: 'Total revenue', value: eur(r.totalEurMinor) },
  ]);

  // Ad-efficiency headline — cost per workshop registration + blended ROAS,
  // shown as their own boxes at the top ('—' when there's no ad spend to divide).
  const adEfficiency = statCards([
    {
      label: 'Cost / workshop registration',
      value: r.costPerRegEurMinor != null ? eur(r.costPerRegEurMinor) : '—',
    },
    { label: 'Blended ROAS', value: r.roas != null ? r.roas.toFixed(2) + '×' : '—' },
  ]);

  const regSection =
    sectionLabel('Workshop registrations') +
    (data.registrations.byWorkshop.length
      ? dataTable(
          ['Workshop', 'Date', 'New seats'],
          data.registrations.byWorkshop.map((w) => [w.title, w.date, String(w.count)]),
        )
      : emptyNote('No new registrations in this window.'));

  const courseSection =
    sectionLabel('Course sales') +
    (data.courseSales.byProduct.length
      ? dataTable(
          ['Product', 'Sales', 'Net'],
          data.courseSales.byProduct.map((p) => [p.label, String(p.count), eur(p.netEurMinor)]),
        )
      : emptyNote('No course sales in this window.'));

  // Bump offers — workshop order bump + 12-week checkout order bumps.
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

  const revenueSection =
    sectionLabel('Revenue') +
    kvTable(
      [
        ['Workshop tickets', eur(r.ticketsNetEurMinor)],
        ['Masterclass', eur(r.masterclassNetEurMinor)],
        ['Workshop order bumps', eur(r.workshopBumpsNetEurMinor)],
        ['Course add-ons (via workshop)', eur(r.workshopCourseAddonsNetEurMinor)],
        ['Standalone course sales', eur(r.courseSalesNetEurMinor)],
        ['Course order bumps', eur(r.courseBumpsEurMinor)],
        ['Total', eur(r.totalEurMinor)],
      ],
      { boldLast: true },
    ) +
    (r.adSpendEurMinor > 0
      ? `<p style="margin:10px 0 0;font-size:13px;color:${C.muted};">Ad spend ${eur(
          r.adSpendEurMinor,
        )} · blended ROAS ${r.roas != null ? r.roas.toFixed(2) + '×' : '—'}</p>`
      : '');

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
          ${regSection}
          ${courseSection}
          ${bumpSection}
          ${revenueSection}
          ${extraSectionsHtml ?? ''}
        </td></tr>
        <tr><td style="padding:18px 26px 26px;">
          <a href="${b}/admin/stats" style="display:inline-block;padding:9px 16px;background:${C.ink};color:#ffffff;font-size:13px;text-decoration:none;border-radius:8px;">Open dashboard →</a>
        </td></tr>
      </table>
      <p style="margin:14px 0 0;font-size:11px;color:${C.faint};line-height:1.6;max-width:560px;">Automated report · Songdance. Workshop figures are net of tax; course-sale figures are the amount collected (gross of VAT), converted to EUR at fallback rates — same conventions as the stats dashboard.</p>
    </td></tr>
  </table>
</body></html>`;
  return html;
}

// Plain-text counterpart (compact but complete).
function renderReportText(kindLabel: string, rangeLabel: string, data: ReportData): string {
  const r = data.revenue;
  const lines: string[] = [kindLabel, rangeLabel, ''];
  lines.push(
    `Registrations: ${data.registrations.total} · Course sales: ${data.courseSales.total} · Total revenue: ${eur(
      r.totalEurMinor,
    )}`,
    `Cost / workshop registration: ${
      r.costPerRegEurMinor != null ? eur(r.costPerRegEurMinor) : '—'
    } · Blended ROAS: ${r.roas != null ? r.roas.toFixed(2) + '×' : '—'}`,
    '',
    'WORKSHOP REGISTRATIONS',
  );
  if (data.registrations.byWorkshop.length) {
    for (const w of data.registrations.byWorkshop)
      lines.push(`  ${w.title} (${w.date}): ${w.count}`);
  } else lines.push('  (none)');
  lines.push('', 'COURSE SALES');
  if (data.courseSales.byProduct.length) {
    for (const p of data.courseSales.byProduct)
      lines.push(`  ${p.label}: ${p.count} · ${eur(p.netEurMinor)}`);
  } else lines.push('  (none)');
  lines.push('', 'BUMP OFFERS');
  if (data.workshopBumps.count > 0)
    lines.push(`  Workshop order bump: ${data.workshopBumps.count} · ${eur(data.workshopBumps.netEurMinor)}`);
  if (data.courseBumps.byLabel.length) {
    for (const bump of data.courseBumps.byLabel)
      lines.push(`  Course bump · ${bump.label}: ${bump.count} · ${eur(bump.eurMinor)}`);
  }
  if (data.workshopBumps.count === 0 && data.courseBumps.byLabel.length === 0)
    lines.push('  (none)');
  lines.push(
    '',
    'REVENUE',
    `  Workshop tickets: ${eur(r.ticketsNetEurMinor)}`,
    `  Masterclass: ${eur(r.masterclassNetEurMinor)}`,
    `  Workshop order bumps: ${eur(r.workshopBumpsNetEurMinor)}`,
    `  Course add-ons (via workshop): ${eur(r.workshopCourseAddonsNetEurMinor)}`,
    `  Standalone course sales: ${eur(r.courseSalesNetEurMinor)}`,
    `  Course order bumps: ${eur(r.courseBumpsEurMinor)}`,
    `  Total: ${eur(r.totalEurMinor)}`,
  );
  if (r.adSpendEurMinor > 0) {
    lines.push(
      `  Ad spend: ${eur(r.adSpendEurMinor)} · blended ROAS ${r.roas != null ? r.roas.toFixed(2) + '×' : '—'}`,
    );
  }
  return lines.join('\n');
}

export function buildDailyReportEmail(data: ReportData, baseUrl: string): EmailContent {
  const kindLabel = 'Daily report';
  const rangeLabel = dayLabel(data.to);
  const subject = `SD-REPORT · Daily · ${dayLabel(data.to)} — ${data.registrations.total} reg · ${data.courseSales.total} course sales · ${eur(
    data.revenue.totalEurMinor,
  )}`;
  return {
    subject,
    html: renderReport({ kindLabel, rangeLabel, data, baseUrl }),
    text: renderReportText(kindLabel, rangeLabel, data),
  };
}

export function buildWeeklyReportEmail(data: ReportData, baseUrl: string): EmailContent {
  const kindLabel = 'Weekly report';
  const rangeLabel = `${dayLabel(data.from)} – ${dayLabel(data.to)}`;

  // Per-day revenue table — the week at a glance.
  const dailySection =
    data.daily.length > 0
      ? sectionLabel('Revenue by day') +
        dataTable(
          ['Day', 'Workshops', 'Courses', 'Total'],
          data.daily.map((d) => [
            shortDay(d.date),
            eur(d.workshopsEurMinor + d.masterclassEurMinor),
            eur(d.twelveWeekEurMinor + d.certificationEurMinor + d.otherCoursesEurMinor),
            eur(d.totalEurMinor),
          ]),
        ) +
        `<p style="margin:8px 0 0;font-size:12px;color:${C.faint};">Per-day totals exclude course order-bumps (counted in the totals above).</p>`
      : '';

  const subject = `SD-REPORT · Weekly · ${shortDay(data.from)}–${shortDay(data.to)} — ${data.registrations.total} reg · ${data.courseSales.total} course sales · ${eur(
    data.revenue.totalEurMinor,
  )}`;
  return {
    subject,
    html: renderReport({ kindLabel, rangeLabel, data, baseUrl, extraSectionsHtml: dailySection }),
    text: renderReportText(kindLabel, rangeLabel, data),
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
  return {
    from: '2026-06-29',
    to: '2026-06-29',
    registrations: {
      total: 7,
      byWorkshop: [
        { title: 'Somatic Vocal Healing Workshop', count: 5, date: 'Mon 29 Jun 2026' },
        { title: 'SVH Masterclass', count: 2, date: 'Wed 1 Jul 2026' },
      ],
    },
    courseSales: {
      total: 2,
      netEurMinor: 204700,
      byProduct: [
        { label: 'Certification — cert only', count: 1, netEurMinor: 165000 },
        { label: '12-Week SVH Course', count: 1, netEurMinor: 39700 },
      ],
    },
    workshopBumps: { count: 3, netEurMinor: 5700 },
    courseBumps: {
      count: 1,
      eurMinor: 1900,
      byLabel: [{ label: 'The Authentic Singing Journey', count: 1, eurMinor: 1900 }],
    },
    revenue: {
      ticketsNetEurMinor: 3600,
      masterclassNetEurMinor: 19400,
      workshopBumpsNetEurMinor: 5700,
      workshopCourseAddonsNetEurMinor: 0,
      courseSalesNetEurMinor: 204700,
      courseBumpsEurMinor: 1900,
      totalEurMinor: 235300,
      adSpendEurMinor: 8500,
      roas: 27.46,
      costPerRegEurMinor: 1214,
    },
    daily: [],
  };
}

export function sampleWeeklyReportData(): ReportData {
  const daily: StreamDay[] = [
    ['2026-06-22', 2100, 0, 39700, 0, 0],
    ['2026-06-23', 3400, 11800, 0, 165000, 0],
    ['2026-06-24', 1800, 0, 39700, 0, 9900],
    ['2026-06-25', 4200, 23600, 79400, 0, 0],
    ['2026-06-26', 2900, 0, 0, 165000, 9900],
    ['2026-06-27', 5100, 35400, 39700, 0, 0],
    ['2026-06-28', 3900, 16500, 79400, 0, 0],
  ].map(([date, ws, mc, tw, cert, other]) => {
    const d = date as string;
    const workshopsEurMinor = ws as number;
    const masterclassEurMinor = mc as number;
    const twelveWeekEurMinor = tw as number;
    const certificationEurMinor = cert as number;
    const otherCoursesEurMinor = other as number;
    return {
      date: d,
      workshopsEurMinor,
      masterclassEurMinor,
      twelveWeekEurMinor,
      certificationEurMinor,
      otherCoursesEurMinor,
      totalEurMinor:
        workshopsEurMinor +
        masterclassEurMinor +
        twelveWeekEurMinor +
        certificationEurMinor +
        otherCoursesEurMinor,
      adSpendEurMinor: 0,
      acquisitionAdSpendEurMinor: 0,
    };
  });

  return {
    from: '2026-06-22',
    to: '2026-06-28',
    registrations: {
      total: 38,
      byWorkshop: [
        { title: 'Somatic Vocal Healing Workshop', count: 18, date: 'Mon 22 Jun 2026' },
        { title: 'Somatic Vocal Healing Workshop', count: 11, date: 'Fri 26 Jun 2026' },
        { title: 'SVH Masterclass', count: 9, date: 'Thu 25 Jun 2026' },
      ],
    },
    courseSales: {
      total: 11,
      netEurMinor: 627700,
      byProduct: [
        { label: 'Certification — cert only', count: 2, netEurMinor: 330000 },
        { label: '12-Week SVH Course', count: 7, netEurMinor: 277900 },
        { label: 'The Grief Course', count: 2, netEurMinor: 19800 },
      ],
    },
    workshopBumps: { count: 14, netEurMinor: 26600 },
    courseBumps: {
      count: 5,
      eurMinor: 15500,
      byLabel: [
        { label: 'The Grief Course', count: 2, eurMinor: 9800 },
        { label: 'The Authentic Singing Journey', count: 3, eurMinor: 5700 },
      ],
    },
    revenue: {
      ticketsNetEurMinor: 23400,
      masterclassNetEurMinor: 87300,
      workshopBumpsNetEurMinor: 26600,
      workshopCourseAddonsNetEurMinor: 4500,
      courseSalesNetEurMinor: 627700,
      courseBumpsEurMinor: 15500,
      totalEurMinor: 785000,
      adSpendEurMinor: 62000,
      roas: 12.41,
      costPerRegEurMinor: 1632,
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
