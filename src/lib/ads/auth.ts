// Standalone password gate for the ads-manager dashboard (/ads). Deliberately
// independent of the admin login: a single shared password opens a read-only
// reporting view — the ads manager never touches /admin.
//
//   • Password comes from ADS_DASHBOARD_PASSWORD (env/secret); if unset it
//     falls back to the owner-supplied default below, so the dashboard works
//     out of the box and the password can be rotated by setting the secret.
//   • The session is an HMAC-signed cookie (`sd_ads`, 30 days), signed with a
//     key DERIVED from ADMIN_SESSION_SECRET — so no new secret is required, yet
//     an ads token can never be replayed as an admin session and vice-versa
//     (different derived key → different MAC).
//   • A valid ADMIN session ALSO grants access, so the owner sees the dashboard
//     while already signed into /admin, without entering the ads password.

import {
  readCookie as readAdminCookie,
  verifySession as verifyAdminSession,
} from '../registrations/auth';

const COOKIE_NAME = 'sd_ads';
const SESSION_DAYS = 30;
// Owner-supplied default. Override in production with a secret:
// `wrangler secret put ADS_DASHBOARD_PASSWORD`.
const DEFAULT_PASSWORD = 'umiforthewin';

type AdsEnv = { ADS_DASHBOARD_PASSWORD?: string; ADMIN_SESSION_SECRET: string };

export function adsPassword(env: { ADS_DASHBOARD_PASSWORD?: string }): string {
  const pw = (env.ADS_DASHBOARD_PASSWORD ?? '').trim();
  return pw || DEFAULT_PASSWORD;
}

// Namespace the ads signing key so the sd_ads and sd_admin cookies are never
// interchangeable, even though both derive from ADMIN_SESSION_SECRET.
function adsKey(secret: string): string {
  return `${secret}::ads-dashboard-v1`;
}

// Timing-safe password check.
export function checkPassword(
  env: { ADS_DASHBOARD_PASSWORD?: string },
  password: string,
): boolean {
  return timingSafeEqual((password ?? '').trim(), adsPassword(env));
}

export function sessionExpiry(): number {
  return Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
}

export async function signSession(secret: string, exp: number): Promise<string> {
  const payload = `ads.${exp}`;
  const mac = await hmac(adsKey(secret), payload);
  return `${payload}.${mac}`;
}

export async function verifySession(
  secret: string,
  cookie: string | null,
): Promise<boolean> {
  if (!cookie) return false;
  const parts = cookie.split('.');
  if (parts.length !== 3) return false;
  const [sub, expStr, mac] = parts;
  if (sub !== 'ads') return false;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(adsKey(secret), `${sub}.${expStr}`);
  return timingSafeEqual(mac, expected);
}

export function readCookie(req: Request): string | null {
  const header = req.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

export function sessionCookieHeader(token: string): string {
  const maxAge = SESSION_DAYS * 86400;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// The gate for every /ads page + data endpoint: a valid ads session, OR a valid
// admin session (the signed-in owner shouldn't need a second password).
export async function hasAdsAccess(env: AdsEnv, req: Request): Promise<boolean> {
  if (await verifySession(env.ADMIN_SESSION_SECRET, readCookie(req))) return true;
  return verifyAdminSession(env.ADMIN_SESSION_SECRET, readAdminCookie(req));
}

// ---- crypto helpers (self-contained; mirror registrations/auth.ts) ----

async function hmac(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
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
