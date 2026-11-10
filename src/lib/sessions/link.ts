// The client's own link to their booking: /sessions/booking?t=<id>.<sig>
// It shows the time on their clock, the Zoom link, the calendar files, and —
// until the move window closes — lets them pick another moment.
//
// HMAC over ADMIN_SESSION_SECRET, domain-separated `sd-session:` so it can
// never stand in for an admin session or any other signed link on the site.
// Kept free of heavy imports.

export const BOOKING_PATH = '/sessions/booking';
const SIG_CHARS = 24;

export async function signBookingToken(secret: string, bookingId: number): Promise<string> {
  return `${bookingId}.${(await mac(secret, `booking.${bookingId}`)).slice(0, SIG_CHARS)}`;
}

export async function verifyBookingToken(secret: string, token: string | null | undefined): Promise<number | null> {
  const parts = (token ?? '').trim().split('.');
  if (parts.length !== 2) return null;
  const [idRaw, sig] = parts;
  if (!/^\d+$/.test(idRaw) || !sig) return null;
  const id = parseInt(idRaw, 10);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  try {
    const expected = (await mac(secret, `booking.${id}`)).slice(0, SIG_CHARS);
    return timingSafeEqual(sig, expected) ? id : null;
  } catch {
    return null;
  }
}

export async function bookingUrl(
  secret: string,
  base: string,
  bookingId: number,
  extra?: Record<string, string>,
): Promise<string> {
  const params = new URLSearchParams({ t: await signBookingToken(secret, bookingId), ...(extra ?? {}) });
  return `${base.replace(/\/+$/, '')}${BOOKING_PATH}?${params.toString()}`;
}

export async function bookingIcsUrl(secret: string, base: string, bookingId: number): Promise<string> {
  return `${base.replace(/\/+$/, '')}/api/sessions/ics?t=${encodeURIComponent(await signBookingToken(secret, bookingId))}`;
}

async function mac(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`sd-session:${msg}`));
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
