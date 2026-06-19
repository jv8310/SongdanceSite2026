// Data layer for the standalone marketing list + one-off broadcasts
// (migrations/0047). Contacts are imported from a CSV; a broadcast snapshots
// them into a send queue that the 5-minute cron drains. Engagement (open/click/
// bounce/complaint) rides the existing email_sends table, keyed on a per-
// broadcast email_type, so /admin/emails/stats and the broadcast detail page
// both read the same numbers.

export type Broadcast = {
  id: number;
  name: string;
  subject: string;
  preheader: string | null;
  heading: string;
  body: string;
  format: 'simple' | 'html';
  body_text: string | null;
  hero_image: string | null;
  cta_label: string | null;
  cta_href: string | null;
  window_start_hour: number;
  window_end_hour: number;
  status: 'draft' | 'sending' | 'paused' | 'done';
  paused_reason: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type ContactRow = {
  email: string;
  name?: string | null;
  timezone?: string | null;
  country?: string | null;
};

// Each broadcast tracks its sends under its own email_type, so the stats table
// (email_sends) and the webhook fold open/click/bounce/complaint onto the right
// campaign. emailTypeMeta() in src/lib/email/sends.ts recognises this prefix.
export function broadcastEmailType(id: number): string {
  return `broadcast_${id}`;
}

// IANA timezone is valid if Intl can format with it. Invalid/blank values are
// stored as null so withinSendWindow() falls back to the default window rather
// than sending around the clock (an unknown tz reads as always-in-window).
export function normalizeTimezone(tz: string | null | undefined): string | null {
  const t = (tz ?? '').trim();
  if (!t) return null;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: t }).format(new Date());
    return t;
  } catch {
    return null;
  }
}

// ── Contacts ────────────────────────────────────────────────────────────────

// Upsert a batch of contacts. Multi-row INSERTs (≤80 rows each, well under
// SQLite's bound-variable ceiling) run in one D1 batch. Existing rows keep their
// non-null fields unless the import carries a better value. Returns rows seen.
export async function importContacts(
  db: D1Database,
  rows: ContactRow[],
  source = 'import',
): Promise<number> {
  if (rows.length === 0) return 0;
  const CHUNK = 80; // 80 × 5 binds = 400, under the 999 variable limit
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const placeholders = slice.map(() => '(?,?,?,?,?)').join(',');
    const binds: (string | null)[] = [];
    for (const r of slice) {
      binds.push(
        r.email.trim().toLowerCase(),
        (r.name ?? null) || null,
        normalizeTimezone(r.timezone),
        (r.country ?? null) || null,
        source,
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO contacts (email, name, timezone, country, source)
             VALUES ${placeholders}
           ON CONFLICT(email) DO UPDATE SET
             name = COALESCE(excluded.name, contacts.name),
             timezone = COALESCE(excluded.timezone, contacts.timezone),
             country = COALESCE(excluded.country, contacts.country),
             updated_at = datetime('now')`,
        )
        .bind(...binds),
    );
  }
  await db.batch(statements);
  return rows.length;
}

// Reads are defensive: the tables may not exist yet on a preview version that
// runs against production D1 before migration 0047 has merged. A missing table
// reads as "empty" so the admin pages render rather than 500.
export async function countContacts(db: D1Database): Promise<number> {
  try {
    const r = await db.prepare('SELECT COUNT(*) AS n FROM contacts').first<{ n: number }>();
    return r?.n ?? 0;
  } catch {
    return 0;
  }
}

// How many contacts a broadcast would actually reach: total minus anyone on the
// suppression list (unsubscribed / complained).
export async function countSendable(db: D1Database): Promise<number> {
  try {
    const r = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM contacts c
          WHERE NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email = c.email)`,
      )
      .first<{ n: number }>();
    return r?.n ?? 0;
  } catch {
    return 0;
  }
}

export async function recentContacts(db: D1Database, limit = 10): Promise<ContactRow[]> {
  try {
    const r = await db
      .prepare('SELECT email, name, timezone, country FROM contacts ORDER BY id DESC LIMIT ?')
      .bind(limit)
      .all<ContactRow>();
    return r.results ?? [];
  } catch {
    return [];
  }
}

// ── Broadcasts ────────────────────────────────────────────────────────────────

export async function listBroadcasts(db: D1Database): Promise<Broadcast[]> {
  try {
    const r = await db.prepare('SELECT * FROM broadcasts ORDER BY id DESC').all<Broadcast>();
    return r.results ?? [];
  } catch {
    return [];
  }
}

export async function getBroadcast(db: D1Database, id: number): Promise<Broadcast | null> {
  try {
    return (await db.prepare('SELECT * FROM broadcasts WHERE id = ?').bind(id).first<Broadcast>()) ?? null;
  } catch {
    return null;
  }
}

export type BroadcastInput = {
  name: string;
  subject: string;
  preheader?: string | null;
  heading: string;
  body: string;
  format?: 'simple' | 'html';
  body_text?: string | null;
  hero_image?: string | null;
  cta_label?: string | null;
  cta_href?: string | null;
  window_start_hour?: number;
  window_end_hour?: number;
};

