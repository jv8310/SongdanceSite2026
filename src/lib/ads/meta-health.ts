// Meta ad-spend health — the record of whether the pull is actually working.
//
// On 2026-09-07 the Meta token expired (a 60-day user token; Graph error code
// 190) and the ad-spend sync failed on every run for two days without anyone
// being told. Nothing was broken enough to notice: the hourly cron logged to
// the console, the per-page live pull swallowed the error into a one-line
// "⚠ live Meta sync failed", and every figure on /admin/stats and /ads went on
// reporting the last spend it had. Stale spend is the dangerous kind of wrong —
// the numbers stay plausible and every ROAS reads *better* than it is, because
// the return is being divided by a cost that stopped growing.
//
// The permanent fix is on Meta's side — a System User token, which does not
// expire (see the setup notes in CLAUDE.md / env.d.ts). This module is the
// belt-and-braces half: whatever kills the pull next (a revoked token, a lost
// ads_read permission, a rate limit, an outage), it must be loud.
//
//   • every sync records its outcome here, so a failure outlives the request
//     that hit it — the hourly cron's failure is visible on a page hours later
//   • the token's own expiry is read from Meta and shown *before* it bites
//   • both dashboards carry a banner while spend is stale (meta-health is
//     therefore import-light: no email/report machinery — that lives in
//     meta-alert.ts, which the cron uses)
//   • one alert email a day goes to the report recipients (meta-alert.ts)
//
// Everything here is best-effort: a health write must never fail a sync, and a
// health read must never fail a page.

import { setConfig } from '../workshops/db';

// Where the record lives (workshop_config, like the sync markers themselves).
const KEY_LAST_OK = 'meta_ads_last_ok_at'; // ISO — last pull that actually wrote spend
const KEY_LAST_ERROR = 'meta_ads_last_error'; // JSON MetaSyncError
const KEY_TOKEN_EXPIRES = 'meta_ads_token_expires_at'; // ISO, or 'never'
const KEY_TOKEN_CHECKED = 'meta_ads_token_checked_at'; // ISO — when we last asked Meta
// The daily sync's own success marker, which predates this module — read as a
// fallback so health is true on the day this deploys instead of claiming the
// pull has never worked.
const KEY_LEGACY_SYNCED = 'meta_ad_spend_synced_at';

// The cron pulls once a morning (06:00 Brussels). A gap longer than this means
// a whole daily window was missed, so the euros on screen are a day behind.
const STALE_HOURS = 30;
// Rotate a token before it dies, not after.
export const EXPIRY_WARN_DAYS = 14;

// What broke. The kind drives the wording — "your token expired" and "Meta is
// rate-limiting us" need different answers from the reader.
export type MetaErrorKind = 'token' | 'permission' | 'rate_limit' | 'other';
export type MetaSyncError = { at: string; message: string; kind: MetaErrorKind };

export type MetaHealthLevel = 'off' | 'ok' | 'warn' | 'down';

export type MetaAdsHealth = {
  level: MetaHealthLevel;
  configured: boolean;
  lastOkAt: string | null; // ISO of the last successful pull
  staleHours: number | null; // hours since that pull
  error: MetaSyncError | null;
  tokenExpiresAt: string | null; // ISO; null = unknown
  tokenNeverExpires: boolean;
  daysToExpiry: number | null; // negative once it has expired
  /** One line, safe to put in a banner. Null when there is nothing to say. */
  headline: string | null;
  /** What to do about it — the fix, in a sentence. */
  action: string | null;
};

// ── Classifying a Graph error ───────────────────────────────────────────────
// fetchInsights throws `Meta Insights: <status> <message> (code <n>)`, so both
// the code and Meta's own words are in the string.

function errorCode(message: string): number | null {
  const m = /\(code (\d+)\)/.exec(message);
  return m ? parseInt(m[1], 10) : null;
}

export function classifyMetaError(message: string): MetaErrorKind {
  const code = errorCode(message);
  // 190 = expired/invalid/revoked access token. The one that bit us.
  if (code === 190) return 'token';
  // 4/17/32/613/80000-series = the various "you are asking too often" limits.
  if (code === 4 || code === 17 || code === 32 || code === 613 || (code != null && code >= 80000 && code < 81000)) {
    return 'rate_limit';
  }
  // 10 / 200 = the token is fine but lacks the permission (ads_read) or the
  // account isn't one it can see.
  if (code === 10 || code === 200 || code === 3) return 'permission';
  if (/OAuthException|access token|session has expired|token has expired/i.test(message)) return 'token';
  if (/request limit|rate limit|throttl/i.test(message)) return 'rate_limit';
  if (/permission|ads_read|not authorized/i.test(message)) return 'permission';
  return 'other';
}

