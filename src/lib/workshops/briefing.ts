// Pre-workshop briefing — an internal "SD-BRIEFING" ops email sent ~5 minutes
// before each live workshop/masterclass so Jacob walks in already knowing the
// room: how many secured a seat, what a registration cost in ad spend, which
// page each seat was taken on, the order-bump uptake and every country people
// are joining from. (The three-door audience mix was taken out in November
// 2026 — Jacob's call.) NOT customer-facing; the subject is prefixed
// `SD-BRIEFING ·` for inbox filtering, a sibling to the SD-ORDER / SD-REPORT
// mails.
//
// The cron trigger + once-per-workshop idempotency live in cron.ts
// (runPreWorkshopBriefing, on the existing 5-minute tick); this module is the
// pure data-gather + email render + preview sample, mirroring the SD-REPORT
// digests in reports.ts.

import { getProductById, workshopIsMasterclass, type Workshop } from './db';
import { formatInTz } from './time';
import { brusselsToday, businessDayOf } from './periods';
import { computeWorkshopPerformance, type MoneyOpts } from './stats';
import { countryName } from './countries';
import type { EmailContent } from './emails';

// Where a seat was taken (workshop_registrations.signup_page, see
// signup-page.ts) → the words the briefing prints. A page nobody named keeps
// its own path; a seat from before the column existed, or one made by hand,
// has none.
const PAGE_LABELS: Record<string, string> = {
  masterclass: 'Masterclass page',
  'heal-the-healer': 'Heal the Healer page',
  workshop: 'Workshop page',
  w: 'Direct session link',
};
const PAGE_UNKNOWN = 'Not recorded';
export const signupPageLabel = (page: string | null | undefined): string => {
  const key = (page ?? '').trim();
  return key ? PAGE_LABELS[key] ?? key : PAGE_UNKNOWN;
};

export type BriefingData = {
  workshopId: number | null;
  workshopTitle: string;
  isMasterclass: boolean;
  whenLocal: string; // formatted start in the workshop's display timezone
  displayTz: string;
  registered: number; // secured (paid/coupon) seats
  // What a registration for this session cost: the prospecting ad spend its
  // own seats pulled, day by day, ÷ its seats — the session's figure on
  // /admin/workshops/performance. Null when no spend was charged to it, or the
  // figure could not be worked out in time.
  costPerRegistrationEurMinor: number | null;
  adSpendEurMinor: number | null; // that prospecting spend, in total
  bump: { count: number; label: string | null }; // order-bump uptake (intent or bought)
  pages: Array<{ label: string; count: number }>; // where each seat was taken
  countries: Array<{ country: string; count: number }>; // every country, most seats first
  noCountry: number; // seats with no country on file
};

// ── Data ────────────────────────────────────────────────────────────────────