// Clamp the send window to a sane 0–24 and ensure start < end; fall back to the
// 08:00–21:00 default if the values are nonsense.
function windowHours(b: BroadcastInput): { start: number; end: number } {
  let start = Number.isFinite(b.window_start_hour) ? Math.floor(b.window_start_hour as number) : 8;
  let end = Number.isFinite(b.window_end_hour) ? Math.floor(b.window_end_hour as number) : 21;
  start = Math.max(0, Math.min(23, start));
  end = Math.max(1, Math.min(24, end));
  if (end <= start) {
    start = 8;
    end = 21;
  }
  return { start, end };
}

export async function createBroadcast(db: D1Database, b: BroadcastInput): Promise<number> {
  const w = windowHours(b);
  const r = await db
    .prepare(
      `INSERT INTO broadcasts
         (name, subject, preheader, heading, body, format, body_text, hero_image,
          cta_label, cta_href, window_start_hour, window_end_hour)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      b.name,
      b.subject,
      b.preheader ?? null,
      b.heading,
      b.body,
      b.format === 'html' ? 'html' : 'simple',
      b.body_text ?? null,
      b.hero_image ?? null,
      b.cta_label ?? null,
      b.cta_href ?? null,
      w.start,
      w.end,
    )
    .run();
  return Number(r.meta?.last_row_id ?? 0);
}

// Edits are only allowed while a broadcast is still a draft — once it's sending,
// the queue is already snapshotted and recipients may have received the email.
export async function updateBroadcast(db: D1Database, id: number, b: BroadcastInput): Promise<void> {
  const w = windowHours(b);
  await db
    .prepare(
      `UPDATE broadcasts
          SET name = ?, subject = ?, preheader = ?, heading = ?, body = ?,
              format = ?, body_text = ?, hero_image = ?, cta_label = ?, cta_href = ?,
              window_start_hour = ?, window_end_hour = ?
        WHERE id = ? AND status = 'draft'`,
    )
    .bind(
      b.name,
      b.subject,
      b.preheader ?? null,
      b.heading,
      b.body,
      b.format === 'html' ? 'html' : 'simple',
      b.body_text ?? null,
      b.hero_image ?? null,
      b.cta_label ?? null,
      b.cta_href ?? null,
      w.start,
      w.end,
      id,
    )
    .run();
}

// ── Launch / queue ────────────────────────────────────────────────────────────

// Snapshot the current sendable contacts into the queue. INSERT … SELECT does
// the whole list in one statement (no client-side row shuttling); INSERT OR
// IGNORE + the UNIQUE(broadcast_id,email) makes a re-launch a safe top-up.
// Returns the number of new rows added this call.
export async function snapshotRecipients(db: D1Database, broadcastId: number): Promise<number> {
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO broadcast_recipients (broadcast_id, email, name, timezone, status)
         SELECT ?, c.email, c.name, c.timezone, 'pending'
           FROM contacts c
          WHERE NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email = c.email)`,
    )
    .bind(broadcastId)
    .run();
  return r.meta?.changes ?? 0;
}

