// "Share with a friend" referral discount for workshops & masterclasses.
//
// A registrant on the countdown page gets a link they can pass to a friend.
// The friend lands on /w/<slug>?ref=<code> and pays HALF PRICE for the ticket
// — the order bump is never discounted. The code is self-authenticating:
// `<rid>.<sig>` where sig is an HMAC-SHA256 of the referrer's registration id,
// signed with REFERRAL_SECRET (falling back to UNSUBSCRIBE_SECRET /
// ADMIN_SESSION_SECRET, so no new secret is required). No DB lookup is needed
// to validate a link, and the embedded rid lets us record who referred whom.
//
// Marketing mechanics (discounts) are a separate craft from the copy book —
// allowed in moderation. The discount applies to the workshop/masterclass
// ticket only, exactly as the owner asked.

export const SHARE_DISCOUNT_PCT = 50;

export function referralSecret(env: {
  UNSUBSCRIBE_SECRET?: string;
  ADMIN_SESSION_SECRET?: string;
}): string | null {
  return env.UNSUBSCRIBE_SECRET || env.ADMIN_SESSION_SECRET || null;
}

// Half-price the ticket (rounded to the nearest minor unit). Never call this
// on a bump amount — only the ticket line item is discounted.
export function applyShareDiscount(amountMinor: number): number {
  return Math.round((amountMinor * (100 - SHARE_DISCOUNT_PCT)) / 100);
}

export async function referralCode(secret: string, rid: number): Promise<string> {
  const sig = await hmacHex(secret, `referral.${rid}`);
  return `${rid}.${sig.slice(0, 16)}`;
}

// Verify a `<rid>.<sig>` code; returns the referrer's registration id on
// success, or null if the code is malformed or the signature doesn't match.
export async function verifyReferralCode(
  secret: string,
  code: string,
): Promise<number | null> {
  if (!code) return null;
  const dot = code.indexOf('.');
  if (dot <= 0) return null;
  const ridStr = code.slice(0, dot);
  const sig = code.slice(dot + 1);
  const rid = parseInt(ridStr, 10);
  if (!Number.isFinite(rid) || rid <= 0 || !sig) return null;
  const expected = await referralCode(secret, rid);
  return timingSafeEqual(code, expected) ? rid : null;
}

// The shareable link a friend opens to claim the discount.
export async function referralShareUrl(
  base: string,
  secret: string,
  slug: string,
  rid: number,
): Promise<string> {
  const code = await referralCode(secret, rid);
  return `${base.replace(/\/$/, '')}/w/${slug}?ref=${code}`;
}

// ── Crypto helpers (mirrors src/lib/email/unsubscribe.ts) ──────────────────

async function hmacHex(secret: string, msg: string): Promise<string> {
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
