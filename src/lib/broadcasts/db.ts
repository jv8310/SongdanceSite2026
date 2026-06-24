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
  audience_include_tags: string | null;
  audience_exclude_tags: string | null;
  audience_field: string | null;
  audience_field_value: string | null;
  status: 'draft' | 'sending' | 'paused' | 'done';
  paused_reason: string | null;
  // The circuit breaker evaluates complaint/bounce rates only over sends made
  // since this instant (set on every launch/resume), so a cleaned queue gets a
  // fresh sample instead of staying tripped by a sour historical rate.
  breaker_baseline_at: string | null;
  // When the pending queue was last scrubbed (dead domains or by tag).
  last_cleaned_at: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type ContactRow = {
  email: string;
  name?: string | null;
  timezone?: string | null;
  country?: string | null;
  tags?: string | null; // comma-joined (display)
  custom?: Record<string, unknown> | null;
  unsubscribed?: boolean; // status === 'unsubscribed' → store but suppress
  // Email-verifier verdict (e.g. MillionVerifier): 'bad' → suppress as an
  // invalid address; 'risky' → tag 'risky' so it can be targeted/excluded;
  // 'good'/null → no action. Never wipes existing tags.
  verdict?: 'bad' | 'risky' | 'good' | null;
};

// Audience targeting criteria, shared by the count + snapshot queries.
export type AudienceCriteria = {
  includeTags?: string | null; // comma-separated; contact must carry ANY
  excludeTags?: string | null; // comma-separated; contact must carry NONE
  field?: string | null; // custom-field key
  fieldValue?: string | null; // exact match
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

// Split a raw tag string into a normalized, de-duped list (trimmed, lowercased).
export function splitTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const t of String(raw).split(',')) {
    const tag = t.trim().toLowerCase();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

function customJson(custom: Record<string, unknown> | null | undefined): string | null {
  if (!custom) return null;
  const keys = Object.keys(custom);
  if (keys.length === 0) return null;
  try {
    return JSON.stringify(custom);
  } catch {
    return null;
  }
}

// ── Contacts ────────────────────────────────────────────────────────────────

// Upsert a batch of contacts plus their normalized tags, suppress anyone
// imported with status 'unsubscribed' (stored, but never emailed), and act on an
// email-verifier verdict (bad → suppress; risky → tag). Everything runs in one
// D1 batch (a transaction). D1 caps bound parameters at 100 per statement, so
// every multi-row statement is chunked well under that. Returns how many rows
// were seen, suppressed (unsub + invalid), and tagged risky.
export async function importContacts(
  db: D1Database,
  rows: ContactRow[],
  source = 'import',
): Promise<{ processed: number; suppressed: number; risky: number }> {
  if (rows.length === 0) return { processed: 0, suppressed: 0, risky: 0 };
  const ROWS_PER_STMT = 12; // 12 × 7 binds = 84  (≤ 100)
  const TAGS_PER_STMT = 45; // 45 × 2 binds = 90
  const EMAILS_PER_STMT = 90; // DELETE … IN / suppression insert
  const statements: D1PreparedStatement[] = [];

  const allEmails: string[] = [];
  const taggedEmails: string[] = []; // only rows that carried a tags value
  const tagPairs: Array<[string, string]> = [];
  const unsubEmails: string[] = [];
  const invalidEmails: string[] = []; // verifier verdict 'bad'
  const riskyEmails: string[] = []; // verifier verdict 'risky'

  // contacts upserts (≤12 rows each)
  for (let i = 0; i < rows.length; i += ROWS_PER_STMT) {
    const slice = rows.slice(i, i + ROWS_PER_STMT);
    const binds: (string | null)[] = [];
    for (const r of slice) {
      const email = r.email.trim().toLowerCase();
      const tags = splitTags(r.tags);
      allEmails.push(email);
      if (tags.length) taggedEmails.push(email);
      for (const tag of tags) tagPairs.push([email, tag]);
      if (r.unsubscribed) unsubEmails.push(email);
      if (r.verdict === 'bad') invalidEmails.push(email);
      else if (r.verdict === 'risky') riskyEmails.push(email);
      binds.push(
        email,
        (r.name ?? null) || null,
        normalizeTimezone(r.timezone),
        (r.country ?? null) || null,
        tags.length ? tags.join(', ') : null,
        customJson(r.custom),
        source,
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO contacts (email, name, timezone, country, tags, custom, source)
             VALUES ${slice.map(() => '(?,?,?,?,?,?,?)').join(',')}
           ON CONFLICT(email) DO UPDATE SET
             -- Never overwrite an existing name on re-import (a verifier file
             -- echoes back first-name-only / lowercased names); only fill it in
             -- when the contact has none yet.
             name = COALESCE(contacts.name, excluded.name),
             timezone = COALESCE(excluded.timezone, contacts.timezone),
             country = COALESCE(excluded.country, contacts.country),
             tags = COALESCE(excluded.tags, contacts.tags),
             custom = COALESCE(excluded.custom, contacts.custom),
             updated_at = datetime('now')`,
        )
        .bind(...binds),
    );
  }

  // Replace tags ONLY for rows that actually carried a tags value — clear
  // (≤90/stmt) then re-insert (≤45 pairs). A row with no tags column (e.g. a
  // verifier re-import) must NOT wipe a contact's existing targeting tags.
  for (let i = 0; i < taggedEmails.length; i += EMAILS_PER_STMT) {
    const slice = taggedEmails.slice(i, i + EMAILS_PER_STMT);
    statements.push(
      db.prepare(`DELETE FROM contact_tags WHERE email IN (${slice.map(() => '?').join(',')})`).bind(...slice),
    );
  }
  for (let i = 0; i < tagPairs.length; i += TAGS_PER_STMT) {
    const slice = tagPairs.slice(i, i + TAGS_PER_STMT);
    statements.push(
      db
        .prepare(`INSERT OR IGNORE INTO contact_tags (email, tag) VALUES ${slice.map(() => '(?,?)').join(',')}`)
        .bind(...slice.flat()),
    );
  }

  // Verifier 'risky' → add the 'risky' tag additively (no delete), so existing
  // tags survive and the address can be targeted or excluded per broadcast.
  for (let i = 0; i < riskyEmails.length; i += TAGS_PER_STMT) {
    const slice = riskyEmails.slice(i, i + TAGS_PER_STMT);
    statements.push(
      db
        .prepare(`INSERT OR IGNORE INTO contact_tags (email, tag) VALUES ${slice.map(() => "(?, 'risky')").join(',')}`)
        .bind(...slice),
    );
  }

  // Stored-but-never-emailed: add unsubscribed addresses to the suppression list.
  for (let i = 0; i < unsubEmails.length; i += EMAILS_PER_STMT) {
    const slice = unsubEmails.slice(i, i + EMAILS_PER_STMT);
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO email_suppressions (email, reason, source)
             VALUES ${slice.map(() => "(?, 'unsubscribe', 'import')").join(',')}`,
        )
        .bind(...slice),
    );
  }

  // Verifier 'bad' (invalid / disposable mailbox) → suppress as invalid_address.
  for (let i = 0; i < invalidEmails.length; i += EMAILS_PER_STMT) {
    const slice = invalidEmails.slice(i, i + EMAILS_PER_STMT);
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO email_suppressions (email, reason, source)
             VALUES ${slice.map(() => "(?, 'invalid_address', 'verifier')").join(',')}`,
        )
        .bind(...slice),
    );
  }

  // Auto-suppress any imported address at a domain already known to be dead
  // (domain_status.ok = 0), so cleaning the list once keeps a bad domain out of
  // the sendable pool even across later re-imports. Runs after the upsert above
  // in the same (sequential, transactional) batch, so it sees the new rows.
  for (let i = 0; i < allEmails.length; i += EMAILS_PER_STMT) {
    const slice = allEmails.slice(i, i + EMAILS_PER_STMT);
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO email_suppressions (email, reason, source)
             SELECT email, 'invalid_domain', 'import'
               FROM contacts
              WHERE email IN (${slice.map(() => '?').join(',')})
                AND substr(email, instr(email, '@') + 1) IN (SELECT domain FROM domain_status WHERE ok = 0)`,
        )
        .bind(...slice),
    );
  }

  await db.batch(statements);
  return {
    processed: rows.length,
    suppressed: unsubEmails.length + invalidEmails.length,
    risky: riskyEmails.length,
  };
}

