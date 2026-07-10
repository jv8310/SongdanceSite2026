// Meta Marketing API — pull daily ad spend straight from the ad account, so the
// /ads dashboard and /admin/workshops/stats ROAS light up without the manual CSV
// export/import round-trip. Sibling to src/lib/workshops/meta.ts (the Conversions
// API *send*): same Graph API host and token plumbing, opposite direction (read).
//
// It writes the same `workshop_ad_spend` table the CSV importer does, through an
// atomic replace over a rolling window (`replaceMetaAdSpend`), so Meta is the
// single source of truth for its channel inside that window and the two paths
// can never double-count. Everything downstream — computeStats, the per-workshop
// performance page, the daily charts, the SD-REPORT digest — already reads that
// table, so a successful sync needs no further wiring.
//
// A rolling window (not just yesterday) is deliberate: Meta revises past-day
// spend for a day or two (final billing, invalid-click credits), and the replace
// overwrites those days with the corrected figure each run.
//
// Setup (Meta side — the code no-ops until both are set, so deploying it changes
// nothing until the owner opts in):
//   • META_AD_ACCOUNT_ID — the ad account: "act_1234567890" or bare "1234567890".
//   • META_ADS_TOKEN — a token with the `ads_read` permission on that account. A
//     non-expiring System User token is ideal for a server cron. Falls back to
//     META_ACCESS_TOKEN, but the Conversions API token usually lacks ads_read,
//     so set this one explicitly.

import { getConfig, setConfig, replaceMetaAdSpend } from '../workshops/db';
import { getFxRatesToEur } from '../admin/fx';

export type MetaInsightsEnv = {
  DB: D1Database;
  META_AD_ACCOUNT_ID?: string;
  META_ADS_TOKEN?: string;
  META_ACCESS_TOKEN?: string;
  META_API_VERSION?: string; // default v21.0 (matches meta.ts)
};

// How many trailing days to re-pull each sync — long enough to absorb Meta's
// retroactive spend revisions, short enough to stay one small API call.
const SYNC_WINDOW_DAYS = 14;
// Once-a-day cadence, mirroring the FX refresh's 20h staleness gate: the hourly
// cron calls this every tick, but it only hits Meta when the last success is
// older than this — and a failed run leaves the marker untouched so the next
// tick retries.
const MIN_SYNC_INTERVAL_MS = 20 * 3_600_000;
const SYNC_MARKER_KEY = 'meta_ad_spend_synced_at';
const MAX_PAGES = 12; // safety cap; a 14-day account-level pull is one page

const DEFAULT_API_VERSION = 'v21.0';

export type MetaSyncResult = {
  skipped: boolean;
  reason?: string; // why skipped, when skipped
  days: number; // day rows written
  from?: string;
  to?: string;
  currency?: string;
  totalSpendMinor?: number; // in the account currency
  fxMissing?: boolean; // account currency had no EUR rate → amount_eur_minor null
};

type InsightsRow = {
  spend?: string;
  account_currency?: string;
  date_start?: string;
  date_stop?: string;
};
type InsightsResponse = {
  data?: InsightsRow[];
  paging?: { next?: string };
  error?: { message?: string; type?: string; code?: number };
};

// "1234567890" or "act_1234567890" (with stray whitespace) → "act_1234567890".
function normaliseAccountId(raw: string): string {
  const s = raw.trim();
  return s.startsWith('act_') ? s : `act_${s}`;
}

function ymdUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDaysUTC(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Fetch every daily insights row for the window, following pagination. Throws on
// a non-2xx or a Graph error body so the caller can log-and-retry WITHOUT having
// touched the stored data (the replace only runs on a clean return).
async function fetchInsights(
  version: string,
  accountId: string,
  token: string,
  from: string,
  to: string,
): Promise<InsightsRow[]> {
  const params = new URLSearchParams({
    level: 'account',
    fields: 'spend,account_currency',
    time_increment: '1',
    time_range: JSON.stringify({ since: from, until: to }),
    limit: '500',
    access_token: token,
  });
  let url = `https://graph.facebook.com/${version}/${accountId}/insights?${params.toString()}`;

  const out: InsightsRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(url);
    const text = await res.text();
    let body: InsightsResponse;
    try {
      body = JSON.parse(text) as InsightsResponse;
    } catch {
      throw new Error(`Meta Insights: ${res.status} non-JSON response`);
    }
    if (!res.ok || body.error) {
      const e = body.error;
      throw new Error(
        `Meta Insights: ${res.status} ${e?.message ?? text}${e?.code ? ` (code ${e.code})` : ''}`,
      );
    }
    for (const row of body.data ?? []) out.push(row);
    const next = body.paging?.next;
    if (!next) break;
    url = next; // absolute, already carries the access token + cursor
  }
  return out;
}

// Core sync. Returns a result describing what it did; never throws for the "not
// configured" / "not due" cases (those are `skipped`), only surfaces a genuine
// Meta/API error to the caller by throwing.
export async function runMetaAdSpendSync(
  env: MetaInsightsEnv,
  opts: { force?: boolean } = {},
): Promise<MetaSyncResult> {
  const db = env.DB;
  const accountRaw = (env.META_AD_ACCOUNT_ID ?? '').trim();
  const token = (env.META_ADS_TOKEN ?? env.META_ACCESS_TOKEN ?? '').trim();
  if (!accountRaw || !token) {
    return { skipped: true, reason: 'not_configured', days: 0 };
  }

  // Daily gate (unless forced by the manual trigger).
  if (!opts.force) {
    const last = await getConfig(db, SYNC_MARKER_KEY);
    if (last) {
      const lastMs = new Date(last.replace(' ', 'T')).getTime();
      if (Number.isFinite(lastMs) && Date.now() - lastMs < MIN_SYNC_INTERVAL_MS) {
        return { skipped: true, reason: 'not_due', days: 0 };
      }
    }
  }

  const version = (env.META_API_VERSION ?? '').trim() || DEFAULT_API_VERSION;
  const accountId = normaliseAccountId(accountRaw);
  const to = ymdUTC(new Date());
  const from = addDaysUTC(to, -(SYNC_WINDOW_DAYS - 1));

  const insightRows = await fetchInsights(version, accountId, token, from, to);

  // Aggregate to one row per day (level=account + time_increment=1 already is,
  // but summing is defensive against any duplicate date_start). Spend is a major-
  // unit string in the account currency.
  let currency = 'EUR';
  const minorByDate = new Map<string, number>();
  let totalSpendMinor = 0;
  for (const r of insightRows) {
    const date = (r.date_start ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const spend = parseFloat(r.spend ?? '');
    if (!Number.isFinite(spend)) continue;
    if (r.account_currency) currency = r.account_currency.toUpperCase();
    const minor = Math.round(spend * 100);
    minorByDate.set(date, (minorByDate.get(date) ?? 0) + minor);
    totalSpendMinor += minor;
  }

  // Convert to EUR with the live fx_rates table (falls back to the seed rates).
  const rates = await getFxRatesToEur(db);
  const rate = rates[currency] ?? null;
  const rows = [...minorByDate.entries()].map(([spend_date, amount_minor]) => ({
    spend_date,
    amount_minor,
    currency,
    amount_eur_minor: rate != null ? Math.round(amount_minor * rate) : null,
  }));

  await replaceMetaAdSpend(db, { from, to }, rows);
  await setConfig(db, SYNC_MARKER_KEY, new Date().toISOString());

  return {
    skipped: false,
    days: rows.length,
    from,
    to,
    currency,
    totalSpendMinor,
    fxMissing: rate == null,
  };
}