// Snapshot the audience and flip the broadcast to 'sending'. Returns the total
// recipient count (not just the rows added this call).
export async function launchBroadcast(db: D1Database, id: number): Promise<number> {
  await snapshotRecipients(db, id);
  await db
    .prepare(
      `UPDATE broadcasts
          SET status = 'sending',
              started_at = COALESCE(started_at, datetime('now')),
              completed_at = NULL,
              paused_reason = NULL
        WHERE id = ? AND status IN ('draft', 'paused')`,
    )
    .bind(id)
    .run();
  const r = await db
    .prepare('SELECT COUNT(*) AS n FROM broadcast_recipients WHERE broadcast_id = ?')
    .bind(id)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function pauseBroadcast(db: D1Database, id: number, reason: string): Promise<void> {
  await db
    .prepare(`UPDATE broadcasts SET status = 'paused', paused_reason = ? WHERE id = ? AND status = 'sending'`)
    .bind(reason, id)
    .run();
}

export async function resumeBroadcast(db: D1Database, id: number): Promise<void> {
  await db
    .prepare(`UPDATE broadcasts SET status = 'sending', paused_reason = NULL WHERE id = ? AND status = 'paused'`)
    .bind(id)
    .run();
}

export async function markBroadcastDone(db: D1Database, id: number): Promise<void> {
  await db
    .prepare(`UPDATE broadcasts SET status = 'done', completed_at = datetime('now') WHERE id = ? AND status = 'sending'`)
    .bind(id)
    .run();
}

export async function listActiveBroadcasts(db: D1Database): Promise<Broadcast[]> {
  try {
    const r = await db.prepare(`SELECT * FROM broadcasts WHERE status = 'sending' ORDER BY id`).all<Broadcast>();
    return r.results ?? [];
  } catch {
    return [];
  }
}

// ── Recipient draining ────────────────────────────────────────────────────────

export type DrainCandidate = { id: number; email: string; name: string | null; timezone: string | null };

// Over-fetch pending rows; the cron filters them by each recipient's local
// window and sends up to its per-run cap. Ordered by id (snapshot order, which
// is arbitrary w.r.t. timezone), so the in-window subset stays well-mixed.
export async function fetchDrainCandidates(
  db: D1Database,
  broadcastId: number,
  limit: number,
): Promise<DrainCandidate[]> {
  const r = await db
    .prepare(
      `SELECT id, email, name, timezone FROM broadcast_recipients
        WHERE broadcast_id = ? AND status = 'pending' ORDER BY id LIMIT ?`,
    )
    .bind(broadcastId, limit)
    .all<DrainCandidate>();
  return r.results ?? [];
}

// Atomically claim a pending row (and bump its attempt count). Returns true only
// if THIS call moved it from 'pending' to 'sending' — so two overlapping runs
// can never send to the same address twice.
export async function claimRecipient(db: D1Database, id: number): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE broadcast_recipients
          SET status = 'sending', attempts = attempts + 1, claimed_at = datetime('now')
        WHERE id = ? AND status = 'pending'`,
    )
    .bind(id)
    .run();
  return (r.meta?.changes ?? 0) === 1;
}

// Release rows that were claimed but never resolved (a worker that died between
// claim and send/fail). They go back to 'pending' for a later run; their bumped
// attempt count still bounds how many times they can be retried.
export async function reclaimStaleClaims(
  db: D1Database,
  broadcastId: number,
  olderThanMinutes = 15,
): Promise<void> {
  await db
    .prepare(
      `UPDATE broadcast_recipients SET status = 'pending'
        WHERE broadcast_id = ? AND status = 'sending'
          AND (claimed_at IS NULL OR claimed_at < datetime('now', ?))`,
    )
    .bind(broadcastId, `-${olderThanMinutes} minutes`)
    .run();
}

export async function markRecipientSent(db: D1Database, id: number, resendId: string | null): Promise<void> {
  await db
    .prepare(
      `UPDATE broadcast_recipients SET status = 'sent', resend_id = ?, sent_at = datetime('now'), error = NULL WHERE id = ?`,
    )
    .bind(resendId, id)
    .run();
}

export async function markRecipientSuppressed(db: D1Database, id: number): Promise<void> {
  await db.prepare(`UPDATE broadcast_recipients SET status = 'suppressed' WHERE id = ?`).bind(id).run();
}

// A transient send failure releases the row back to 'pending' so a later run
// retries it — unless it's already burned through its attempts, in which case
// it's parked as 'failed'.
export async function markRecipientRetryOrFail(
  db: D1Database,
  id: number,
  error: string,
  maxAttempts = 3,
): Promise<void> {
  await db
    .prepare(
      `UPDATE broadcast_recipients
          SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END,
              error = ?
        WHERE id = ?`,
    )
    .bind(maxAttempts, error.slice(0, 300), id)
    .run();
}

export type RecipientCounts = {
  total: number;
  pending: number;
  sending: number;
  sent: number;
  suppressed: number;
  failed: number;
};

export async function recipientCounts(db: D1Database, broadcastId: number): Promise<RecipientCounts> {
  const zero = { total: 0, pending: 0, sending: 0, sent: 0, suppressed: 0, failed: 0 };
  try {
    const r = await db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) AS sending,
           SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
           SUM(CASE WHEN status = 'suppressed' THEN 1 ELSE 0 END) AS suppressed,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM broadcast_recipients WHERE broadcast_id = ?`,
      )
      .bind(broadcastId)
      .first<RecipientCounts>();
    return r ?? zero;
  } catch {
    return zero;
  }
}

export async function pendingCount(db: D1Database, broadcastId: number): Promise<number> {
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'pending'`)
    .bind(broadcastId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

// ── Engagement (reads the shared email_sends table) ────────────────────────────

export type BroadcastStats = {
  sent: number; // tracked sends (rows in email_sends for this type)
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  openRate: number;
  clickRate: number;
};

const ZERO_STATS: BroadcastStats = {
  sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, openRate: 0, clickRate: 0,
};

export async function broadcastStats(db: D1Database, emailType: string): Promise<BroadcastStats> {
  try {
    const r = await db
      .prepare(
        `SELECT COUNT(*) AS sent,
                SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
                SUM(CASE WHEN first_opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
                SUM(CASE WHEN first_clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
                SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) AS bounced,
                SUM(CASE WHEN complained_at IS NOT NULL THEN 1 ELSE 0 END) AS complained
           FROM email_sends WHERE email_type = ?`,
      )
      .bind(emailType)
      .first<Omit<BroadcastStats, 'openRate' | 'clickRate'>>();
    if (!r) return ZERO_STATS;
    const denom = r.delivered || r.sent || 0;
    return {
      ...r,
      openRate: denom ? r.opened / denom : 0,
      clickRate: denom ? r.clicked / denom : 0,
    };
  } catch {
    return ZERO_STATS;
  }
}
