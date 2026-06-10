// Unsubscribe tokens + suppression list for lifecycle marketing emails.
//
// Links are self-authenticating: an HMAC-SHA256 of the (lowercased) email,
// signed with UNSUBSCRIBE_SECRET (falling back to ADMIN_SESSION_SECRET so no
// new secret is required). No DB lookup is needed to validate a link, and a
// token only ever unsubscribes the address it was minted for.
//
// Two URLs are minted per email:
//   - unsubscribePageUrl(): /unsubscribe?e=…&t=…   (human-facing confirm page,
//     linked from the email footer)
//   - oneClickUnsubscribeUrl(): /api/unsubscribe?e=…&t=…  (RFC 8058 one-click
//     POST target, referenced from the List-Unsubscribe header)
//
// Suppression only gates marketing-flavoured sends (abandoned checkout,
// post-workshop promotion, downsell). Transactional email — verification,
// confirmations, session reminders — keeps flowing.

export function unsubscribeSecret(env: {
  UNSUBSCRIBE_SECRET?: string;
  ADMIN_SESSION_SECRET?: string;
}): string | null {
  return env.UNSUBSCRIBE_SECRET || env.ADMIN_SESSION_SECRET || null;
}

export async function unsubscribeToken(secret: string, email: string): Promise<string> {
  return hmacHex(secret, `unsub.${email.trim().toLowerCase()}`);
}

export async function verifyUnsubscribeToken(
  secret: string,
  email: string,
  token: string,
): Promise<boolean> {
  if (!email || !token) return false;
  const expected = await unsubscribeToken(secret, email);
  return timingSafeEqual(token, expected);
}

export async function unsubscribePageUrl(base: string, secret: string, email: string): Promise<string> {
  const t = await unsubscribeToken(secret, email);
  return `${base.replace(/\/$/, '')}/unsubscribe?e=${encodeURIComponent(email.trim().toLowerCase())}&t=${t}`;
}

export async function oneClickUnsubscribeUrl(base: string, secret: string, email: string): Promise<string> {
  const t = await unsubscribeToken(secret, email);
  return `${base.replace(/\/$/, '')}/api/unsubscribe?e=${encodeURIComponent(email.trim().toLowerCase())}&t=${t}`;
}

// ── Suppression list ──────────────────────────────────────────────────────

export async function isEmailSuppressed(db: D1Database, email: string): Promise<boolean> {
  const r = await db
    .prepare('SELECT 1 AS one FROM email_suppressions WHERE email = ?')
    .bind(email.trim().toLowerCase())
    .first<{ one: number }>();
  return !!r;
}

export async function suppressEmail(db: D1Database, email: string, source: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO email_suppressions (email, reason, source) VALUES (?, 'unsubscribe', ?)
       ON CONFLICT(email) DO NOTHING`,
    )
    .bind(email.trim().toLowerCase(), source)
    .run();
}

// ── Crypto helpers ────────────────────────────────────────────────────────

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
