// Pre-workshop briefing — an internal "SD-BRIEFING" ops email sent ~5 minutes
// before each live workshop/masterclass so Jacob walks in already knowing the
// room: how many secured a seat, the audience mix across the three doors
// (1 healing · 2 liberation · 3 professional), and a few other signals that
// shape how he holds the hour (practitioners present, order-bump uptake, where
// people are joining from). NOT customer-facing; the subject is prefixed
// `SD-BRIEFING ·` for inbox filtering, a sibling to the SD-ORDER / SD-REPORT
// mails.
//
// The cron trigger + once-per-workshop idempotency live in cron.ts
// (runPreWorkshopBriefing, on the existing 5-minute tick); this module is the
// pure data-gather + email render + preview sample, mirroring the SD-REPORT
// digests in reports.ts.

import {
  audienceIsPro,
  getProductById,
  workshopIsMasterclass,
  type Workshop,
} from './db';
import { formatInTz } from './time';
import type { EmailContent } from './emails';

// The three doors on the workshop page (see WESelector.astro) → readable names.
// The numeric keys are exactly what `workshop_registrations.audience` stores
// ("1", "2,3", …); door 3 is the practitioner door (audienceIsPro).
export const AUDIENCE_DOORS: Array<{ key: string; label: string; blurb: string; color: string }> = [
  { key: '1', label: 'Healing', blurb: 'Giving voice to something carried', color: '#A14826' },
  { key: '2', label: 'Liberation', blurb: 'Finding more freedom in the voice', color: '#2F7D6E' },
  { key: '3', label: 'Professional', blurb: 'Bringing the work into their own practice', color: '#4B4699' },
];

export type DoorCount = {
  key: string;
  label: string;
  blurb: string;
  color: string;
  count: number;
};

export type BriefingData = {
  workshopId: number | null;
  workshopTitle: string;
  isMasterclass: boolean;
  whenLocal: string; // formatted start in the workshop's display timezone
  displayTz: string;
  registered: number; // secured (paid/coupon) seats
  doors: DoorCount[]; // per-door tallies (a registrant may pick more than one)
  noDoor: number; // registrants who indicated no door
  practitioners: number; // door 3 or a masterclass seat
  bump: { count: number; label: string | null }; // order-bump uptake (intent or bought)
  topCountries: Array<{ country: string; count: number }>;
};

// ── Data ────────────────────────────────────────────────────────────────────

// Gather every figure for one workshop's briefing. Pure read; safe for previews.
export async function gatherBriefingData(db: D1Database, w: Workshop): Promise<BriefingData> {
  const isMasterclass = await workshopIsMasterclass(db, w);

  const regRes = await db
    .prepare(
      `SELECT audience, wants_bump, country
         FROM workshop_registrations
        WHERE workshop_id = ? AND payment_status IN ('paid','coupon')`,
    )
    .bind(w.id)
    .all<{ audience: string | null; wants_bump: number; country: string | null }>();
  const rows = regRes.results ?? [];

  const doorCounts = new Map<string, number>();
  const countryCounts = new Map<string, number>();
  let noDoor = 0;
  let practitioners = 0;
  for (const r of rows) {
    const doors = (r.audience ?? '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);
    if (doors.length === 0) noDoor += 1;
    for (const d of doors) doorCounts.set(d, (doorCounts.get(d) ?? 0) + 1);
    // A masterclass seat is a practitioner room by definition; on a regular
    // workshop it's the practitioner door (audience 3) — same signal the
    // post-workshop cron uses to route the certification path.
    if (isMasterclass || audienceIsPro(r.audience)) practitioners += 1;
    const c = (r.country ?? '').trim().toUpperCase();
    if (c) countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
  }

  const doors: DoorCount[] = AUDIENCE_DOORS.map((d) => ({
    ...d,
    count: doorCounts.get(d.key) ?? 0,
  }));

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

  const topCountries = [...countryCounts.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country))
    .slice(0, 5);

  return {
    workshopId: w.id,
    workshopTitle: w.title,
    isMasterclass,
    whenLocal: formatInTz(w.starts_at_utc, w.display_tz),
    displayTz: w.display_tz,
    registered: rows.length,
    doors,
    noDoor,
    practitioners,
    bump: { count: bumpRow?.n ?? 0, label: bumpProduct?.name ?? null },
    topCountries,
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

function sectionLabel(text: string): string {
  return `<p style="margin:24px 0 10px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${C.faint};">${escapeHtml(text)}</p>`;
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

// One horizontal bar: label + blurb on the left, a filled track + count/percent
// on the right. Width is the door's share of registrants (bars can sum past
// 100% because a registrant may pick more than one door — noted below the chart).
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

function audienceSection(data: BriefingData): string {
  const rows = data.doors.map((d) => bar(d.label, d.blurb, d.color, d.count, data.registered)).join('');
  const noDoorRow = data.noDoor > 0 ? bar('No door indicated', 'Registered without picking one', C.faint, data.noDoor, data.registered) : '';
  const note =
    `<p style="margin:10px 0 0;font-size:12px;color:${C.faint};line-height:1.5;">Bars show each door's share of the ${data.registered} registered — they can total more than 100% because someone can hold more than one door.</p>`;
  return (
    sectionLabel('Audience — the three doors') +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}${noDoorRow}</table>` +
    note
  );
}

function countriesSection(data: BriefingData): string {
  if (data.topCountries.length === 0) return '';
  const chips = data.topCountries
    .map(
      (c) =>
        `<span style="display:inline-block;margin:0 6px 6px 0;padding:5px 10px;background:#f9fafb;border:1px solid ${C.border};border-radius:999px;font-size:13px;color:${C.ink};">${escapeHtml(c.country)} · ${c.count}</span>`,
    )
    .join('');
  return sectionLabel('Where the room is joining from') + `<div>${chips}</div>`;
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
    { label: 'Practitioners', value: String(data.practitioners) },
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
          ${audienceSection(data)}
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
    `Registered: ${data.registered} · Practitioners: ${data.practitioners}`,
    data.bump.count > 0
      ? `Order add-on${data.bump.label ? ` (${data.bump.label})` : ''}: ${data.bump.count} · ${pct(data.bump.count, data.registered)}%`
      : 'Order add-on: none',
    '',
    'AUDIENCE — THE THREE DOORS',
  ];
  for (const d of data.doors) {
    lines.push(`  ${d.label} (${d.blurb}): ${d.count} · ${pct(d.count, data.registered)}%`);
  }
  if (data.noDoor > 0) lines.push(`  No door indicated: ${data.noDoor} · ${pct(data.noDoor, data.registered)}%`);
  lines.push('  (a registrant can hold more than one door, so shares can total over 100%)');
  if (data.topCountries.length > 0) {
    lines.push('', 'WHERE THE ROOM IS JOINING FROM');
    for (const c of data.topCountries) lines.push(`  ${c.country}: ${c.count}`);
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
    doors: AUDIENCE_DOORS.map((d, i) => ({ ...d, count: [13, 8, 5][i] })),
    noDoor: 3,
    practitioners: 5,
    bump: { count: 9, label: 'The Authentic Singing Journey' },
    topCountries: [
      { country: 'BE', count: 7 },
      { country: 'NL', count: 6 },
      { country: 'DE', count: 4 },
      { country: 'FR', count: 3 },
      { country: 'GB', count: 2 },
    ],
  };
}
