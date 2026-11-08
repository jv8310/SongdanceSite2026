// The durable "pay what's left" link for a course installment plan.
//
// A buyer on a payment plan sometimes wants to settle the rest in one go
// (Kassandra, November 2026: three of six paid, "can I pay the rest at once?"),
// and a plan whose monthly charge failed until Stripe gave up is closed, so
// its card link (./card-update-link.ts) answers "this plan is closed" and
// there is no way left to pay the last installment (Rania, same week). This
// link covers both: /courses/pay-remaining?t=<token> opens a fresh Stripe page
// for exactly what the plan still owes, less any discount the admin chose, and
// once it is paid the plan is closed as complete (./payoff.ts).
//
// The discount rides IN the token, signed: the admin picks it when making the
// link on the order page, and nobody holding the link can change it. The
// amount itself is never in the link: it is worked out from the order each
// time, so a link made before another month was charged asks for one month
// less, and a plan that has been settled says so.
//
// HMAC over ADMIN_SESSION_SECRET, domain-separated `sd-payoff:` so it can
// never stand in for an admin session, a card link, a balance link or any
// other token. Kept free of heavy imports so the admin page can build it.

export const PAYOFF_PATH = '/courses/pay-remaining';
export const PAYOFF_TOKEN_PARAM = 't';
// Renders the page instead of bouncing to Stripe — the Stripe page's
// cancel_url, so backing out lands somewhere useful.
export const PAYOFF_STAY_PARAM = 'stay';
// Stripe fills this in on the way back ({CHECKOUT_SESSION_ID}).
export const PAYOFF_SESSION_PARAM = 'session_id';

const SIG_CHARS = 24;

export type PayoffToken = { courseRegistrationId: number; discountMinor: number };

export async function signPayoffToken(
  secret: string,
  courseRegistrationId: number,
  discountMinor: number,
): Promise<string> {
  const discount = Math.max(0, Math.round(discountMinor));
  const sig = (await mac(secret, `payoff.${courseRegistrationId}.${discount}`)).slice(
    0,
    SIG_CHARS,
  );
  return `${courseRegistrationId}.${discount}.${sig}`;
}

// What the token was signed for, or null for anything malformed or forged.
// Never throws.
export async function verifyPayoffToken(
  secret: string,
  token: string | null | undefined,
): Promise<PayoffToken | null> {
  const parts = (token ?? '').trim().split('.');
  if (parts.length !== 3) return null;
  const [idRaw, discountRaw, sig] = parts;
  if (!/^\d+$/.test(idRaw) || !/^\d+$/.test(discountRaw) || !sig) return null;
  const id = parseInt(idRaw, 10);
  const discount = parseInt(discountRaw, 10);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(discount)) return null;
  try {
    const expected = (await mac(secret, `payoff.${id}.${discount}`)).slice(0, SIG_CHARS);
    return timingSafeEqual(sig, expected)
      ? { courseRegistrationId: id, discountMinor: discount }
      : null;
  } catch {
    return null;
  }
}

export function payoffUrl(base: string, token: string, opts?: { stay?: boolean }): string {
  const params = new URLSearchParams({ [PAYOFF_TOKEN_PARAM]: token });
  if (opts?.stay) params.set(PAYOFF_STAY_PARAM, '1');
  return `${base.replace(/\/+$/, '')}${PAYOFF_PATH}?${params.toString()}`;
}

export async function buildPayoffUrl(
  secret: string,
  base: string,
  courseRegistrationId: number,
  discountMinor: number,
): Promise<string> {
  return payoffUrl(base, await signPayoffToken(secret, courseRegistrationId, discountMinor));
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
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`sd-payoff:${msg}`));
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
