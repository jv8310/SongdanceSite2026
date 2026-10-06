// The "stop these emails" link on every course sequence email.
//
// /courses/emails?t=<enrolment id>.<sig> opens a page that names the series
// and offers one button to stop it (and, once stopped, one to start it again).
// The page acts on POST only, never on the GET a link prefetcher makes — an
// inbox scanner opening the link must not stop someone's journey. The
// List-Unsubscribe header points at /api/courses/emails/stop?t=… instead, which
// takes the mail client's RFC 8058 one-click POST.
//
// A stop is scoped to that one series (a row of course_email_sequences): it is
// not an unsubscribe from Songdance, and it never touches access to the course.
//
// The token is an HMAC over ADMIN_SESSION_SECRET, domain-separated `sd-seqstop:`
// so it can never stand in for an admin session, a card or balance link, a
// music cookie or a share token. Same shape as ../card-update-link.ts.

export const SEQUENCE_STOP_PATH = '/courses/emails';
export const SEQUENCE_ONE_CLICK_PATH = '/api/courses/emails/stop';

const SIG_CHARS = 24;

export async function signSequenceToken(secret: string, enrolmentId: number): Promise<string> {
  const sig = (await mac(secret, `seq.${enrolmentId}`)).slice(0, SIG_CHARS);
  return `${enrolmentId}.${sig}`;
}

// The enrolment id this token was signed for, or null for anything malformed,
// unsigned or forged. Never throws.
export async function verifySequenceToken(
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
    const expected = (await mac(secret, `seq.${id}`)).slice(0, SIG_CHARS);
    return timingSafeEqual(sig, expected) ? id : null;
  } catch {
    return null;
  }
}

export function sequenceStopUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, '')}${SEQUENCE_STOP_PATH}?t=${encodeURIComponent(token)}`;
}

export function sequenceOneClickUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, '')}${SEQUENCE_ONE_CLICK_PATH}?t=${encodeURIComponent(token)}`;
}

async function mac(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`sd-seqstop:${msg}`));
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
