// Mirror the Drip tags applied at purchase time onto the local People/contacts
// list (the `contacts` + `contact_tags` tables that back /admin/contacts,
// /admin/people, and broadcast audience targeting).
//
// Why: the order paid-handlers push tags to Drip (upsertSubscriber), but the
// local contacts list was a one-off CSV import from a Drip export — frozen at
// import time. So a tag applied to a buyer since then (e.g. a workshop's
// source_tag) lived only in Drip: it never showed up in the compose page's tag
// list, couldn't be targeted in a broadcast, and didn't appear on the People
// detail page. This closes that gap — every order's tags are written locally too.
//
// Every mirrored contact also gets a single `in-drip` marker tag (IN_DRIP_TAG).
// Because ONLY purchases flow through here, it's a buyer-only flag a pure
// CSV-imported row can never carry — and every purchase also pushes the buyer to
// Drip. So `in-drip` == "this contact is also in Drip", the exact tag a broadcast
// puts in its exclude list to avoid double-sending to people Drip already mails.
// Historical buyers are tagged by migration 0069; new ones are tagged here.
//
// Idempotent by construction, so it's safe to call on every (re-)fulfilment and
// from the historical backfill: the contact upsert only fills missing fields
// (COALESCE), and tags are INSERT OR IGNORE on the (email, tag) primary key.
// Tags are lowercased to collate with the imported ones (contact_tags is
// lowercased throughout — see importContacts / splitTags in broadcasts/db.ts).

import { logEventSafe } from '../registrations/db';
import { normalizeTimezone } from '../broadcasts/db';

// The buyer-only marker every purchase mirror stamps onto its contact — see the
// module header. Deliberately a value Drip would never emit itself, so it can't
// collide with a tag carried in from the Drip CSV export. Exclude it in a
// broadcast to skip contacts who are also in Drip.
export const IN_DRIP_TAG = 'in-drip';

export type MirrorContactInput = {
  email: string;
  name?: string | null;
  timezone?: string | null;
  country?: string | null;
  tags: string[];
  // Provenance for a newly-created contact (kept, never overwritten on an
  // existing row): 'workshop-order' | 'course-order' | 'retreat-order' | …
  source?: string;
};

