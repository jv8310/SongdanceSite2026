// The durable "update your card" link for a course installment plan.
//
// When a monthly installment fails, the buyer needs a way to put a new card on
// the plan. Stripe's own pages for that (a Checkout Session in setup mode, a
// billing-portal session) live 24 hours at the outside — and a payment email is
// read days later, which is exactly how the retreat balance links broke
// (see src/lib/registrations/balance-link.ts). So what we hand out is a link to
// US: /courses/update-payment?t=<token>. Each click mints a fresh Stripe page,
// the link itself never expires, and once the plan is settled or closed the
// page says so in our words.
//
// It is what the three failed-payment reminders carry
// (src/lib/courses/dunning.ts), what the support hand-off email quotes, and
// what "Copy card link" on /admin/courses/future-revenue copies — one link,
// whoever sends it.
//
// The token is an HMAC over ADMIN_SESSION_SECRET, domain-separated `sd-card:`
// so it can never stand in for an admin session, a balance link, a music
// cookie or a share token. It carries no credential of its own: it opens the
// buyer's own plan, and the only thing it can do is let them save a card for
// it and settle what that plan already owes.
//
// Kept free of heavy imports (no Stripe, no DB) so email builders, admin pages
// and the cron can all build it.

export const CARD_UPDATE_PATH = '/courses/update-payment';
export const CARD_UPDATE_TOKEN_PARAM = 't';
// Renders the page's panel instead of bouncing to Stripe — the Stripe page's
// cancel_url, so backing out lands somewhere useful, not in a redirect loop.
export const CARD_UPDATE_STAY_PARAM = 'stay';
// Stripe fills this in on the way back ({CHECKOUT_SESSION_ID}); its presence is
// what makes the page apply the new card and report what the charge did.
export const CARD_UPDATE_SESSION_PARAM = 'session_id';

// 24 hex chars (96 bits) of signature, same as the balance link.
const SIG_CHARS = 24;

export async function signCardUpdateToken(
  secret: string,
  courseRegistrationId: number,
): Promise<string> {
  const sig = (await mac(secret, `card.${courseRegistrationId}`)).slice(0, SIG_CHARS);
  return `${courseRegistrationId}.${sig}`;
}

// The course registration id this token was signed for, or null for anything
// malformed, unsigned or forged. Never throws.
export async function verifyCardUpdateToken(
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
    const expected = (await mac(secret, `card.${id}`)).slice(0, SIG_CHARS);
    return timingSafeEqual(sig, expected) ? id : null;
  } catch {
    return null;
  }
}

export function cardUpdateUrl(
  base: string,
  token: string,
  opts?: { stay?: boolean },
): string {
  const params = new URLSearchParams({ [CARD_UPDATE_TOKEN_PARAM]: token });
  if (opts?.stay) params.set(CARD_UPDATE_STAY_PARAM, '1');
  return `${base.replace(/\/+$/, '')}${CARD_UPDATE_PATH}?${params.toString()}`;
}

// Sign + build in one step.
export async function buildCardUpdateUrl(
  secret: string,
  base: string,
  courseRegistrationId: number,
  opts?: { stay?: boolean },
): Promise<string> {
  return cardUpdateUrl(base, await signCardUpdateToken(secret, courseRegistrationId), opts);
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
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`sd-card:${msg}`));
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
