// "Share this workshop or masterclass with a friend" — the referral link on the
// countdown page (/workshop/success), and the measurement of what it does.
//
// The link is public and carries the public ?discount=50 (the one publicly
// honored value — see discount.ts), so it is safe to post anywhere. What it
// gained here is a way to answer "does any of this work?":
//
//   ?ref=<registration id>.<sig>   who shared it (HMAC-signed, so nobody can
//                                  credit a referral to a stranger, and the
//                                  sharer's access_token — a real credential —
//                                  never rides a public link)
//   ?rc=<channel>                  which button they pressed
//
// Four steps are recorded (three in workshop_share_events, the fourth on the
// registration itself — see migration 0082): the panel was shown · a share
// button was pressed · a friend opened the link · a friend registered.
//
// THE LANDING PAGE IS PART OF THE LINK, and it is resolved in exactly one
// place: `shareLandingPath`. A masterclass shares /courses/masterclass, a
// workshop shares /workshop. Until September 2026 the countdown page hard-coded
// /workshop for both, so every masterclass attendee sent their friends to the
// €22 workshop page — a different session, a different price, and the ★ "your
// friend is going to this one" marker landing on a date the friend could not
// see. Anything building a share link must call this, never rebuild the path.

export const SHARE_PARAM = 'ref';
export const SHARE_CHANNEL_PARAM = 'rc';
export const SHARE_COOKIE = 'sd_ref';
const SHARE_COOKIE_DAYS = 30;

// The buttons on the panel. 'link' is what a visit reports when the friend's
// link carries no channel (a hand-edited or truncated link).
export const SHARE_CHANNELS = [
  'copy',
  'whatsapp',
  'facebook',
  'telegram',
  'email',
  'native',
  'link',
] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export function normalizeChannel(raw: string | null | undefined): ShareChannel {
  const v = (raw ?? '').trim().toLowerCase();
  return (SHARE_CHANNELS as readonly string[]).includes(v) ? (v as ShareChannel) : 'link';
}

export const SHARE_CHANNEL_LABELS: Record<ShareChannel, string> = {
  copy: 'Copied link',
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  telegram: 'Telegram',
  email: 'Email',
  native: 'Share sheet',
  link: 'Untagged link',
};

// ── The link ──────────────────────────────────────────────────────────────

// Where a shared link lands. The masterclass is its own landing page with its
// own dates and its own price; a workshop shares the workshop page.
export function shareLandingPath(isMasterclass: boolean): string {
  return isMasterclass ? '/courses/masterclass' : '/workshop';
}

// The share link itself. `channel` is appended per button so a click can be
// told from a paste; omit it for the canonical link shown in the copy field.
export function buildShareUrl(opts: {
  base: string;
  isMasterclass: boolean;
  workshopSlug: string;
  discountParam: string;
  discountPct: number;
  token: string;
  channel?: ShareChannel;
}): string {
  const params = new URLSearchParams();
  params.set(opts.discountParam, String(opts.discountPct));
  // ?friend=<slug> stars the date the sharer is attending, while leaving every
  // other date on the page open at the same discount.
  params.set('friend', opts.workshopSlug);
  params.set(SHARE_PARAM, opts.token);
  if (opts.channel) params.set(SHARE_CHANNEL_PARAM, opts.channel);
  return `${opts.base.replace(/\/$/, '')}${shareLandingPath(opts.isMasterclass)}?${params.toString()}`;
}

// ── The token ─────────────────────────────────────────────────────────────

// `<registration id>.<sig>`; the signature is truncated to 16 hex chars, which
// is plenty for "you can't forge a referral credit" and keeps the link short.
export async function signShareToken(secret: string, registrationId: number): Promise<string> {
  return `${registrationId}.${(await mac(secret, `share.${registrationId}`)).slice(0, 16)}`;
}

// Returns the sharer's registration id, or null for anything malformed or
// unsigned. Never throws — a bad token is just an untracked visit.
export async function verifyShareToken(
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
    const expected = (await mac(secret, `share.${id}`)).slice(0, 16);
    return timingSafeEqual(sig, expected) ? id : null;
  } catch {
    return null;
  }
}

// ── The cookie ────────────────────────────────────────────────────────────
//
// A friend rarely registers on the landing hit: they read the page, pick a
// date, maybe come back tomorrow. The cookie carries the referral across that,
// so the checkout can attribute the sale without the form having to pass
// anything along. Value is `<token>~<channel>`.

export function shareCookieValue(token: string, channel: ShareChannel): string {
  return `${token}~${channel}`;
}

