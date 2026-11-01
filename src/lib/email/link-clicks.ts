// Clicks per link — one row per link click Resend reports on a BROADCAST
// (table email_link_clicks, migration 0097). The broadcast page groups them per
// link (src/components/admin/BroadcastLinkClicks.astro); the segment builder's
// "clicked a link containing …" condition reads the same rows.
//
// What Resend sends (checked against resend.com/docs/webhooks/emails/clicked,
// November 2026):
//   { "type": "email.clicked",
//     "created_at": "<ISO — when the webhook EVENT was created>",
//     "data": { "email_id": "<Resend message id>", "created_at": "<ISO — when
//               the EMAIL was created, i.e. the send time>", "broadcast_id",
//               "message_id", "from", "to": [...], "subject", "tags",
//               "click": { "ipAddress", "link": "<the destination URL>",
//                          "timestamp": "<ISO — when the click happened>",
//                          "userAgent" } } }
// So the click's own time is data.click.timestamp, and the event time for
// every other event is the TOP-LEVEL created_at — data.created_at is the
// email's creation and was wrongly read as the event time until this change.
// The IP address is never stored.
//
// Only broadcasts are recorded (email_type GLOB 'broadcast_*'): transactional
// mail carries live credentials in its links (a waiting-list ?claim= hold, an
// intake &inv= token, a music stream signature), and its clicks still count in
// email_sends.click_count as before. And even on a broadcast, a URL keeps only
// an ALLOWLIST of query parameters — never "everything but a list of known
// secrets", which is how a new per-reader token would slip through.
//
// Everything here is best-effort: a preview runs against production D1 before
// 0097 is applied, so a missing table means "not recorded", never an error.

export type LinkKind = 'content' | 'unsubscribe' | 'preferences';

const MAX_URL = 500;

// Query parameters a stored URL may keep. They say which offer or campaign a
// link was, never who clicked it. Anything else — e, t, email, token, sig,
// claim, inv, s, names, redirect targets — is dropped.
const KEEP_PARAMS = new Set(['discount', 'adiscount', 'installment', 'months', 'extend', 'friend', 'rc', 'ref']);
function keepParam(name: string): boolean {
  const k = name.toLowerCase();
  return k.startsWith('utm_') || KEEP_PARAMS.has(k);
}

const UNSUBSCRIBE_PATHS = new Set(['/unsubscribe', '/api/unsubscribe', '/unsubscribe-promo', '/api/unsubscribe-promo']);
const PREFERENCES_PATHS = new Set(['/email-preferences']);

