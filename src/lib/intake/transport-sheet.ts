// Mirror a retreat's travel answers to a Google Sheet.
//
// The bridge is a tiny Apps Script bound to the sheet, deployed as a web app
// (appsScriptSource below — the admin page shows it with the secret filled in).
// That needs nothing on Google Cloud: no project, no service account, no API
// to enable — open the sheet, paste, deploy, copy the /exec URL onto the
// retreat page. The worker POSTs the whole table; the script checks the shared
// secret and rewrites its tab.
//
// Whole-table, every time — never an append. The sheet is a view of
// intake_transport_answers, so it can't drift from it: a person who sends new
// flight details replaces their own row instead of adding a second one, a
// question added to the section becomes a column on the next push, and a
// failed push is repaired by the next one. Rows keep the order people first
// answered in, so a newcomer lands at the bottom and notes typed in columns to
// the RIGHT of the synced block stay beside the right person. Only the synced
// columns are ever cleared.
//
// When it runs: right after each answer comes in (waitUntil, beside the
// submit), on "Sync now" in the admin, and from the hourly cron for any
// retreat whose answers changed after its last successful push — so a push
// lost to a torn-down waitUntil or a Google blip catches up within the hour.

import { getRetreat, type RetreatRow } from './retreats-db';
import {
  columnFor,
  listTransportRows,
  parseTransportAnswers,
  renderTransportAnswer,
  type TransportSection,
} from './transport';
import { transportSectionForIntake } from './send';

export const SHEET_TAB = 'Transport';
const PUSH_TIMEOUT_MS = 20_000;

// An Apps Script web-app URL: …/macros/s/<id>/exec, or the Workspace-domain
// form …/a/macros/<domain>/s/<id>/exec. Anything else is refused on save, so a
// pasted sheet URL (docs.google.com/spreadsheets/…) gets a helpful error
// instead of a silent failure an hour later.
const SCRIPT_URL = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/\s]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/;

export function normaliseScriptUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/[?#].*$/, '');
  return SCRIPT_URL.test(trimmed) ? trimmed : null;
}

export interface SheetTable {
  header: string[];
  rows: string[][];
}