// Distinct tags with how many contacts carry each — populates the compose
// page's clickable tag list. Defensive: empty when the table isn't there yet.
export async function availableTags(
  db: D1Database,
  limit = 200,
): Promise<Array<{ tag: string; n: number }>> {
  try {
    const r = await db
      .prepare(`SELECT tag, COUNT(*) AS n FROM contact_tags GROUP BY tag ORDER BY n DESC, tag LIMIT ?`)
      .bind(limit)
      .all<{ tag: string; n: number }>();
    return r.results ?? [];
  } catch {
    return [];
  }
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
      .prepare('SELECT email, name, timezone, country, tags FROM contacts ORDER BY id DESC LIMIT ?')
      .bind(limit)
      .all<ContactRow>();
    return r.results ?? [];
  } catch {
    return [];
  }
}

// ── Audience targeting ──────────────────────────────────────────────────────

// Build the WHERE additions (and their binds) for a set of audience criteria,
// against a `contacts c` row. Always excludes the suppression list. Tag matching
// goes through the normalized contact_tags table; the field filter uses
// json_extract on the preserved `custom` blob.
function audienceWhere(criteria: AudienceCriteria): { sql: string; binds: string[] } {
  const clauses = [`NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email = c.email)`];
  const binds: string[] = [];

  const include = splitTags(criteria.includeTags);
  if (include.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM contact_tags t WHERE t.email = c.email AND t.tag IN (${include
        .map(() => '?')
        .join(',')}))`,
    );
    binds.push(...include);
  }

  const exclude = splitTags(criteria.excludeTags);
  if (exclude.length) {
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM contact_tags t WHERE t.email = c.email AND t.tag IN (${exclude
        .map(() => '?')
        .join(',')}))`,
    );
    binds.push(...exclude);
  }

  const field = (criteria.field ?? '').trim();
  const value = (criteria.fieldValue ?? '').trim();
  if (field) {
    // json_extract path: $."Field Name" (quoted so spaces/odd chars are fine).
    clauses.push(`json_extract(c.custom, '$."' || ? || '"') = ?`);
    binds.push(field, value);
  }

  return { sql: clauses.join(' AND '), binds };
}

