// Dropped-mail log — a best-effort record of sends that were ATTEMPTED but did
// NOT go out (rate-limited by Resend, the isolate torn down mid-flight, a batch
// error) and were released for a later retry. Without this, a silently-missed
// workshop reminder or SD-REPORT digest is invisible unless you cross-reference
// Resend's own dashboard by hand — which is exactly how the 9 Jul reminder gap
// went unnoticed until after the session.
//
// Stored as `events` rows (kind = 'email.dropped') so there's no new table and
// no migration; external_id is left null (many drops are allowed) and the JSON
// payload carries the detail. Read back by /admin/emails/failures via
// recentEmailDrops. Writing is wrapped and swallowed — visibility must never
// break the mail path it's reporting on.

export type EmailDrop = {
  // Which pipeline dropped it: 'reminders' | 'report' | 'broadcast' | 'briefing'.
  stream: string;
  // The email/notification type(s) affected, e.g. 'reminder_20m' or
  // 'report-daily-2026-07-09'. Comma-joined when a batch mixed several.
  emailType?: string;
  // How many recipients were in the dropped batch (1 for a single send).
  count?: number;
  // A short reason — the error text, truncated.
  detail?: string;
  // The workshop involved, when the drop is tied to one.
  workshopId?: number | null;
};

// Keep the stored detail short so the events log stays legible.
function trunc(s: string | undefined, n = 300): string | undefined {
  if (!s) return s;
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export async function logEmailDrop(db: D1Database, drop: EmailDrop): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO events (registration_id, kind, source, external_id, payload_json)
         VALUES (NULL, 'email.dropped', 'system', NULL, ?)`,
      )
      .bind(JSON.stringify({ ...drop, detail: trunc(drop.detail) }))
      .run();
  } catch {
    // best-effort — a logging hiccup must never affect the send/retry path.
  }
}

export type EmailDropRow = { id: number; at: string; drop: EmailDrop };

// Most-recent drops first, for the admin failures view. Falls back to an empty
// list on any read error (the log is a diagnostic, never load-bearing).
export async function recentEmailDrops(db: D1Database, limit = 200): Promise<EmailDropRow[]> {
  try {
    const r = await db
      .prepare(
        `SELECT id, created_at, payload_json FROM events
          WHERE kind = 'email.dropped'
          ORDER BY id DESC
          LIMIT ?`,
      )
      .bind(limit)
      .all<{ id: number; created_at: string; payload_json: string }>();
    return (r.results ?? []).map((row) => {
      let drop: EmailDrop = { stream: 'unknown' };
      try {
        drop = JSON.parse(row.payload_json) as EmailDrop;
      } catch {
        // leave the fallback
      }
      return { id: row.id, at: row.created_at, drop };
    });
  } catch {
    return [];
  }
}
