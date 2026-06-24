// HMAC-signed admin session cookie, now multi-user.
//
// Login takes an email + password. Credentials come from two env sources that
// are merged (see `adminUsers`):
//   • ADMIN_PASSWORD (+ optional ADMIN_EMAIL, default jacob@songdance.co) — the
//     original single-owner login, kept working for backward compatibility.
//   • ADMIN_USERS — additional collaborators. Either a simple list, one
//     `email:password` per line (or separated by `;`), or a JSON array
//     (`[{"email":"…","password":"…"}]`). See parseAdminUsers below.
//
// The session cookie carries the signed-in email (base64url, so it survives the
// dotted token format) and expires after 12 hours. Existing `admin.…` cookies
// stay valid — verifySession only checks the signature, not the subject — so a
// deploy doesn't force everyone to re-login. Cloudflare Access can still be
// layered on top in production for SSO.

const COOKIE_NAME = 'sd_admin';
const SESSION_HOURS = 12;
const DEFAULT_ADMIN_EMAIL = 'jacob@songdance.co';

export type AdminUser = { email: string; password: string };

// Parse the ADMIN_USERS env var. Accepts either JSON
// (`[{"email","password"}]`, `[["email","password"]]`, or `{ "email": "pw" }`)
// or a plain list of `email:password` entries separated by newlines or `;`.
// The email/password split is on the FIRST colon, so passwords may contain ':'.
export function parseAdminUsers(raw: string | undefined | null): AdminUser[] {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed);
      const out: AdminUser[] = [];
      if (Array.isArray(data)) {
        for (const item of data) {
          if (Array.isArray(item) && item.length >= 2) {
            out.push({ email: String(item[0]), password: String(item[1]) });
          } else if (item && typeof item === 'object' && 'email' in item && 'password' in item) {
            out.push({ email: String(item.email), password: String(item.password) });
          }
        }
      } else if (data && typeof data === 'object') {
        for (const [email, password] of Object.entries(data)) {
          out.push({ email, password: String(password) });
        }
      }
      return out.filter((u) => u.email.trim() && u.password);
    } catch {
      // Not valid JSON — fall through to the line format.
    }
  }

  const out: AdminUser[] = [];
  for (const entry of trimmed.split(/[\n;]+/)) {
    const line = entry.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const email = line.slice(0, idx).trim();
    const password = line.slice(idx + 1).trim();
    if (email && password) out.push({ email, password });
  }
  return out;
}

// The full set of admin credentials: ADMIN_USERS plus the legacy
// ADMIN_PASSWORD/ADMIN_EMAIL owner login (unless ADMIN_USERS already defines
// that email, which then wins).
export function adminUsers(env: {
  ADMIN_USERS?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_EMAIL?: string;
}): AdminUser[] {
  const users = parseAdminUsers(env.ADMIN_USERS);
  if (env.ADMIN_PASSWORD) {
    const email = (env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim();
    if (!users.some((u) => u.email.trim().toLowerCase() === email.toLowerCase())) {
      users.push({ email, password: env.ADMIN_PASSWORD });
    }
  }
  return users;
}

// Check an email + password against the configured admins. Returns the
// canonical (lowercased) email on success, or null. Email match is
// case-insensitive; the password compare is timing-safe.
export function authenticate(
  env: { ADMIN_USERS?: string; ADMIN_PASSWORD?: string; ADMIN_EMAIL?: string },
  email: string,
  password: string,
): string | null {
  const target = email.trim().toLowerCase();
  if (!target || !password) return null;
  let match: string | null = null;
  for (const u of adminUsers(env)) {
    if (u.email.trim().toLowerCase() === target && timingSafeEqual(password, u.password)) {
      match = target;
    }
  }
  return match;
}

export async function signSession(secret: string, exp: number, subject = 'admin') {
  const payload = `${b64urlEncode(subject)}.${exp}`;
  const mac = await hmac(secret, payload);
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
  if (!sub) return false;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(secret, `${sub}.${expStr}`);
  return timingSafeEqual(mac, expected);
}

// The email of the signed-in admin, for display (e.g. "Signed in as …"). Verifies
// the session first; returns null for an invalid/expired cookie or a legacy
// (pre-multi-user) session that carried no email.
export async function getSessionEmail(
  secret: string,
  cookie: string | null,
): Promise<string | null> {
  if (!(await verifySession(secret, cookie))) return null;
  const sub = cookie!.split('.')[0];
  const decoded = b64urlDecode(sub);
  return decoded && decoded.includes('@') ? decoded : null;
}

export function sessionCookieHeader(token: string) {
  const maxAge = SESSION_HOURS * 3600;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readCookie(req: Request) {
  const header = req.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

export function sessionExpiry() {
  return Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
}

async function hmac(secret: string, msg: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return bufToHex(sig);
}

function bufToHex(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++)
    out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

// base64url so an email survives the dotted token format (no '.', '+' or '/').
function b64urlEncode(s: string) {
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

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function requireAdmin(req: Request, secret: string) {
  const ok = await verifySession(secret, readCookie(req));
  if (!ok) {
    return new Response('Unauthorized', {
      status: 302,
      headers: { Location: '/admin/login' },
    });
  }
  return null;
}