function criteriaOf(b: Broadcast | AudienceCriteria): AudienceCriteria {
  if ('audience_include_tags' in b) {
    return {
      includeTags: b.audience_include_tags,
      excludeTags: b.audience_exclude_tags,
      field: b.audience_field,
      fieldValue: b.audience_field_value,
    };
  }
  return b;
}

// How many contacts match these criteria right now (minus suppressions).
export async function countAudience(db: D1Database, criteria: AudienceCriteria): Promise<number> {
  try {
    const { sql, binds } = audienceWhere(criteria);
    const r = await db
      .prepare(`SELECT COUNT(*) AS n FROM contacts c WHERE ${sql}`)
      .bind(...binds)
      .first<{ n: number }>();
    return r?.n ?? 0;
  } catch {
    return 0;
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
  audience_include_tags?: string | null;
  audience_exclude_tags?: string | null;
  audience_field?: string | null;
  audience_field_value?: string | null;
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
          cta_label, cta_href, window_start_hour, window_end_hour,
          audience_include_tags, audience_exclude_tags, audience_field, audience_field_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      b.audience_include_tags ?? null,
      b.audience_exclude_tags ?? null,
      b.audience_field ?? null,
      b.audience_field_value ?? null,
    )
    .run();
  return Number(r.meta?.last_row_id ?? 0);
}

