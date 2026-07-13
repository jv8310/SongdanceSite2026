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
import { isAcquisitionCampaign } from './campaigns';
import { localHour } from '../workshops/time';

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
// Once-a-day cadence, anchored to a fixed local time (mirroring the SD-REPORT
// digest's 08:00 Brussels hold): the hourly cron calls this every tick, but it
// only hits Meta from the first tick at/after 06:00 in SYNC_TZ, and at most
// once per Brussels calendar day — a failed run leaves the marker untouched so
// the next tick retries (same day, so it's caught up later that morning).
const SYNC_LOCAL_HOUR = 6;
const SYNC_TZ = 'Europe/Brussels';
const SYNC_MARKER_KEY = 'meta_ad_spend_synced_at';
// Safety cap. A 14-day per-campaign pull is days × campaigns rows; at 500 rows
// a page that's ~35 campaigns before a second page, so 12 pages covers a very
// large account.
const MAX_PAGES = 12;

const DEFAULT_API_VERSION = 'v21.0';

export type MetaSyncResult = {
  skipped: boolean;
  reason?: string; // why skipped, when skipped
  days: number; // distinct spend days written
  rows?: number; // day × campaign rows written
  campaigns?: number; // distinct campaigns seen
  from?: string;
  to?: string;
  currency?: string;
  totalSpendMinor?: number; // in the account currency
  acquisitionSpendMinor?: number; // TOF/prospecting share (account currency)
  retargetingSpendMinor?: number; // everything else (account currency)
  fxMissing?: boolean; // account currency had no EUR rate → amount_eur_minor null
};

type InsightsRow = {
  spend?: string;
  account_currency?: string;
  campaign_name?: string;
  campaign_id?: string;
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

// The calendar date (YYYY-MM-DD) in `tz` at `now` — used to cap the sync at
// once per local day regardless of how many hourly ticks land after 06:00.
function businessDateIn(tz: string, now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(now));
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
    // Per-campaign, per-day: so spend can be split by funnel intent (the "TOF"
    // prospecting campaign vs retargeting). Summing every campaign for a day
    // still reconciles with the old account-level total.
    level: 'campaign',
    fields: 'spend,account_currency,campaign_name,campaign_id',
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

  // Daily gate (unless forced by the manual trigger): hold until the first
  // tick at/after 06:00 Brussels, then at most once per Brussels calendar day.
  if (!opts.force) {
    const now = Date.now();
    if (localHour(SYNC_TZ, now) < SYNC_LOCAL_HOUR) {
      return { skipped: true, reason: 'not_due', days: 0 };
    }
    const last = await getConfig(db, SYNC_MARKER_KEY);
    if (last) {
      const lastMs = new Date(last.replace(' ', 'T')).getTime();
      if (Number.isFinite(lastMs) && businessDateIn(SYNC_TZ, lastMs) === businessDateIn(SYNC_TZ, now)) {
        return { skipped: true, reason: 'not_due', days: 0 };
      }
    }
  }

  const version = (env.META_API_VERSION ?? '').trim() || DEFAULT_API_VERSION;
  const accountId = normaliseAccountId(accountRaw);
  const to = ymdUTC(new Date());
  const from = addDaysUTC(to, -(SYNC_WINDOW_DAYS - 1));

  const insightRows = await fetchInsights(version, accountId, token, from, to);

  // Aggregate to one row per (day, campaign). time_increment=1 + level=campaign
  // already is one row each, but summing is defensive against duplicates. Spend
  // is a major-unit string in the account currency.
  let currency = 'EUR';
  const minorByKey = new Map<string, { spend_date: string; campaign: string; amount_minor: number }>();
  const campaigns = new Set<string>();
  let totalSpendMinor = 0;
  let acquisitionSpendMinor = 0;
  for (const r of insightRows) {
    const date = (r.date_start ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const spend = parseFloat(r.spend ?? '');
    if (!Number.isFinite(spend)) continue;
    if (r.account_currency) currency = r.account_currency.toUpperCase();
    const campaign = (r.campaign_name ?? '').trim();
    const minor = Math.round(spend * 100);
    const key = `${date} ${campaign}`;
    const existing = minorByKey.get(key);
    if (existing) existing.amount_minor += minor;
    else minorByKey.set(key, { spend_date: date, campaign, amount_minor: minor });
    campaigns.add(campaign);
    totalSpendMinor += minor;
    if (isAcquisitionCampaign(campaign)) acquisitionSpendMinor += minor;
  }

  // Convert to EUR with the live fx_rates table (falls back to the seed rates).
  const rates = await getFxRatesToEur(db);
  const rate = rates[currency] ?? null;
  const rows = [...minorByKey.values()].map((r) => ({
    spend_date: r.spend_date,
    campaign: r.campaign,
    amount_minor: r.amount_minor,
    currency,
    amount_eur_minor: rate != null ? Math.round(r.amount_minor * rate) : null,
  }));

  await replaceMetaAdSpend(db, { from, to }, rows);
  await setConfig(db, SYNC_MARKER_KEY, new Date().toISOString());

  const days = new Set(rows.map((r) => r.spend_date)).size;
  return {
    skipped: false,
    days,
    rows: rows.length,
    campaigns: campaigns.size,
    from,
    to,
    currency,
    totalSpendMinor,
    acquisitionSpendMinor,
    retargetingSpendMinor: totalSpendMinor - acquisitionSpendMinor,
    fxMissing: rate == null,
  };
}
