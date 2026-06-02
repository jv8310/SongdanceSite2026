// Resolves Google Calendar credentials for the workshop import, merging the
// admin-managed values stored in workshop_config over the env fallbacks.
//
// Split of responsibilities:
//   - OAuth *app* (client id/secret): one-time setup, from env or admin form.
//   - Refresh token + calendar id: obtained interactively via the in-admin
//     "Connect Google Calendar" flow and stored in workshop_config.
//
// Storing the refresh token (and optionally the client secret) in D1 is the
// same trust level as the other integration credentials the worker holds; D1
// is not publicly readable and admin pages are gated by the session cookie.

import { deleteConfig, getConfig, setConfig } from './db';
import {
  getAccessToken,
  listCalendars,
  type GCalListEntry,
  type GoogleCalConfig,
} from './google-calendar';

export const GCFG = {
  clientId: 'google_oauth_client_id',
  clientSecret: 'google_oauth_client_secret',
  refreshToken: 'google_oauth_refresh_token',
  calendarId: 'google_calendar_id',
} as const;

type GEnv = {
  PUBLIC_BASE_URL: string;
  GOOGLE_SA_JSON?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REFRESH_TOKEN?: string;
  GOOGLE_CALENDAR_ID?: string;
};

export function googleRedirectUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api/admin/workshops/google-callback`;
}

// The OAuth app credentials (needed to start the consent flow), config first.
export async function resolveOAuthApp(
  db: D1Database,
  env: GEnv,
): Promise<{ clientId: string; clientSecret: string } | null> {
  const clientId = (await getConfig(db, GCFG.clientId)) || env.GOOGLE_OAUTH_CLIENT_ID || '';
  const clientSecret = (await getConfig(db, GCFG.clientSecret)) || env.GOOGLE_OAUTH_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// The full config the import needs (service-account OR oauth refresh token,
// plus a calendar id). Returns null when not fully configured.
export async function resolveGoogleConfig(db: D1Database, env: GEnv): Promise<GoogleCalConfig | null> {
  const calendarId = (await getConfig(db, GCFG.calendarId)) || env.GOOGLE_CALENDAR_ID || '';
  if (!calendarId) return null;

  if (env.GOOGLE_SA_JSON) {
    return { calendarId, saJson: env.GOOGLE_SA_JSON };
  }
  const app = await resolveOAuthApp(db, env);
  const refreshToken = (await getConfig(db, GCFG.refreshToken)) || env.GOOGLE_OAUTH_REFRESH_TOKEN || '';
  if (!app || !refreshToken) return null;
  return {
    calendarId,
    oauthClientId: app.clientId,
    oauthClientSecret: app.clientSecret,
    oauthRefreshToken: refreshToken,
  };
}

export type GoogleConnectionState = {
  redirectUri: string;
  hasApp: boolean; // client id + secret available
  appFromEnv: boolean; // app creds came from env (not editable in admin)
  saMode: boolean; // a service account is configured (no interactive connect needed)
  connected: boolean; // refresh token present (or SA)
  calendarId: string | null;
  ready: boolean; // import is fully usable
  calendars: GCalListEntry[]; // populated when connected
  listError: string | null;
};

export async function getConnectionState(db: D1Database, env: GEnv): Promise<GoogleConnectionState> {
  const redirectUri = googleRedirectUri(env.PUBLIC_BASE_URL);
  const saMode = !!env.GOOGLE_SA_JSON;
  const appFromEnv = !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET) &&
    !(await getConfig(db, GCFG.clientId));
  const app = await resolveOAuthApp(db, env);
  const refreshToken = (await getConfig(db, GCFG.refreshToken)) || env.GOOGLE_OAUTH_REFRESH_TOKEN || '';
  const calendarId = (await getConfig(db, GCFG.calendarId)) || env.GOOGLE_CALENDAR_ID || null;
  const connected = saMode || !!refreshToken;

  let calendars: GCalListEntry[] = [];
  let listError: string | null = null;
  if (connected) {
    const cfg = await resolveGoogleConfigForListing(db, env, app, refreshToken);
    if (cfg) {
      try {
        calendars = await listCalendars(await getAccessToken(cfg));
      } catch (err) {
        listError = String(err);
      }
    }
  }

  const ready = !!(await resolveGoogleConfig(db, env));
  return {
    redirectUri,
    hasApp: !!app,
    appFromEnv,
    saMode,
    connected,
    calendarId,
    ready,
    calendars,
    listError,
  };
}

// Build a config usable just for listing calendars (calendar id not required).
async function resolveGoogleConfigForListing(
  db: D1Database,
  env: GEnv,
  app: { clientId: string; clientSecret: string } | null,
  refreshToken: string,
): Promise<GoogleCalConfig | null> {
  if (env.GOOGLE_SA_JSON) return { calendarId: 'primary', saJson: env.GOOGLE_SA_JSON };
  if (app && refreshToken) {
    return {
      calendarId: 'primary',
      oauthClientId: app.clientId,
      oauthClientSecret: app.clientSecret,
      oauthRefreshToken: refreshToken,
    };
  }
  return null;
}

// ── Persistence helpers ─────────────────────────────────────────────────
export async function saveOAuthApp(db: D1Database, clientId: string, clientSecret: string) {
  await setConfig(db, GCFG.clientId, clientId);
  await setConfig(db, GCFG.clientSecret, clientSecret);
}
export async function saveRefreshToken(db: D1Database, token: string) {
  await setConfig(db, GCFG.refreshToken, token);
}
export async function saveCalendarId(db: D1Database, calendarId: string) {
  await setConfig(db, GCFG.calendarId, calendarId);
}
export async function disconnectGoogle(db: D1Database) {
  await deleteConfig(db, GCFG.refreshToken);
}

// ── CSRF state (signed with the admin session secret) ────────────────────
export async function signState(secret: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const payload = `${ts}.${nonce}`;
  return `${payload}.${await hmacHex(secret, payload)}`;
}

export async function verifyState(secret: string, state: string | null): Promise<boolean> {
  if (!state) return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [ts, nonce, mac] = parts;
  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 600) return false;
  const expected = await hmacHex(secret, `${ts}.${nonce}`);
  return timingSafeEqual(mac, expected);
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  const bytes = new Uint8Array(sig);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