// Normalise a clicked URL before it is stored: the reader's address, the
// unsubscribe token and every other per-reader parameter must never land in the
// table. Pure — no I/O.
export function normalizeClickUrl(raw: string): { url: string; kind: LinkKind } {
  const input = (raw ?? '').trim();
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    // Not a URL at all: keep it only up to the first '?' or '#'.
    return { url: input.split(/[?#]/)[0].trim().slice(0, MAX_URL), kind: 'content' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    // mailto:, tel:, … — the scheme and target, never a query (a mailto's
    // ?subject=/&body= can carry anything).
    return { url: `${u.protocol}${u.pathname}`.slice(0, MAX_URL), kind: 'content' };
  }

  // URL already lowercases the host and drops a default port. Never keep
  // user:password@ credentials.
  const origin = `${u.protocol}//${u.host.toLowerCase()}`;
  // A path segment carrying an address (e.g. /people/a%40b.com) is masked.
  const path = u.pathname
    .split('/')
    .map((seg) => {
      let decoded = seg;
      try {
        decoded = decodeURIComponent(seg);
      } catch {
        /* keep as is */
      }
      return decoded.includes('@') ? ':email' : seg;
    })
    .join('/');
  const bare = path.length > 1 ? path.replace(/\/+$/, '') : path;

  if (UNSUBSCRIBE_PATHS.has(bare.toLowerCase())) return { url: origin + bare, kind: 'unsubscribe' };
  if (PREFERENCES_PATHS.has(bare.toLowerCase())) return { url: origin + bare, kind: 'preferences' };

  const kept: string[] = [];
  for (const [name, value] of u.searchParams) {
    if (!keepParam(name) || value.includes('@')) continue;
    kept.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  }
  const query = kept.length ? `?${kept.join('&')}` : '';
  // A plain anchor (#register) says where on the page; anything else in a
  // hash (#token=…, an address) is dropped.
  const hash = /^#[\w-]{1,80}$/.test(u.hash) ? u.hash : '';
  return { url: (origin + path + query + hash).slice(0, MAX_URL), kind: 'content' };
}

// Mail security filters (Mimecast, Proofpoint, Safe Links, …) open every link
// in a message to check it; link-preview fetchers and scripts do the same.
export const SCANNER_UA_RE =
  /bot|crawl|spider|preview|scan|python-requests|curl\/|wget|go-http-client|okhttp|java\/|libwww|headlesschrome|phantomjs|barracuda|mimecast|proofpoint|urldefense|symantec|messagelabs|trendmicro|forcepoint|sophos|fortinet|cisco|ironport|safelinks|microsoft office/i;

const FAST_SECONDS = 10;

// Why a click is likely not a person, or null when it looks like one. Order:
// no user agent, a known scanner, then too fast — a click within 10 s of the
// email arriving (a negative gap, i.e. a click before the send was recorded,
// is fast too).
export function botReason(
  ua: string | null,
  secondsSinceSend: number | null,
): 'fast' | 'scanner-ua' | 'no-ua' | null {
  if (!ua || !ua.trim()) return 'no-ua';
  if (SCANNER_UA_RE.test(ua)) return 'scanner-ua';
  if (secondsSinceSend !== null && Number.isFinite(secondsSinceSend) && secondsSinceSend < FAST_SECONDS) return 'fast';
  return null;
}

// Positive results memoised at module level: once the table exists it always
// does. A negative result is re-checked on the next call.
let ready = false;
export async function linkClicksReady(db: D1Database): Promise<boolean> {
  if (ready) return true;
  try {
    await db.prepare('SELECT 1 FROM email_link_clicks LIMIT 0').run();
    return (ready = true);
  } catch {
    return false;
  }
}

// D1 timestamps come in two shapes: datetime('now') gives 'YYYY-MM-DD HH:MM:SS'
// (UTC, no zone), webhooks give ISO with T…Z. Read both as UTC.
function parseUtc(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

// Record one click. 'duplicate' means this webhook delivery (Svix message id)
// was already stored — a retry — and the caller must not count it again.
// 'skipped' = nothing to store (no link, or not a broadcast send we know of).
// Never throws.
export async function recordLinkClick(
  db: D1Database,
  input: { eventId: string | null; resendId: string; link: string; clickedAt: string; userAgent: string | null },
): Promise<'inserted' | 'duplicate' | 'skipped' | 'unavailable'> {
  if (!input.link || !input.resendId) return 'skipped';
  if (!(await linkClicksReady(db))) return 'unavailable';
  try {
    const send = await db
      .prepare(
        `SELECT email_type, lower(to_email) AS to_email, sent_at, delivered_at
           FROM email_sends WHERE resend_id = ?`,
      )
      .bind(input.resendId)
      .first<{ email_type: string | null; to_email: string | null; sent_at: string | null; delivered_at: string | null }>();
    // Broadcasts only (see the header). No send row = we can't tell what the
    // email was, so nothing is stored (and the click-count UPDATE that follows
    // matches no row either). The drain writes a broadcast's email_sends rows
    // in the same tick it sends, long before anyone can click.
    if (!send || !(send.email_type ?? '').startsWith('broadcast_')) return 'skipped';

    const { url, kind } = normalizeClickUrl(input.link);
    const clickedMs = parseUtc(input.clickedAt);
    const sentMs = parseUtc(send.delivered_at) ?? parseUtc(send.sent_at);
    const secondsSinceSend = clickedMs !== null && sentMs !== null ? (clickedMs - sentMs) / 1000 : null;
    const ua = input.userAgent ? input.userAgent.slice(0, 300) : null;
    const reason = botReason(ua, secondsSinceSend);
    const clickedAt = clickedMs !== null ? new Date(clickedMs).toISOString() : new Date().toISOString();

    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO email_link_clicks
           (event_id, resend_id, email_type, to_email, url, link_kind, clicked_at, user_agent, likely_bot, bot_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.eventId,
        input.resendId,
        send.email_type,
        send.to_email,
        url,
        kind,
        clickedAt,
        ua,
        reason ? 1 : 0,
        reason,
      )
      .run();
    if ((res.meta?.changes ?? 0) === 0 && input.eventId) return 'duplicate';
    return 'inserted';
  } catch {
    // No such table (a preview before 0097) or a transient write failure: the
    // caller still counts the click on email_sends as it always has.
    return 'unavailable';
  }
}

export type LinkClickRow = {
  url: string;
  kind: LinkKind;
  clicks: number;
  clickers: number;
  humanClicks: number;
  humanClickers: number;
  botClicks: number;
};

// Clicks per link for one broadcast, most-clicked first. Joins through
// email_sends (one resend_id = one recipient), so a person is counted once per
// link however often they click, and the figures survive a contact's erasure.
export async function broadcastLinkClicks(
  db: D1Database,
  broadcastId: number,
): Promise<{ ready: boolean; rows: LinkClickRow[] }> {
  if (!(await linkClicksReady(db))) return { ready: false, rows: [] };
  try {
    const r = await db
      .prepare(
        `SELECT k.url AS url, k.link_kind AS kind,
                COUNT(*) AS clicks,
                COUNT(DISTINCT k.resend_id) AS clickers,
                SUM(CASE WHEN k.likely_bot = 0 THEN 1 ELSE 0 END) AS humanClicks,
                COUNT(DISTINCT CASE WHEN k.likely_bot = 0 THEN k.resend_id END) AS humanClickers,
                SUM(k.likely_bot) AS botClicks
           FROM email_link_clicks k
           JOIN email_sends s ON s.resend_id = k.resend_id
          WHERE s.email_type = ?
          GROUP BY k.url, k.link_kind
          ORDER BY clicks DESC
          LIMIT 100`,
      )
      .bind(`broadcast_${broadcastId}`)
      .all<{
        url: string;
        kind: string;
        clicks: number;
        clickers: number;
        humanClicks: number | null;
        humanClickers: number;
        botClicks: number | null;
      }>();
    const rows: LinkClickRow[] = (r.results ?? []).map((x) => ({
      url: x.url,
      kind: x.kind === 'unsubscribe' || x.kind === 'preferences' ? x.kind : 'content',
      clicks: x.clicks ?? 0,
      clickers: x.clickers ?? 0,
      humanClicks: x.humanClicks ?? 0,
      humanClickers: x.humanClickers ?? 0,
      botClicks: x.botClicks ?? 0,
    }));
    return { ready: true, rows };
  } catch {
    return { ready: false, rows: [] };
  }
}