// Edits are allowed until a broadcast is done. Editing a sending/paused
// broadcast is safe: the cron re-renders each batch from this row, so content
// changes flow to recipients not yet sent (already-sent ones keep the version
// they got). Audience criteria only matter at (re)launch, not for the queue
// already snapshotted.
export async function updateBroadcast(db: D1Database, id: number, b: BroadcastInput): Promise<void> {
  const w = windowHours(b);
  await db
    .prepare(
      `UPDATE broadcasts
          SET name = ?, subject = ?, preheader = ?, heading = ?, body = ?,
              format = ?, body_text = ?, hero_image = ?, cta_label = ?, cta_href = ?,
              window_start_hour = ?, window_end_hour = ?,
              audience_include_tags = ?, audience_exclude_tags = ?,
              audience_field = ?, audience_field_value = ?
        WHERE id = ? AND status != 'done'`,
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
      b.audience_include_tags ?? null,
      b.audience_exclude_tags ?? null,
      b.audience_field ?? null,
      b.audience_field_value ?? null,
      id,
    )
    .run();
}

// ── Launch / queue ────────────────────────────────────────────────────────────

// Snapshot the contacts matching the broadcast's audience into the queue.
// INSERT … SELECT does the whole (filtered) list in one statement; INSERT OR
// IGNORE + the UNIQUE(broadcast_id,email) makes a re-launch a safe top-up.
// Returns the number of new rows added this call.
export async function snapshotRecipients(db: D1Database, broadcastId: number): Promise<number> {
  const b = await getBroadcast(db, broadcastId);
  const { sql, binds } = audienceWhere(b ? criteriaOf(b) : {});
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO broadcast_recipients (broadcast_id, email, name, timezone, status)
         SELECT ?, c.email, c.name, c.timezone, 'pending'
           FROM contacts c
          WHERE ${sql}`,
    )
    .bind(broadcastId, ...binds)
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
              paused_reason = NULL,
              breaker_baseline_at = datetime('now')
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

// Resume a paused broadcast. Resetting breaker_baseline_at is the crux of the
// fix: the cron's circuit breaker only weighs sends made *after* this moment, so
// a queue you've just cleaned gets a fresh sample to prove itself rather than
// being re-tripped instantly by the unchanged historical bounce/complaint rate.
export async function resumeBroadcast(db: D1Database, id: number): Promise<void> {
  await db
    .prepare(
      `UPDATE broadcasts
          SET status = 'sending', paused_reason = NULL, breaker_baseline_at = datetime('now')
        WHERE id = ? AND status = 'paused'`,
    )
    .bind(id)
    .run();
}

// Record that the pending queue was just scrubbed (dead domains or by tag), so
// the page can show when it last happened. Doesn't gate on status — cleaning is
// allowed while sending or paused.
export async function markBroadcastCleaned(db: D1Database, id: number): Promise<void> {
  await db
    .prepare(`UPDATE broadcasts SET last_cleaned_at = datetime('now') WHERE id = ?`)
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

// The distinct timezones still pending for a broadcast (one row per zone, incl.
// null). The cron works out which of these are inside the send window right now
// and only then fetches recipients in those zones — so a big block of one
// timezone sitting at the head of the queue (out of window) can't starve the
// rest. Distinct zones are few (dozens), so this is cheap.
export async function pendingTimezones(db: D1Database, broadcastId: number): Promise<(string | null)[]> {
  const r = await db
    .prepare(`SELECT DISTINCT timezone FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'pending'`)
    .bind(broadcastId)
    .all<{ timezone: string | null }>();
  return (r.results ?? []).map((row) => row.timezone);
}

// Pending recipients whose timezone is in the given in-window set (plus the
// null/default zone when it's in-window). Ordered by id within that set.
export async function fetchDrainCandidatesForTz(
  db: D1Database,
  broadcastId: number,
  tzs: string[],
  includeNull: boolean,
  limit: number,
): Promise<DrainCandidate[]> {
  let cond: string;
  const binds: (string | number)[] = [broadcastId];
  if (tzs.length && includeNull) {
    cond = `(timezone IN (${tzs.map(() => '?').join(',')}) OR timezone IS NULL)`;
    binds.push(...tzs);
  } else if (tzs.length) {
    cond = `timezone IN (${tzs.map(() => '?').join(',')})`;
    binds.push(...tzs);
  } else {
    cond = `timezone IS NULL`;
  }
  binds.push(limit);
  const r = await db
    .prepare(
      `SELECT id, email, name, timezone FROM broadcast_recipients
        WHERE broadcast_id = ? AND status = 'pending' AND ${cond}
        ORDER BY id LIMIT ?`,
    )
    .bind(...binds)
    .all<DrainCandidate>();
  return r.results ?? [];
}

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

// ── List cleaning (dead-domain removal) ────────────────────────────────────────
// Dead-domain cleaning is a LIST-level operation: it scans every contact's
// domain (the domain of an email is substr(email, instr(email,'@')+1)), caches
// each domain's deliverability once in domain_status, and adds addresses at dead
// domains to the global email_suppressions list — so a domain cleaned once is
// gone from this broadcast, every future broadcast, and lifecycle marketing.
// (Per-broadcast tag removal still lives below in suppressPendingByTags.)

// Distinct contact domains not yet resolved (a batch of work for the cleaner).
export async function distinctUncheckedContactDomains(db: D1Database, limit: number): Promise<string[]> {
  const r = await db
    .prepare(
      `SELECT DISTINCT substr(email, instr(email, '@') + 1) AS domain
         FROM contacts
        WHERE substr(email, instr(email, '@') + 1) NOT IN (SELECT domain FROM domain_status)
        LIMIT ?`,
    )
    .bind(limit)
    .all<{ domain: string }>();
  return (r.results ?? []).map((row) => row.domain);
}

export async function uncheckedContactDomainCount(db: D1Database): Promise<number> {
  const r = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT DISTINCT substr(email, instr(email, '@') + 1) AS domain
           FROM contacts
          WHERE substr(email, instr(email, '@') + 1) NOT IN (SELECT domain FROM domain_status))`,
    )
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function cacheDomainStatus(db: D1Database, domain: string, ok: boolean): Promise<void> {
  await db
    .prepare(`INSERT OR REPLACE INTO domain_status (domain, ok, checked_at) VALUES (?, ?, datetime('now'))`)
    .bind(domain.toLowerCase(), ok ? 1 : 0)
    .run();
}

