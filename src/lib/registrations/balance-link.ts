// The durable "pay your remaining balance" link.
//
// WHY THIS EXISTS. The balance email used to carry the gateway's own checkout
// URL — a Stripe Checkout Session, minted the moment the email was sent. A
// Stripe session lives at most 24 hours (its `expires_at` cannot be pushed
// further out), and a PayPal order's approve URL goes stale sooner still. So
// the link was dead by the next morning, and every guest who came back to the
// email a day or a week later — which, for a balance due "before 1 September",
// is most of them — landed on Stripe's:
//
//     "You're all done here — You've either completed your payment or this
//      checkout session has timed out."
//
// which reads like the money already left their account. It happened to the
// Dolphin & Sound balance send (September 2026).
//
// The email now carries a link to US instead: /registrations/balance?t=<token>,
// which mints a FRESH gateway session on each click and redirects. It cannot
// expire, it always charges the balance as it stands today, and once the
// balance is settled it says so in plain words rather than in Stripe's.
//
// The token is an HMAC over ADMIN_SESSION_SECRET, domain-separated `sd-balance:`
// so it can never be presented as an admin session, a music listener cookie or
// a share token. It carries no credential of its own: the page it opens shows
// the guest's own booking and charges their own outstanding balance, exactly
// what the emailed checkout link did.

export const BALANCE_PAY_PATH = '/registrations/balance';
export const BALANCE_TOKEN_PARAM = 't';
// The page renders its panel instead of bouncing to the gateway. Used by the
// gateway's cancel_url, so backing out of Stripe lands on our own page (with
// the bank details and a "try again" button) rather than in a redirect loop.
export const BALANCE_STAY_PARAM = 'stay';

// `<registration id>.<sig>`. 24 hex chars (96 bits) of signature — far more
// than "you cannot guess someone else's balance page" needs, and still short
// enough to survive an email client's line wrapping.
const SIG_CHARS = 24;

export async function signBalanceToken(
  secret: string,
  registrationId: number,
): Promise<string> {
  const sig = (await mac(secret, `pay.${registrationId}`)).slice(0, SIG_CHARS);
  return `${registrationId}.${sig}`;
}

// The registration id this token was signed for, or null for anything
// malformed, unsigned or forged. Never throws.
export async function verifyBalanceToken(
  secret: string,
  token: string | null | undefined,
): Promise<number | null> {
  const raw = (token ?? '').trim();
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const id = parseInt(raw.slice(0, dot), 10);
  const sig = raw.slice(dot + 1);
  if (!Number.isFinite(id) || id <= 0 || !sig) return null;
  try {
    const expected = (await mac(secret, `pay.${id}`)).slice(0, SIG_CHARS);
    return timingSafeEqual(sig, expected) ? id : null;
  } catch {
    return null;
  }
}

// The link itself. `stay` builds the panel URL the gateway cancels back to.
export function balancePayUrl(
  base: string,
  token: string,
  opts?: { stay?: boolean },
): string {
  const params = new URLSearchParams({ [BALANCE_TOKEN_PARAM]: token });
  if (opts?.stay) params.set(BALANCE_STAY_PARAM, '1');
  return `${base.replace(/\/+$/, '')}${BALANCE_PAY_PATH}?${params.toString()}`;
}

// Sign + build in one step, for the two callers that hold a secret and an id.
export async function buildBalancePayUrl(
  secret: string,
  base: string,
  registrationId: number,
  opts?: { stay?: boolean },
): Promise<string> {
  return balancePayUrl(base, await signBalanceToken(secret, registrationId), opts);
}

// ── Crypto ────────────────────────────────────────────────────────────────

async function mac(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`sd-balance:${msg}`));
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
