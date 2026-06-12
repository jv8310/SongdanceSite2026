import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { upsertAdSpend } from '../../../../lib/workshops/db';
import { FX_TO_EUR } from '../../../../lib/workshops/currency';

export const prerender = false;

// Tolerant Meta ad-spend CSV import. Column headers vary by export, so we
// match by fuzzy header name. Rows we can't parse are reported, not dropped.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const file = form.get('csv');
  const fallbackCurrency = String(form.get('currency') ?? '').trim().toUpperCase();
  if (!(file instanceof File) || file.size === 0) {
    return new Response('Upload a CSV file.', { status: 400 });
  }

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return new Response('CSV has no data rows.', { status: 400 });

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const findCol = (...names: string[]) =>
    header.findIndex((h) => names.some((n) => h.includes(n)));
  const dateCol = findCol('day', 'date');
  const amountCol = findCol('amount spent', 'spend', 'amount');
  const currencyCol = findCol('currency');
  const campaignCol = findCol('campaign');

  if (dateCol < 0 || amountCol < 0) {
    return jsonResp({ error: 'Could not find a date and an amount column in the CSV header.' }, 400);
  }

  let imported = 0;
  const skipped: Array<{ row: number; reason: string }> = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells.length || cells.every((c) => !c.trim())) continue;
    const spendDate = normaliseDate(cells[dateCol] ?? '');
    const amount = parseAmount(cells[amountCol] ?? '');
    if (!spendDate || amount == null) {
      skipped.push({ row: i + 1, reason: 'unparseable date or amount' });
      continue;
    }
    const currency =
      (currencyCol >= 0 ? (cells[currencyCol] ?? '').trim().toUpperCase() : '') || fallbackCurrency || 'EUR';
    const campaign = campaignCol >= 0 ? (cells[campaignCol] ?? '').trim() : '';
    const amountMinor = Math.round(amount * 100);
    const rate = FX_TO_EUR[currency] ?? null;
    const amountEurMinor = rate != null ? Math.round(amountMinor * rate) : null;

    await upsertAdSpend(env.DB, {
      spend_date: spendDate,
      channel: 'meta',
      campaign,
      amount_minor: amountMinor,
      currency,
      amount_eur_minor: amountEurMinor,
    });
    imported += 1;
  }

  return jsonResp({ imported, skipped });
};

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Minimal CSV parser handling quoted fields + escaped quotes + CRLF.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normaliseDate(raw: string): string | null {
  const s = raw.trim();
  // ISO YYYY-MM-DD (Meta default).
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD/MM/YYYY or MM/DD/YYYY → assume DD/MM/YYYY (EU exports). Ambiguous, but
  // consistent; admins on US format can re-export ISO.
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.,-]/g, '');
  if (!cleaned) return null;
  // If both separators present, the last one is the decimal.
  let normalised = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalised = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    // Lone comma → treat as decimal separator.
    normalised = cleaned.replace(',', '.');
  }
  const n = parseFloat(normalised);
  return Number.isFinite(n) ? n : null;
}