const BRUSSELS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Brussels',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// `YYYY-MM-DD HH:MM:SS` (UTC, as D1 stamps it) → "2026-09-29 14:03" Brussels.
function brusselsStamp(utc: string): string {
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return utc;
  const p = Object.fromEntries(BRUSSELS.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// The table as the sheet shows it: who, how to reach them, one column per
// question (option labels, not codes), and when the answer last changed.
// A phone number the travel-only form didn't ask for is taken from the
// person's intake, then from their booking.
export async function buildTransportTable(
  db: D1Database,
  intake: Pick<RetreatRow, 'slug' | 'product_id'>,
  section: TransportSection,
): Promise<SheetTable> {
  const locale = section.sheetLocale ?? 'en';
  const answerRows = await listTransportRows(db, intake.slug);

  const phones = new Map<string, string>();
  const subs =
    (
      await db
        .prepare(
          `SELECT lower(email) AS email, payload_json FROM intake_submissions
            WHERE event_code = ? ORDER BY created_at DESC`,
        )
        .bind(intake.slug)
        .all<{ email: string; payload_json: string }>()
    ).results ?? [];
  for (const s of subs) {
    if (phones.has(s.email)) continue;
    try {
      const phone = (JSON.parse(s.payload_json) as { phone?: unknown }).phone;
      if (typeof phone === 'string' && phone.trim()) phones.set(s.email, phone.trim());
    } catch {
      /* unreadable payload — no phone from it */
    }
  }
  if (intake.product_id) {
    const regs =
      (
        await db
          .prepare(
            `SELECT lower(email) AS email, phone FROM registrations
              WHERE product_id = ? AND phone IS NOT NULL AND phone != ''
              ORDER BY id DESC`,
          )
          .bind(intake.product_id)
          .all<{ email: string; phone: string }>()
      ).results ?? [];
    for (const r of regs) if (!phones.has(r.email)) phones.set(r.email, r.phone);
  }

  const header = [
    'Name',
    'Email',
    'Phone',
    ...section.questions.map(columnFor),
    'Last updated',
  ];
  const rows = answerRows.map((r) => {
    const answers = parseTransportAnswers(r.answers_json);
    return [
      r.full_name ?? '',
      r.email,
      r.phone || phones.get(r.email) || '',
      ...section.questions.map((q) => renderTransportAnswer(q, answers, locale)),
      brusselsStamp(r.updated_at),
    ];
  });
  return { header, rows };
}

export type SheetSyncResult =
  | { ok: true; rows: number }
  | { ok: false; error: string };

// Push one retreat's table to its sheet and record the outcome on the intake.
export async function syncTransportSheet(
  db: D1Database,
  intakeSlug: string,
): Promise<SheetSyncResult> {
  const intake = await getRetreat(db, intakeSlug);
  if (!intake) return { ok: false, error: 'intake-missing' };
  if (!intake.sheet_url) return { ok: false, error: 'no-sheet' };
  if (!intake.sheet_secret) return { ok: false, error: 'no-secret' };
  const section = await transportSectionForIntake(db, intakeSlug);
  if (!section) return { ok: false, error: 'no-transport-section' };

  let result: SheetSyncResult;
  try {
    const table = await buildTransportTable(db, intake, section);
    result = await pushToScript(intake.sheet_url, {
      secret: intake.sheet_secret,
      tab: SHEET_TAB,
      ...table,
    });
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (result.ok) {
    await db
      .prepare(
        `UPDATE intake_retreats SET sheet_synced_at = datetime('now'), sheet_error = NULL WHERE slug = ?`,
      )
      .bind(intakeSlug)
      .run();
  } else {
    await db
      .prepare(`UPDATE intake_retreats SET sheet_error = ? WHERE slug = ?`)
      .bind(result.error.slice(0, 300), intakeSlug)
      .run();
  }
  return result;
}

async function pushToScript(
  url: string,
  payload: { secret: string; tab: string } & SheetTable,
): Promise<SheetSyncResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    // Apps Script answers a POST with a 302 to script.googleusercontent.com,
    // where the script's output waits; fetch follows it as a GET (the POST
    // itself has already run by then).
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    if (res.status === 404) {
      return {
        ok: false,
        error: 'Google does not know that script URL (404) — copy the Web app URL of the current deployment again.',
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error: `Google refused the push (${res.status}) — redeploy the script with "Who has access: Anyone".`,
      };
    }
    if (!res.ok) return { ok: false, error: `The sheet answered HTTP ${res.status}.` };
    let data: { ok?: boolean; error?: string; rows?: number };
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      // A Google sign-in page, typically: the web app isn't deployed with
      // "Who has access: Anyone".
      return {
        ok: false,
        error: 'The script answered with a web page, not JSON — redeploy it with "Who has access: Anyone".',
      };
    }
    if (!data.ok) {
      return {
        ok: false,
        error:
          data.error === 'bad-secret'
            ? 'The script rejected the secret — paste the script from this page again and redeploy.'
            : `Script error: ${data.error ?? 'unknown'}`,
      };
    }
    return { ok: true, rows: typeof data.rows === 'number' ? data.rows : payload.rows.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.includes('abort') ? 'The sheet did not answer within 20s.' : msg.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

// Hourly catch-up: every retreat with a sheet whose answers changed at or
// after its last successful push. Steady state is one query and no pushes.
export async function syncStaleTransportSheets(
  db: D1Database,
): Promise<{ synced: number; failed: number }> {
  const out = { synced: 0, failed: 0 };
  let slugs: string[] = [];
  try {
    slugs =
      (
        await db
          .prepare(
            `SELECT ir.slug FROM intake_retreats ir
              WHERE ir.sheet_url IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM intake_transport_answers a
                   WHERE a.event_code = ir.slug
                     AND a.updated_at >= COALESCE(ir.sheet_synced_at, ''))`,
          )
          .all<{ slug: string }>()
      ).results?.map((r) => r.slug) ?? [];
  } catch {
    return out; // migration 0085 not applied yet
  }
  for (const slug of slugs) {
    const r = await syncTransportSheet(db, slug);
    if (r.ok) out.synced += 1;
    else out.failed += 1;
  }
  return out;
}

// The script to paste into the sheet (Extensions → Apps Script). It checks the
// secret, then rewrites only the synced columns of its tab — as plain text, so
// a phone number keeps its "+" and leading zero and a date stays as typed.
export function appsScriptSource(secret: string, retreatName: string): string {
  return `// Songdance → Google Sheets: travel answers for ${retreatName.replace(/\n/g, ' ')}.
// Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone.
const SECRET = '${secret}';

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.secret !== SECRET) return reply({ ok: false, error: 'bad-secret' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tab = body.tab || 'Transport';
    const sheet = ss.getSheetByName(tab) || ss.insertSheet(tab);
    const width = body.header.length;
    const props = PropertiesService.getDocumentProperties();
    const prevWidth = Number(props.getProperty('width:' + tab) || 0);
    const clearWidth = Math.max(width, prevWidth);
    const lastRow = sheet.getLastRow();
    if (lastRow > 0 && clearWidth > 0) {
      sheet.getRange(1, 1, lastRow, clearWidth).clearContent();
    }
    const values = [body.header].concat(body.rows).map(function (row) {
      return row.map(function (v) {
        const s = String(v == null ? '' : v);
        return s.charAt(0) === '=' ? "'" + s : s;
      });
    });
    const range = sheet.getRange(1, 1, values.length, width);
    range.setNumberFormat('@');
    range.setValues(values);
    sheet.getRange(1, 1, 1, width).setFontWeight('bold');
    sheet.setFrozenRows(1);
    props.setProperty('width:' + tab, String(width));
    return reply({ ok: true, rows: body.rows.length });
  } finally {
    lock.releaseLock();
  }
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
}
