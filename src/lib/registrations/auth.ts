// Simple HMAC-signed admin session cookie. Username is always "admin"; the
// password is checked against ADMIN_PASSWORD. Cookie expires after 12 hours.
// Cloudflare Access can be layered on top in production for SSO.

const COOKIE_NAME = 'sd_admin';
const SESSION_HOURS = 12;

export async function signSession(secret: string, exp: number) {
  const payload = `admin.${exp}`;
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
  const [user, expStr, mac] = parts;
  if (user !== 'admin') return false;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(secret, `${user}.${expStr}`);
  return timingSafeEqual(mac, expected);
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