// Gather every figure for one workshop's briefing. Pure read; safe for previews.
export async function gatherBriefingData(
  db: D1Database,
  w: Workshop,
  money?: MoneyOpts,
): Promise<BriefingData> {
  const isMasterclass = await workshopIsMasterclass(db, w);

  // signup_page arrived with migration 0083; read apart so the briefing never
  // depends on it.
  const regRes = await db
    .prepare(
      `SELECT id, country, created_at
         FROM workshop_registrations
        WHERE workshop_id = ? AND payment_status IN ('paid','coupon')`,
    )
    .bind(w.id)
    .all<{ id: number; country: string | null; created_at: string }>();
  const rows = regRes.results ?? [];

  const pageOf = new Map<number, string | null>();
  try {
    const pageRes = await db
      .prepare(
        `SELECT id, signup_page FROM workshop_registrations
          WHERE workshop_id = ? AND payment_status IN ('paid','coupon')`,
      )
      .bind(w.id)
      .all<{ id: number; signup_page: string | null }>();
    for (const r of pageRes.results ?? []) pageOf.set(r.id, r.signup_page);
  } catch {
    // Every seat reads "Not recorded".
  }

  const countryCounts = new Map<string, number>();
  const pageCounts = new Map<string, number>();
  let noCountry = 0;
  let firstDay: string | null = null;
  for (const r of rows) {
    const c = (r.country ?? '').trim().toUpperCase();
    if (c) countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
    else noCountry += 1;
    const label = signupPageLabel(pageOf.get(r.id));
    pageCounts.set(label, (pageCounts.get(label) ?? 0) + 1);
    const day = businessDayOf(r.created_at);
    if (day && (!firstDay || day < firstDay)) firstDay = day;
  }

  // The session's own seat price, off the performance report (one calculation
  // for this figure site-wide), over the days its seats came in. The briefing
  // goes out minutes before the session, so a slow or failed read costs the
  // figure, never the email.
  let costPerRegistrationEurMinor: number | null = null;
  let adSpendEurMinor: number | null = null;
  if (firstDay) {
    try {
      const perf = await computeWorkshopPerformance(db, { from: firstDay, to: brusselsToday(), money });
      const row = perf.rows.find((x) => x.workshopId === w.id);
      if (row?.costPerRegistrationEurMinor != null) {
        costPerRegistrationEurMinor = Math.round(row.costPerRegistrationEurMinor);
        adSpendEurMinor =
          row.acquisitionCostEurMinor != null ? Math.round(row.acquisitionCostEurMinor) : null;
      }
    } catch (err) {
      console.error(`[workshops/briefing] seat price for workshop ${w.id} failed`, err);
    }
  }

  // Order-bump uptake: either intent (wants_bump) or an actually-recorded bump
  // purchase line. Counted once per registration.
  const bumpRow = await db
    .prepare(
      `SELECT COUNT(DISTINCT r.id) AS n
         FROM workshop_registrations r
         LEFT JOIN workshop_purchases pur
           ON pur.registration_id = r.id AND pur.product_type = 'bump'
        WHERE r.workshop_id = ? AND r.payment_status IN ('paid','coupon')
          AND (r.wants_bump = 1 OR pur.id IS NOT NULL)`,
    )
    .bind(w.id)
    .first<{ n: number }>();
  const bumpProduct = w.bump_product_id ? await getProductById(db, w.bump_product_id) : null;

  const countries = [...countryCounts.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
  // Named pages first, most seats first; "Not recorded" last.
  const pages = [...pageCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort(
      (a, b) =>
        Number(a.label === PAGE_UNKNOWN) - Number(b.label === PAGE_UNKNOWN) ||
        b.count - a.count ||
        a.label.localeCompare(b.label),
    );

  return {
    workshopId: w.id,
    workshopTitle: w.title,
    isMasterclass,
    whenLocal: formatInTz(w.starts_at_utc, w.display_tz),
    displayTz: w.display_tz,
    registered: rows.length,
    costPerRegistrationEurMinor,
    adSpendEurMinor,
    bump: { count: bumpRow?.n ?? 0, label: bumpProduct?.name ?? null },
    pages,
    countries,
    noCountry,
  };
}

// ── Email rendering (internal, light theme — mirrors reports.ts) ─────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const C = {
  bg: '#f3f4f6',
  card: '#ffffff',
  border: '#e5e7eb',
  track: '#eef0f3',
  ink: '#111827',
  muted: '#6b7280',
  faint: '#9ca3af',
};

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
const eur = (minor: number) =>
  '€' + (minor / 100).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const seatPrice = (data: BriefingData) =>
  data.costPerRegistrationEurMinor != null ? eur(data.costPerRegistrationEurMinor) : '—';
const seatPriceNote = (data: BriefingData) =>
  data.costPerRegistrationEurMinor != null
    ? `Price per registration = the prospecting ad spend this session’s own seats pulled, day by day${
        data.adSpendEurMinor != null ? ` (${eur(data.adSpendEurMinor)})` : ''
      }, divided by its ${data.registered} registered. Ad spend as last read from Meta.`
    : 'Price per registration: no ad spend is charged to this session’s seats.';
const pageBlurb = 'Seats taken on this page';

function sectionLabel(text: string): string {
  return `<p style="margin:24px 0 10px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${C.faint};">${escapeHtml(text)}</p>`;
}

// A row of stat cards (label + big number).
function statCards(cards: Array<{ label: string; value: string; sub?: string }>): string {
  const cells = cards
    .map(
      (c) =>
        `<td valign="top" style="padding:6px;width:${Math.floor(100 / cards.length)}%;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafb;border:1px solid ${C.border};border-radius:10px;">
            <tr><td style="padding:14px 16px;">
              <p style="margin:0 0 4px;font-size:12px;color:${C.muted};">${escapeHtml(c.label)}</p>
              <p style="margin:0;font-size:22px;font-weight:600;color:${C.ink};">${escapeHtml(c.value)}</p>
              ${c.sub ? `<p style="margin:4px 0 0;font-size:11px;color:${C.faint};">${escapeHtml(c.sub)}</p>` : ''}
            </td></tr>
          </table>
        </td>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -6px;"><tr>${cells}</tr></table>`;
}

// One horizontal bar: label + blurb on the left, a filled track + count/percent
// on the right. Width is the row's share of registrants.
function bar(label: string, blurb: string, color: string, count: number, total: number): string {
  const p = pct(count, total);
  const fill = Math.max(count > 0 ? 4 : 0, p); // keep a sliver visible for a non-zero count
  const empty = Math.max(0, 100 - fill);
  const track =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:7px;overflow:hidden;background:${C.track};"><tr style="height:14px;">` +
    (fill > 0
      ? `<td style="background:${color};height:14px;width:${fill}%;font-size:0;line-height:0;">&nbsp;</td>`
      : '') +
    (empty > 0 ? `<td style="height:14px;width:${empty}%;font-size:0;line-height:0;">&nbsp;</td>` : '') +
    `</tr></table>`;
  return `<tr>
    <td style="padding:8px 12px 8px 0;vertical-align:top;width:170px;">
      <p style="margin:0;font-size:14px;font-weight:600;color:${C.ink};">${escapeHtml(label)}</p>
      <p style="margin:2px 0 0;font-size:11px;color:${C.faint};line-height:1.4;">${escapeHtml(blurb)}</p>
    </td>
    <td style="padding:8px 0;vertical-align:middle;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;">${track}</td>
        <td style="vertical-align:middle;width:70px;padding-left:12px;white-space:nowrap;text-align:right;font-size:13px;color:${C.muted};">${count} · ${p}%</td>
      </tr></table>
    </td>
  </tr>`;
}

const PAGE_COLOR = '#4B4699';

function pagesSection(data: BriefingData): string {
  if (data.pages.length === 0) return '';
  const rows = data.pages
    .map((p) =>
      p.label === PAGE_UNKNOWN
        ? bar(p.label, 'Added by hand, or no page sent', C.faint, p.count, data.registered)
        : bar(p.label, pageBlurb, PAGE_COLOR, p.count, data.registered),
    )
    .join('');
  return (
    sectionLabel('Where they registered') +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`
  );
}

function countriesSection(data: BriefingData): string {
  if (data.countries.length === 0 && data.noCountry === 0) return '';
  const chip = (text: string) =>
    `<span style="display:inline-block;margin:0 6px 6px 0;padding:5px 10px;background:#f9fafb;border:1px solid ${C.border};border-radius:999px;font-size:13px;color:${C.ink};">${escapeHtml(text)}</span>`;
  const chips =
    data.countries.map((c) => chip(`${countryName(c.country) || c.country} · ${c.count}`)).join('') +
    (data.noCountry > 0 ? chip(`No country on file · ${data.noCountry}`) : '');
  return (
    sectionLabel(`Where the room is joining from — ${data.countries.length} ${data.countries.length === 1 ? 'country' : 'countries'}`) +
    `<div>${chips}</div>`
  );
}

function renderBriefing(data: BriefingData, baseUrl: string): string {
  const b = baseUrl.replace(/\/$/, '');
  const kind = data.isMasterclass ? 'Masterclass' : 'Workshop';

  const bumpValue =
    data.bump.count > 0
      ? `${data.bump.count} · ${pct(data.bump.count, data.registered)}%`
      : '—';
  const snapshot = statCards([
    { label: 'Registered', value: String(data.registered) },
    { label: 'Price per registration', value: seatPrice(data), sub: 'ad spend ÷ registered' },
    { label: data.bump.label ? `Add-on · ${data.bump.label}` : 'Order add-on', value: bumpValue },
  ]);

  const cta = data.workshopId
    ? `<tr><td style="padding:20px 26px 26px;">
        <a href="${b}/admin/workshops/${data.workshopId}" style="display:inline-block;padding:9px 16px;background:${C.ink};color:#ffffff;font-size:13px;text-decoration:none;border-radius:8px;">Open the registrant list →</a>
      </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Pre-workshop briefing</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.ink};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
    <tr><td align="center" style="padding:28px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:${C.card};border:1px solid ${C.border};border-radius:12px;">
        <tr><td style="padding:22px 26px 6px;">
          <p style="margin:0 0 2px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${C.faint};">Songdance · pre-${kind.toLowerCase()} briefing</p>
          <h1 style="margin:0;font-size:20px;font-weight:600;color:${C.ink};">${escapeHtml(data.workshopTitle)}</h1>
          <p style="margin:4px 0 0;font-size:14px;color:${C.muted};">Starting shortly · ${escapeHtml(data.whenLocal)}</p>
        </td></tr>
        <tr><td style="padding:16px 20px 0;">${snapshot}</td></tr>
        <tr><td style="padding:0 26px;">
          <p style="margin:10px 0 0;font-size:12px;color:${C.faint};line-height:1.5;">${escapeHtml(seatPriceNote(data))}</p>
          ${pagesSection(data)}
          ${countriesSection(data)}
        </td></tr>
        ${cta}
      </table>
      <p style="margin:14px 0 0;font-size:11px;color:${C.faint};line-height:1.6;max-width:560px;">Automated briefing · Songdance. Sent about five minutes before the session from the secured (paid/coupon) registrations on record at send time.</p>
    </td></tr>
  </table>
</body></html>`;
}

function renderBriefingText(data: BriefingData): string {
  const kind = data.isMasterclass ? 'Masterclass' : 'Workshop';
  const lines: string[] = [
    `PRE-${kind.toUpperCase()} BRIEFING — ${data.workshopTitle}`,
    `Starting shortly · ${data.whenLocal}`,
    '',
    `Registered: ${data.registered} · Price per registration: ${seatPrice(data)}`,
    `  ${seatPriceNote(data)}`,
    data.bump.count > 0
      ? `Order add-on${data.bump.label ? ` (${data.bump.label})` : ''}: ${data.bump.count} · ${pct(data.bump.count, data.registered)}%`
      : 'Order add-on: none',
  ];
  if (data.pages.length > 0) {
    lines.push('', 'WHERE THEY REGISTERED');
    for (const p of data.pages) lines.push(`  ${p.label}: ${p.count} · ${pct(p.count, data.registered)}%`);
  }
  if (data.countries.length > 0 || data.noCountry > 0) {
    lines.push('', 'WHERE THE ROOM IS JOINING FROM');
    for (const c of data.countries) lines.push(`  ${countryName(c.country) || c.country}: ${c.count}`);
    if (data.noCountry > 0) lines.push(`  No country on file: ${data.noCountry}`);
  }
  return lines.join('\n');
}

export function buildBriefingEmail(data: BriefingData, baseUrl: string): EmailContent {
  const kind = data.isMasterclass ? 'Masterclass' : 'Workshop';
  const subject = `SD-BRIEFING · ${data.workshopTitle} starting soon — ${data.registered} registered`;
  return {
    subject,
    html: renderBriefing(data, baseUrl),
    text: renderBriefingText(data),
  };
}

// ── Sample data (drives the /admin/emails preview + test-send) ───────────────

export function sampleBriefingData(): BriefingData {
  return {
    workshopId: 42,
    workshopTitle: 'Somatic Vocal Healing Workshop',
    isMasterclass: false,
    whenLocal: 'Mon 15 Jun 2026, 20:00 CEST',
    displayTz: 'Europe/Brussels',
    registered: 24,
    costPerRegistrationEurMinor: 1840,
    adSpendEurMinor: 44160,
    bump: { count: 9, label: 'Empowering You mantra pack' },
    pages: [
      { label: 'Workshop page', count: 15 },
      { label: 'Masterclass page', count: 5 },
      { label: 'Direct session link', count: 3 },
      { label: PAGE_UNKNOWN, count: 1 },
    ],
    countries: [
      { country: 'BE', count: 6 },
      { country: 'NL', count: 5 },
      { country: 'US', count: 4 },
      { country: 'DE', count: 3 },
      { country: 'GB', count: 2 },
      { country: 'FR', count: 1 },
      { country: 'CA', count: 1 },
      { country: 'AU', count: 1 },
    ],
    noCountry: 1,
  };
}