// Meta names the expiry in the error itself:
//   "The token has expired on Monday, 07-Sep-26 23:54:40 PDT."
// Recovering it means the panel can say *when* even if we never got a clean
// debug_token read. Returns an ISO date (date-only precision is plenty here).
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
export function parseExpiryFromMessage(message: string): string | null {
  const m = /expired on [^,]*,\s*(\d{1,2})-([A-Za-z]{3})-(\d{2})/.exec(message);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = MONTHS[m[2].toLowerCase()];
  const year = 2000 + parseInt(m[3], 10);
  if (month == null || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  return new Date(Date.UTC(year, month, day)).toISOString();
}

// ── Recording ───────────────────────────────────────────────────────────────

/** A pull that wrote spend. Clears any standing error. */
export async function recordMetaSyncOk(db: D1Database): Promise<void> {
  try {
    await setConfig(db, KEY_LAST_OK, new Date().toISOString());
    await setConfig(db, KEY_LAST_ERROR, '');
  } catch {
    // Health is bookkeeping; never let it fail the sync that succeeded.
  }
}

/** A pull that threw. Keeps Meta's own words — they name the expiry date. */
export async function recordMetaSyncError(db: D1Database, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const kind = classifyMetaError(message);
  try {
    const payload: MetaSyncError = { at: new Date().toISOString(), message, kind };
    await setConfig(db, KEY_LAST_ERROR, JSON.stringify(payload));
    // An expired-token error carries the expiry; record it so the panel can
    // show a date even when debug_token itself is unreachable.
    if (kind === 'token') {
      const expiry = parseExpiryFromMessage(message);
      if (expiry) await setConfig(db, KEY_TOKEN_EXPIRES, expiry);
    }
  } catch {
    // As above — best-effort.
  }
}

// ── Asking Meta when the token dies ─────────────────────────────────────────

export type MetaTokenEnv = {
  META_ADS_TOKEN?: string;
  META_ACCESS_TOKEN?: string;
  META_API_VERSION?: string;
};

export function metaToken(env: MetaTokenEnv): string {
  return (env.META_ADS_TOKEN ?? env.META_ACCESS_TOKEN ?? '').trim();
}

/**
 * Read the token's expiry from Meta and store it, so the dashboards can warn
 * ahead of time instead of reporting the failure afterwards.
 *
 * `debug_token` is inspected with the token itself as the caller. That works
 * for a System User / app-admin token and may not for others — so this is
 * strictly best-effort: a failure leaves whatever we knew before untouched and
 * the panel just says the expiry is unknown. It never throws.
 *
 * `expires_at: 0` means the token does not expire — which is exactly what a
 * correctly-made System User token reports, and what we want to see.
 */
export async function checkMetaTokenExpiry(
  env: MetaTokenEnv,
  db: D1Database,
  timeoutMs = 6_000,
): Promise<{ checked: boolean; expiresAt: string | null; neverExpires: boolean }> {
  const token = metaToken(env);
  if (!token) return { checked: false, expiresAt: null, neverExpires: false };
  const version = (env.META_API_VERSION ?? '').trim() || 'v21.0';
  try {
    const url =
      `https://graph.facebook.com/${version}/debug_token` +
      `?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.json()) as {
      data?: { expires_at?: number; data_access_expires_at?: number; is_valid?: boolean };
      error?: { message?: string };
    };
    if (!res.ok || body.error || !body.data) {
      return { checked: false, expiresAt: null, neverExpires: false };
    }
    // Two clocks can end a token: the token's own expiry, and the 90-day data
    // access window. Whichever comes first is the one that stops the pull.
    const stamps = [body.data.expires_at, body.data.data_access_expires_at]
      .filter((n): n is number => typeof n === 'number' && n > 0);
    const neverExpires = stamps.length === 0;
    const expiresAt = neverExpires ? null : new Date(Math.min(...stamps) * 1000).toISOString();
    await setConfig(db, KEY_TOKEN_EXPIRES, neverExpires ? 'never' : (expiresAt as string));
    await setConfig(db, KEY_TOKEN_CHECKED, new Date().toISOString());
    return { checked: true, expiresAt, neverExpires };
  } catch {
    return { checked: false, expiresAt: null, neverExpires: false };
  }
}

// ── Reading it back ─────────────────────────────────────────────────────────

function parseIso(v: string | null): number | null {
  if (!v) return null;
  const ms = new Date(v.replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Brussels',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

const ROTATE_ACTION =
  'Create a System User token in Meta Business Settings (System users → your user → ' +
  'Generate new token → the ad account’s app → permission ads_read → Token expiration: Never), ' +
  'then set it: wrangler secret put META_ADS_TOKEN — and press “Pull from Meta now” to confirm.';

/**
 * The current state of the Meta pull. Never throws: a page that can't read the
 * health table still renders, it just says nothing about it.
 */
export async function readMetaAdsHealth(
  db: D1Database,
  opts: { configured: boolean; now?: number },
): Promise<MetaAdsHealth> {
  const now = opts.now ?? Date.now();
  const base: MetaAdsHealth = {
    level: opts.configured ? 'ok' : 'off',
    configured: opts.configured,
    lastOkAt: null,
    staleHours: null,
    error: null,
    tokenExpiresAt: null,
    tokenNeverExpires: false,
    daysToExpiry: null,
    headline: null,
    action: null,
  };
  if (!opts.configured) return base;

  // One statement, not four: this runs on every render of /admin/stats and /ads.
  const cfg: Record<string, string> = {};
  try {
    const rows = await db
      .prepare(
        `SELECT key, value FROM workshop_config WHERE key IN (?, ?, ?, ?)`,
      )
      .bind(KEY_LAST_OK, KEY_LEGACY_SYNCED, KEY_LAST_ERROR, KEY_TOKEN_EXPIRES)
      .all<{ key: string; value: string }>();
    for (const r of rows.results ?? []) cfg[r.key] = r.value;
  } catch {
    return base;
  }
  const lastOkRaw = cfg[KEY_LAST_OK] ?? null;
  const legacyOk = cfg[KEY_LEGACY_SYNCED] ?? null;
  const errorRaw = cfg[KEY_LAST_ERROR] ?? null;
  const expiryRaw = cfg[KEY_TOKEN_EXPIRES] ?? null;

  // The newest success we know of, from either marker.
  const okMs = Math.max(parseIso(lastOkRaw) ?? 0, parseIso(legacyOk) ?? 0) || null;
  base.lastOkAt = okMs ? new Date(okMs).toISOString() : null;
  base.staleHours = okMs ? Math.max(0, (now - okMs) / 3_600_000) : null;

  if (errorRaw) {
    try {
      const parsed = JSON.parse(errorRaw) as MetaSyncError;
      if (parsed && parsed.message) base.error = parsed;
    } catch {
      // A malformed record is not worth a broken page.
    }
  }

  if (expiryRaw === 'never') {
    base.tokenNeverExpires = true;
  } else if (expiryRaw) {
    const ms = parseIso(expiryRaw);
    if (ms) {
      base.tokenExpiresAt = new Date(ms).toISOString();
      base.daysToExpiry = Math.floor((ms - now) / 86_400_000);
    }
  }

  // An error newer than the last success is the live state of the pull. An
  // error *older* than it has already been recovered from.
  const errMs = base.error ? parseIso(base.error.at) : null;
  const liveError = base.error && (!okMs || (errMs ?? 0) > okMs) ? base.error : null;
  const stale = base.staleHours == null || base.staleHours > STALE_HOURS;
  const expired = base.daysToExpiry != null && base.daysToExpiry < 0;

  if (liveError?.kind === 'token' || expired) {
    base.level = 'down';
    base.headline = base.tokenExpiresAt
      ? `Meta ad spend has stopped updating — the access token expired on ${fmtDate(base.tokenExpiresAt)}.`
      : 'Meta ad spend has stopped updating — the access token is expired or invalid.';
    base.action = ROTATE_ACTION;
  } else if (liveError?.kind === 'permission') {
    base.level = 'down';
    base.headline = 'Meta ad spend has stopped updating — the token can’t read this ad account.';
    base.action =
      'The token needs the ads_read permission on this ad account, and the System User needs to be ' +
      'assigned to it in Business Settings. ' + ROTATE_ACTION;
  } else if (liveError && stale) {
    base.level = 'down';
    base.headline =
      liveError.kind === 'rate_limit'
        ? 'Meta ad spend has stopped updating — Meta is rate-limiting the pull.'
        : 'Meta ad spend has stopped updating.';
    base.action = `Last error: ${liveError.message}`;
  } else if (stale) {
    base.level = 'down';
    base.headline = base.lastOkAt
      ? `Meta ad spend hasn’t updated since ${fmtDate(base.lastOkAt)}.`
      : 'Meta ad spend has never been pulled successfully.';
    base.action = 'Press “Pull from Meta now” on /admin/stats to see what Meta says.';
  } else if (liveError) {
    // Failing now, but a good pull inside the daily window — worth flagging,
    // not worth calling the dashboard wrong.
    base.level = 'warn';
    base.headline = 'The last Meta pull failed — spend may lag.';
    base.action = liveError.message;
  } else if (base.daysToExpiry != null && base.daysToExpiry <= EXPIRY_WARN_DAYS) {
    base.level = 'warn';
    base.headline = `The Meta ads token expires in ${base.daysToExpiry} day${base.daysToExpiry === 1 ? '' : 's'} (${fmtDate(base.tokenExpiresAt as string)}) — ad spend stops updating that day.`;
    base.action = ROTATE_ACTION;
  }

  return base;
}

/** One short line for the "Pull from Meta" panel: what we know about the token. */
export function tokenStatusLabel(h: MetaAdsHealth): string {
  if (!h.configured) return 'Not configured.';
  if (h.tokenNeverExpires) return 'Token: never expires ✓';
  if (h.daysToExpiry == null) return 'Token expiry: unknown.';
  if (h.daysToExpiry < 0) return `Token: EXPIRED ${fmtDate(h.tokenExpiresAt as string)}`;
  return `Token: expires ${fmtDate(h.tokenExpiresAt as string)} (${h.daysToExpiry} day${h.daysToExpiry === 1 ? '' : 's'})`;
}
