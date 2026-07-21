// Access control for the gated music players (/music/<album>).
//
// The "login" is an email address, same trust model as /access: an album's
// buyers carry its Drip tag (applied by the product/bump automation on
// payment), so knowing the purchase email is what opens the player. Two
// pieces make that work:
//
//   • Listener cookie (`sd_music`, 30 days) — an HMAC-signed email, set after
//     a successful email check on the player page (or by the /access lookup
//     when it finds owned albums), so the buyer isn't re-asked on every visit.
//     The MAC is domain-separated from the admin session (different message
//     prefix), so an sd_music token can never pass as an sd_admin cookie even
//     though both sign with ADMIN_SESSION_SECRET.
//
//   • Signed stream URLs — the audio bytes live under the gated
//     `music-audio/` R2 prefix that /media refuses to serve. When the player
//     page renders for an entitled listener it embeds short-lived signed URLs
//     (/api/music/stream/<track>?e=…&s=…); the stream route only checks the
//     signature, so seeking (many Range requests) never hammers Drip.

import { getSubscriber } from '../registrations/drip';
import type { MusicAlbumRow } from './db';
import { hasPaidAlbumRegistration } from './product';

const COOKIE_NAME = 'sd_music';
const LISTENER_DAYS = 30;
const STREAM_TTL_SECONDS = 12 * 3600;

// ---- Listener cookie (signed email) ----

export async function signListener(secret: string, email: string, exp?: number): Promise<string> {
  const e = exp ?? Math.floor(Date.now() / 1000) + LISTENER_DAYS * 86400;
  const payload = `${b64urlEncode(email.trim().toLowerCase())}.${e}`;
  return `${payload}.${await mac(secret, `listener.${payload}`)}`;
}

// Returns the verified email, or null for a missing/invalid/expired cookie.
export async function verifyListener(secret: string, cookie: string | null): Promise<string | null> {
  if (!cookie) return null;
  const parts = cookie.split('.');
  if (parts.length !== 3) return null;
  const [sub, expStr, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!sub || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const expected = await mac(secret, `listener.${sub}.${expStr}`);
  if (!timingSafeEqual(sig, expected)) return null;
  const email = b64urlDecode(sub);
  return email && email.includes('@') ? email : null;
}

export function readListenerCookie(req: Request): string | null {
  const header = req.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

export function listenerCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${LISTENER_DAYS * 86400}`;
}

// ---- Entitlement (Drip tag) ----

// Does this email hold the album? Two independent paths grant:
//   1. The album's Drip tag on the subscriber (case-insensitive) — how bump /
//      course-bonus buyers get in.
//   2. A *paid* direct purchase of the album in course_registrations — so a
//      fresh buyer plays immediately (before Drip has processed the order),
//      and a Drip outage never locks paying customers out.
// Everything else fails closed: no tag configured + no purchase, unknown
// email, or a Drip error all deny — the player page offers support@ as the
// human fallback, and admins always pass upstream of this.
export async function hasAlbumAccess(
  env: { DRIP_API_TOKEN?: string; DRIP_ACCOUNT_ID?: string },
  db: D1Database,
  email: string,
  album: Pick<MusicAlbumRow, 'id' | 'drip_tag'>,
): Promise<boolean> {
  const tag = (album.drip_tag ?? '').trim().toLowerCase();
  if (tag && env.DRIP_API_TOKEN && env.DRIP_ACCOUNT_ID) {
    try {
      const sub = await getSubscriber(
        { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID },
        email,
      );
      if ((sub?.tags ?? []).some((t) => (t ?? '').trim().toLowerCase() === tag)) return true;
    } catch (err) {
      console.warn(`[music-access] drip lookup failed: ${String(err)}`);
    }
  }
  return hasPaidAlbumRegistration(db, email, album.id);
}

// ---- Signed stream URLs ----

export async function signedStreamUrl(
  secret: string,
  trackId: string,
  ttlSeconds = STREAM_TTL_SECONDS,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await mac(secret, `stream.${trackId}.${exp}`);
  return `/api/music/stream/${encodeURIComponent(trackId)}?e=${exp}&s=${sig}`;
}

export async function verifyStreamToken(
  secret: string,
  trackId: string,
  expStr: string | null,
  sig: string | null,
): Promise<boolean> {
  const exp = parseInt(expStr ?? '', 10);
  if (!sig || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await mac(secret, `stream.${trackId}.${exp}`);
  return timingSafeEqual(sig, expected);
}

// ---- Crypto helpers (mirrors registrations/auth.ts, with a domain prefix) ----

async function mac(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  // The `sd-music:` prefix domain-separates these MACs from the admin
  // session's (same secret, different message space).
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`sd-music:${msg}`));
  const bytes = new Uint8Array(sig);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string | null {
  try {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