// Trim, lowercase, dedupe, drop blanks — the same per-tag rule the CSV import
// uses (splitTags), so an order tag lands as the same string an import would.
export function normalizeContactTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const t of tags) {
    const tag = (t ?? '').trim().toLowerCase();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

// The raw write — THROWS on failure so the backfill can retry a row. One D1
// batch (a transaction): upsert the contact, add the tags additively, then
// resync the denormalized display `tags` column from the normalized table.
export async function writeContactTags(
  db: D1Database,
  input: MirrorContactInput,
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!email) return;
  // Always stamp the buyer-only `in-drip` marker alongside the order's own tags,
  // so every purchase-mirrored contact is flagged as also-in-Drip (and therefore
  // excludable from broadcasts). normalizeContactTags de-dupes, so re-runs and a
  // contact that already carries it are no-ops.
  const tags = normalizeContactTags([...input.tags, IN_DRIP_TAG]);
  const name = (input.name ?? '').trim() || null;
  const timezone = normalizeTimezone(input.timezone);
  const country = (input.country ?? '').trim() || null;
  const source = input.source ?? 'order';

  const statements: D1PreparedStatement[] = [
    // Create the contact if new; on an existing row only FILL missing fields —
    // never clobber a good imported name/tz/country, and keep the original
    // source. Mirrors importContacts' COALESCE directions.
    db
      .prepare(
        `INSERT INTO contacts (email, name, timezone, country, source)
           VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           name = COALESCE(contacts.name, excluded.name),
           timezone = COALESCE(excluded.timezone, contacts.timezone),
           country = COALESCE(excluded.country, contacts.country),
           updated_at = datetime('now')`,
      )
      .bind(email, name, timezone, country, source),
  ];

  if (tags.length) {
    // Additive: INSERT OR IGNORE on the (email, tag) PK, so re-runs and tags the
    // contact already carries are no-ops. Tag count per order is tiny (≤ ~10),
    // well under D1's 100-bound-param cap.
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO contact_tags (email, tag) VALUES ${tags
            .map(() => '(?, ?)')
            .join(', ')}`,
        )
        .bind(...tags.flatMap((t) => [email, t])),
    );
    // Keep the display column in sync with the normalized tags (source of truth).
    statements.push(
      db
        .prepare(
          `UPDATE contacts
              SET tags = (
                    SELECT group_concat(tag, ', ')
                      FROM (SELECT tag FROM contact_tags WHERE email = ?1 ORDER BY tag)
                  ),
                  updated_at = datetime('now')
            WHERE email = ?1`,
        )
        .bind(email),
    );
  }

  await db.batch(statements);
}

// Re-runnable, trim-correct sync of the buyer-only `in-drip` marker (see
// IN_DRIP_TAG above). The live mirror stamps it on every new purchase, but its
// HISTORY came from a one-time migration (0069) that (a) only tagged emails
// already present in `contacts` at that instant and (b) matched with plain
// `lower(email)` — no TRIM. So a contact whose row appeared later (e.g. a
// re-import), or whose registration email carries stray whitespace, silently
// never got the tag even though they went through a Drip-pushing purchase. That
// gap is exactly why a `workshop-passed-nonbuyer` could lack `in-drip` and slip a
// broadcast's exclude. This recomputes the marker from the same three purchase
// sources the migration used — retreats, courses, workshops — but LOWER(TRIM())-
// matched and safe to re-run before every send, so it converges. Idempotent
// (INSERT OR IGNORE on the (email, tag) PK); returns how many rows it newly
// tagged this run (0 in steady state). Local-only: never touches Drip.
export async function syncInDripTag(db: D1Database): Promise<number> {
  const sources = [
    // Retreats that ever paid (paid_at set, incl. later-refunded — they did
    // transact and were pushed to Drip). Mirrors migration 0069.
    `INSERT OR IGNORE INTO contact_tags (email, tag)
       SELECT DISTINCT LOWER(TRIM(r.email)), ?
         FROM registrations r
        WHERE r.paid_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM contacts c WHERE c.email = LOWER(TRIM(r.email)))`,
    // Course registrations that ever collected money (paid_at set, not a
    // pending/expired session). Includes free comps — they were pushed too.
    `INSERT OR IGNORE INTO contact_tags (email, tag)
       SELECT DISTINCT LOWER(TRIM(cr.email)), ?
         FROM course_registrations cr
        WHERE cr.paid_at IS NOT NULL
          AND cr.status NOT IN ('pending', 'expired')
          AND EXISTS (SELECT 1 FROM contacts c WHERE c.email = LOWER(TRIM(cr.email)))`,
    // Workshop registrations that completed (paid or coupon-free) — the paths
    // that run the paid side-effects and therefore push to Drip.
    `INSERT OR IGNORE INTO contact_tags (email, tag)
       SELECT DISTINCT LOWER(TRIM(wr.email)), ?
         FROM workshop_registrations wr
        WHERE wr.payment_status IN ('paid', 'coupon')
          AND EXISTS (SELECT 1 FROM contacts c WHERE c.email = LOWER(TRIM(wr.email)))`,
  ];
  let added = 0;
  for (const sql of sources) {
    const res = await db.prepare(sql).bind(IN_DRIP_TAG).run();
    added += Number(res.meta?.changes ?? 0);
  }

  // Resync the denormalized display `tags` column for rows that just gained the
  // marker (targeting reads contact_tags, so this is cosmetic parity with the
  // People page). Self-limiting: the instr() guard skips rows whose display
  // string already carries `in-drip`, so a steady-state re-run writes nothing.
  await db
    .prepare(
      `UPDATE contacts
          SET tags = (
                SELECT group_concat(tag, ', ')
                  FROM (SELECT tag FROM contact_tags WHERE email = contacts.email ORDER BY tag)
              ),
              updated_at = datetime('now')
        WHERE email IN (SELECT email FROM contact_tags WHERE tag = ?1)
          AND instr(',' || REPLACE(COALESCE(tags, ''), ' ', '') || ',', ',' || ?1 || ',') = 0`,
    )
    .bind(IN_DRIP_TAG)
    .run();

  return added;
}

// Best-effort wrapper for the live paid-handlers: never throws, so a mirror
// hiccup can't block fulfilment or the Drip push. A failure is logged to the
// `events` audit table (kind `contact.mirror.error`).
export async function mirrorTagsToContact(
  env: { DB: D1Database },
  input: MirrorContactInput,
): Promise<void> {
  try {
    await writeContactTags(env.DB, input);
  } catch (err) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'contact.mirror.error',
      source: 'system',
      payload: { email: input.email, error: String(err) },
    });
  }
}
