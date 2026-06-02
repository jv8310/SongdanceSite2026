// Google Calendar event import (read-only).
//
// Auth supports either a service account (GOOGLE_SA_JSON — share the calendar
// with the service-account email) or OAuth2 refresh-token flow
// (GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN). The admin enters an event
// title; we query the calendar, exact-match on summary, and map each hit into
// a `workshops` row keyed on google_event_id.

export type GoogleCalConfig = {
  calendarId: string;
  // Service-account path
  saJson?: string;
  // OAuth refresh-token path
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthRefreshToken?: string;
};

export type GCalEvent = {
  id: string;
  summary: string;
  startUtc: string | null; // null for all-day events (we flag/skip those)
  endUtc: string | null;
  timeZone: string | null;
  isAllDay: boolean;
};

// ── Access token minting ────────────────────────────────────────────────

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function serviceAccountToken(saJson: string): Promise<string> {
  const sa = JSON.parse(saJson) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const signingInput = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64url(new Uint8Array(sig))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Google SA token: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function oauthRefreshToken(cfg: GoogleCalConfig): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.oauthClientId!,
      client_secret: cfg.oauthClientSecret!,
      refresh_token: cfg.oauthRefreshToken!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google OAuth refresh: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function getAccessToken(cfg: GoogleCalConfig): Promise<string> {
  if (cfg.saJson) return serviceAccountToken(cfg.saJson);
  if (cfg.oauthClientId && cfg.oauthClientSecret && cfg.oauthRefreshToken) {
    return oauthRefreshToken(cfg);
  }
  throw new Error('Google Calendar: no credentials configured');
}

// ── Interactive OAuth (admin "Connect" flow) ──────────────────────────────

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

// Build the consent URL. access_type=offline + prompt=consent guarantees a
// refresh_token is returned even on a repeat authorisation.
export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', GOOGLE_SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', state);
  return u.toString();
}

// Exchange the authorization code for tokens. Returns the refresh token (the
// durable credential we persist) plus the short-lived access token.
export async function exchangeCodeForTokens(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string | null; accessToken: string }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { refresh_token?: string; access_token: string };
  return { refreshToken: body.refresh_token ?? null, accessToken: body.access_token };
}

export type GCalListEntry = { id: string; summary: string; primary: boolean };

// List the calendars the connected account can read, for the admin picker.
export async function listCalendars(accessToken: string): Promise<GCalListEntry[]> {
  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Google calendarList: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    items?: Array<{ id: string; summary?: string; primary?: boolean }>;
  };
  return (data.items ?? []).map((c) => ({
    id: c.id,
    summary: c.summary ?? c.id,
    primary: !!c.primary,
  }));
}

// ── Event search ──────────────────────────────────────────────────────────

type RawGEvent = {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
};

// Find upcoming events whose summary exactly (case-insensitively) matches the
// title. Handles pagination + expands recurring events into instances.
export async function findEventsByTitle(
  cfg: GoogleCalConfig,
  title: string,
): Promise<GCalEvent[]> {
  const token = await getAccessToken(cfg);
  const wanted = title.trim().toLowerCase();
  const out: GCalEvent[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events`,
    );
    url.searchParams.set('q', title);
    url.searchParams.set('timeMin', new Date().toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '50');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Google events.list: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { items?: RawGEvent[]; nextPageToken?: string };

    for (const e of data.items ?? []) {
      if ((e.summary ?? '').trim().toLowerCase() !== wanted) continue;
      const isAllDay = !!e.start?.date && !e.start?.dateTime;
      out.push({
        id: e.id,
        summary: e.summary ?? '',
        startUtc: e.start?.dateTime ? new Date(e.start.dateTime).toISOString() : null,
        endUtc: e.end?.dateTime ? new Date(e.end.dateTime).toISOString() : null,
        timeZone: e.start?.timeZone ?? null,
        isAllDay,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return out;
}