export function shareCookieHeader(value: string): string {
  const maxAge = SHARE_COOKIE_DAYS * 86400;
  return `${SHARE_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure; HttpOnly`;
}

export function readShareCookie(request: Request): string | null {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SHARE_COOKIE) return rest.join('=');
  }
  return null;
}

export function parseShareCookie(
  value: string | null | undefined,
): { token: string; channel: ShareChannel } | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const [token, channel] = raw.split('~');
  if (!token) return null;
  return { token, channel: normalizeChannel(channel) };
}

// ── Bots ──────────────────────────────────────────────────────────────────

// WhatsApp, Facebook, Telegram and Slack all fetch a shared URL themselves to
// build the preview card — with no cookie, so every one of those would count as
// a friend opening the link. Filtering them is the difference between a real
// number and one that goes up every time somebody pastes a link.
const BOT_RE =
  /bot|crawl|spider|preview|facebookexternalhit|facebookcatalog|whatsapp|telegram|slackbot|discord|twitterbot|linkedinbot|pinterest|embedly|quora link preview|redditbot|applebot|bingpreview|headlesschrome|python-requests|curl\/|wget|axios|node-fetch|go-http-client|monitor|uptime|lighthouse|pagespeed/i;

export function looksLikeShareBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? '').trim();
  if (!ua) return true; // no UA at all is a script, not a person
  return BOT_RE.test(ua);
}

// ── Recording ─────────────────────────────────────────────────────────────

// The share panel was rendered for this registrant. INSERT OR IGNORE against
// the partial unique index (migration 0082) makes this a headcount: the
// countdown page is reloaded constantly while people wait for the join button.
export async function recordSharePanelView(
  db: D1Database,
  registrationId: number,
  workshopId: number,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT OR IGNORE INTO workshop_share_events (kind, registration_id, workshop_id)
         VALUES ('view', ?, ?)`,
      )
      .bind(registrationId, workshopId)
      .run();
  } catch (err) {
    console.error(`recordSharePanelView: ${String(err)}`);
  }
}

// A share button was pressed. Every press is stored, so both the total and the
// number of distinct sharers are countable.
export async function recordShareAction(
  db: D1Database,
  registrationId: number,
  workshopId: number | null,
  channel: ShareChannel,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workshop_share_events (kind, channel, registration_id, workshop_id)
       VALUES ('share', ?, ?, ?)`,
    )
    .bind(channel, registrationId, workshopId)
    .run();
}

// A friend opened a shared link. Recorded on first landing per browser — the
// cookie the same request sets is what keeps a reload (which keeps ?ref= in the
// address bar) from counting again.
export async function recordShareVisit(
  db: D1Database,
  registrationId: number,
  channel: ShareChannel,
  path: string,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO workshop_share_events (kind, channel, registration_id, workshop_id, path)
         VALUES ('visit', ?, ?,
                 (SELECT workshop_id FROM workshop_registrations WHERE id = ?), ?)`,
      )
      .bind(channel, registrationId, registrationId, path.slice(0, 200))
      .run();
  } catch (err) {
    console.error(`recordShareVisit: ${String(err)}`);
  }
}

// The sharer's own registration, for the checkout's self-referral guard and for
// the admin table's "who shared it" column.
export async function getSharerRegistration(
  db: D1Database,
  registrationId: number,
): Promise<{ id: number; email: string; workshop_id: number } | null> {
  return await db
    .prepare('SELECT id, email, workshop_id FROM workshop_registrations WHERE id = ?')
    .bind(registrationId)
    .first<{ id: number; email: string; workshop_id: number }>();
}

// Resolve the referral a checkout should be credited to, from the request's
// cookie. Returns null when there is none, the token doesn't verify, the
// sharer's row is gone, or the "friend" is the sharer themselves — re-buying a
// seat on your own link is not a referral.
export async function resolveReferralForCheckout(
  db: D1Database,
  secret: string,
  request: Request,
  buyerEmail: string,
): Promise<{ referredById: number; channel: ShareChannel } | null> {
  const parsed = parseShareCookie(readShareCookie(request));
  if (!parsed) return null;
  const referredById = await verifyShareToken(secret, parsed.token);
  if (!referredById) return null;
  const sharer = await getSharerRegistration(db, referredById);
  if (!sharer) return null;
  if (sharer.email.trim().toLowerCase() === buyerEmail.trim().toLowerCase()) return null;
  return { referredById, channel: parsed.channel };
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
  // `sd-share:` domain-separates these MACs from the admin session's and the
  // music listener's (same secret, different message space), so a share token
  // can never be presented as either.
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`sd-share:${msg}`));
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
