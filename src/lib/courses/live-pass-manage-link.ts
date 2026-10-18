// The durable "manage my monthly" link for the monthly live pass
// (src/lib/courses/live-pass.ts): /courses/live-pass/manage?t=<token>.
//
// It is how a buyer cancels — or takes a cancellation back — with no account
// and no password: it rides in the monthly's confirmation email, and the pass
// page sends it again to the address on the order for anyone who has lost that
// email (never shown on screen: email is the credential for *reading* on this
// site, but stopping someone's subscription needs the inbox). Same shape as the
// card-update link (card-update-link.ts): an HMAC over ADMIN_SESSION_SECRET,
// domain-separated `sd-lpm:` so it can never stand in for any other token, and
// it opens one thing — this order's monthly. Kept free of heavy imports.

import { LIVE_PASS_MANAGE_PATH } from './live-pass';

export const LIVE_PASS_MANAGE_TOKEN_PARAM = 't';

const SIG_CHARS = 24;

export async function signLivePassManageToken(secret: string, courseRegistrationId: number): Promise<string> {
  const sig = (await mac(secret, `manage.${courseRegistrationId}`)).slice(0, SIG_CHARS);
  return `${courseRegistrationId}.${sig}`;
}

// The course registration id this token was signed for, or null for anything
// malformed, unsigned or forged. Never throws.
export async function verifyLivePassManageToken(secret: string, token: string | null | undefined): Promise<number | null> {
  const raw = (token ?? '').trim();
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const id = parseInt(raw.slice(0, dot), 10);
  const sig = raw.slice(dot + 1);
  if (!Number.isFinite(id) || id <= 0 || !sig) return null;
  try {
    const expected = (await mac(secret, `manage.${id}`)).slice(0, SIG_CHARS);
    return timingSafeEqual(sig, expected) ? id : null;
  } catch {
    return null;
  }
}

export async function buildLivePassManageUrl(secret: string, base: string, courseRegistrationId: number): Promise<string> {
  const token = await signLivePassManageToken(secret, courseRegistrationId);
  const params = new URLSearchParams({ [LIVE_PASS_MANAGE_TOKEN_PARAM]: token });
  return `${base.replace(/\/+$/, '')}${LIVE_PASS_MANAGE_PATH}?${params.toString()}`;
}

async function mac(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`sd-lpm:${msg}`));
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