// Add every contact at a known-dead domain to the global suppression list.
// Idempotent (INSERT OR IGNORE) — returns how many addresses were newly
// suppressed this call. Non-destructive: contact rows stay, reason marks them.
export async function suppressContactsAtDeadDomains(db: D1Database): Promise<number> {
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO email_suppressions (email, reason, source)
         SELECT email, 'invalid_domain', 'list_clean'
           FROM contacts
          WHERE substr(email, instr(email, '@') + 1) IN (SELECT domain FROM domain_status WHERE ok = 0)`,
    )
    .run();
  return r.meta?.changes ?? 0;
}

// Mirror the suppression into any still-pending broadcast queues (across all
// broadcasts) so their counts drop immediately and the breaker's sample isn't
// padded with sends that will never go out. The 'invalid domain' marker feeds
// the per-broadcast "removed at dead domains" stat. Returns how many.
export async function suppressPendingRecipientsAtDeadDomains(db: D1Database): Promise<number> {
  const r = await db
    .prepare(
      `UPDATE broadcast_recipients SET status = 'suppressed', error = 'invalid domain'
        WHERE status = 'pending'
          AND substr(email, instr(email, '@') + 1) IN (SELECT domain FROM domain_status WHERE ok = 0)`,
    )
    .run();
  return r.meta?.changes ?? 0;
}

// How many addresses are suppressed specifically as dead domains — a persistent
// "list health" figure for the contacts page.
export async function countDeadDomainSuppressions(db: D1Database): Promise<number> {
  try {
    const r = await db
      .prepare(`SELECT COUNT(*) AS n FROM email_suppressions WHERE reason = 'invalid_domain'`)
      .first<{ n: number }>();
    return r?.n ?? 0;
  } catch {
    return 0;
  }
}

// Suppress every still-pending recipient that carries any of the given tags —
// used to scrub already-queued contacts (e.g. ones Drip tagged undeliverable)
// from a launched broadcast, since audience filters otherwise only apply at
// launch. Returns how many were removed.
export async function suppressPendingByTags(
  db: D1Database,
  broadcastId: number,
  tagsRaw: string,
): Promise<number> {
  const tags = splitTags(tagsRaw);
  if (tags.length === 0) return 0;
  const r = await db
    .prepare(
      `UPDATE broadcast_recipients SET status = 'suppressed', error = 'excluded by tag'
        WHERE broadcast_id = ? AND status = 'pending'
          AND EXISTS (
            SELECT 1 FROM contact_tags t
             WHERE t.email = broadcast_recipients.email
               AND t.tag IN (${tags.map(() => '?').join(',')}))`,
    )
    .bind(broadcastId, ...tags)
    .run();
  return r.meta?.changes ?? 0;
}

// How many recipients this broadcast's cleaning has removed, split by reason.
// Derived straight from the queue's `error` marker (set by suppressPendingBy*),
// so it stays accurate without a separate counter. Distinct from send-time
// unsubscribe skips, which carry no error.
export type CleaningCounts = { deadDomain: number; byTag: number };

export async function cleaningCounts(db: D1Database, broadcastId: number): Promise<CleaningCounts> {
  const zero = { deadDomain: 0, byTag: 0 };
  try {
    const r = await db
      .prepare(
        `SELECT
           SUM(CASE WHEN error = 'invalid domain' THEN 1 ELSE 0 END) AS deadDomain,
           SUM(CASE WHEN error = 'excluded by tag' THEN 1 ELSE 0 END) AS byTag
         FROM broadcast_recipients
        WHERE broadcast_id = ? AND status = 'suppressed'`,
      )
      .bind(broadcastId)
      .first<CleaningCounts>();
    return r ? { deadDomain: r.deadDomain ?? 0, byTag: r.byTag ?? 0 } : zero;
  } catch {
    return zero;
  }
}

// All still-pending recipients (for CSV export to an external validator).
export async function pendingRecipientsForExport(
  db: D1Database,
  broadcastId: number,
): Promise<Array<{ email: string; name: string | null }>> {
  const r = await db
    .prepare(
      `SELECT email, name FROM broadcast_recipients
        WHERE broadcast_id = ? AND status = 'pending' ORDER BY id`,
    )
    .bind(broadcastId)
    .all<{ email: string; name: string | null }>();
  return r.results ?? [];
}

// ── Bounce check: list-level export + result reimport ──────────────────────────
// The dead-domain cleaner catches whole dead domains; it can't catch dead
// mailboxes at a live provider (a closed Gmail still resolves Gmail's MX). For
// those: export the sendable list, run it through a mailbox-level bounce-checker
// (NeverBounce, ZeroBounce, Bouncer, …), then reimport the undeliverable
// addresses here. They go onto the global email_suppressions list — same as a
// dead domain — so they're skipped on this broadcast, every future broadcast,
// and lifecycle marketing, and never bounce again.

// Every contact a broadcast could currently reach (not already suppressed), for
// CSV export to an external validator. Keyset-paginated by id so the full list
// (tens of thousands) streams out without tripping a single-query row cap.
export async function sendableContactsForExport(
  db: D1Database,
): Promise<Array<{ email: string; name: string | null }>> {
  const out: Array<{ email: string; name: string | null }> = [];
  const PAGE = 10000;
  let afterId = 0;
  for (;;) {
    const r = await db
      .prepare(
        `SELECT c.id AS id, c.email AS email, c.name AS name FROM contacts c
          WHERE c.id > ?
            AND NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email = c.email)
          ORDER BY c.id LIMIT ?`,
      )
      .bind(afterId, PAGE)
      .all<{ id: number; email: string; name: string | null }>();
    const rows = r.results ?? [];
    for (const row of rows) out.push({ email: row.email, name: row.name });
    if (rows.length < PAGE) break;
    afterId = rows[rows.length - 1].id;
  }
  return out;
}

// Add a batch of addresses to the global suppression list (bounce-checker
// results) and scrub them from any live broadcast queue — mirroring the
// dead-domain sweep. Idempotent (INSERT OR IGNORE). D1 caps bound params at
// 100/statement, so the suppress upsert chunks at 30 rows (3 params each) and
// the queue scrub at 90 emails. Returns newly-suppressed + queue rows scrubbed.
export async function suppressEmailsBatch(
  db: D1Database,
  emails: string[],
  reason: string,
  source: string,
): Promise<{ suppressed: number; scrubbed: number }> {
  const clean = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (clean.length === 0) return { suppressed: 0, scrubbed: 0 };

  let suppressed = 0;
  const SUPPRESS_PER_STMT = 30;
  for (let i = 0; i < clean.length; i += SUPPRESS_PER_STMT) {
    const slice = clean.slice(i, i + SUPPRESS_PER_STMT);
    const r = await db
      .prepare(
        `INSERT OR IGNORE INTO email_suppressions (email, reason, source)
           VALUES ${slice.map(() => '(?, ?, ?)').join(',')}`,
      )
      .bind(...slice.flatMap((e) => [e, reason, source]))
      .run();
    suppressed += r.meta?.changes ?? 0;
  }

  let scrubbed = 0;
  const QUEUE_PER_STMT = 90;
  for (let i = 0; i < clean.length; i += QUEUE_PER_STMT) {
    const slice = clean.slice(i, i + QUEUE_PER_STMT);
    const r = await db
      .prepare(
        `UPDATE broadcast_recipients SET status = 'suppressed', error = 'bounced'
          WHERE status = 'pending' AND email IN (${slice.map(() => '?').join(',')})`,
      )
      .bind(...slice)
      .run();
    scrubbed += r.meta?.changes ?? 0;
  }
  return { suppressed, scrubbed };
}

// Addresses suppressed because they bounce / complain — bounce-checker results
// plus Resend hard bounces and spam complaints folded in by the event webhook.
// A list-health figure for the contacts page (parallels dead-domain count).
export async function countBounceSuppressions(db: D1Database): Promise<number> {
  try {
    const r = await db
      .prepare(`SELECT COUNT(*) AS n FROM email_suppressions WHERE reason IN ('bounced', 'complaint')`)
      .first<{ n: number }>();
    return r?.n ?? 0;
  } catch {
    return 0;
  }
}

// ── Engagement (reads the shared email_sends table) ────────────────────────────

export type BroadcastStats = {
  sent: number; // tracked sends (rows in email_sends for this type)
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number; // all bounces (soft + hard) — the display figure
  hardBounced: number; // permanent bounces only — what the circuit breaker weighs
  complained: number;
  openRate: number;
  clickRate: number;
};

const ZERO_STATS: BroadcastStats = {
  sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, hardBounced: 0, complained: 0, openRate: 0, clickRate: 0,
};

// `since` (an ISO/SQLite datetime) windows the stats to sends made at or after
// that moment — the cron's circuit breaker passes the broadcast's
// breaker_baseline_at so it judges only post-resume sends. Omit it (the page +
// /admin/emails/stats do) for all-time engagement numbers.
export async function broadcastStats(
  db: D1Database,
  emailType: string,
  since?: string | null,
): Promise<BroadcastStats> {
  try {
    const r = await db
      .prepare(
        `SELECT COUNT(*) AS sent,
                SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
                SUM(CASE WHEN first_opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
                SUM(CASE WHEN first_clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
                SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) AS bounced,
                SUM(CASE WHEN hard_bounced_at IS NOT NULL THEN 1 ELSE 0 END) AS hardBounced,
                SUM(CASE WHEN complained_at IS NOT NULL THEN 1 ELSE 0 END) AS complained
           FROM email_sends WHERE email_type = ?${since ? ' AND sent_at >= ?' : ''}`,
      )
      .bind(...(since ? [emailType, since] : [emailType]))
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
