// Saved segments (migration 0100, broadcast_segments): a rule set kept by name
// from the segment builder ("Save as segment…") to load into another broadcast.
// Loading copies the rules into that broadcast — a later edit of the saved
// segment never changes a broadcast that already took it.
//
// Preview safety: before 0100 is applied, segmentsReady is false, the reads
// answer empty and the writes are refused by the endpoint with a note.

import { parseSegmentRules, type SegmentRules } from './segment-rules';

let ready = false;
export async function segmentsReady(db: D1Database): Promise<boolean> {
  if (ready) return true;
  try {
    await db.prepare('SELECT 1 FROM broadcast_segments LIMIT 0').run();
    return (ready = true);
  } catch {
    return false;
  }
}

export type SavedSegmentRow = { id: number; name: string; updated_at: string };

export async function listSavedSegments(db: D1Database): Promise<SavedSegmentRow[]> {
  try {
    const r = await db
      .prepare('SELECT id, name, updated_at FROM broadcast_segments ORDER BY name COLLATE NOCASE')
      .all<SavedSegmentRow>();
    return r.results ?? [];
  } catch {
    return [];
  }
}

// One saved segment with its rules, or null (missing, unreadable, or 0100 absent).
export async function getSavedSegment(
  db: D1Database,
  id: number,
): Promise<{ id: number; name: string; rules: SegmentRules } | null> {
  try {
    const row = await db
      .prepare('SELECT id, name, rules FROM broadcast_segments WHERE id = ?')
      .bind(id)
      .first<{ id: number; name: string; rules: string }>();
    if (!row) return null;
    const parsed = parseSegmentRules(row.rules);
    if (!parsed.ok || !parsed.rules) return null;
    return { id: row.id, name: row.name, rules: parsed.rules };
  } catch {
    return null;
  }
}

// Save under a name; the same name again replaces that segment's rules.
// Returns its id. Throws on a database error.
export async function saveSegment(db: D1Database, name: string, rules: SegmentRules, by: string): Promise<number> {
  await db
    .prepare(
      `INSERT INTO broadcast_segments (name, rules, created_by)
         VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET rules = excluded.rules, updated_at = datetime('now')`,
    )
    .bind(name, JSON.stringify(rules), by)
    .run();
  const row = await db.prepare('SELECT id FROM broadcast_segments WHERE name = ?').bind(name).first<{ id: number }>();
  return row?.id ?? 0;
}

export async function deleteSavedSegment(db: D1Database, id: number): Promise<boolean> {
  const r = await db.prepare('DELETE FROM broadcast_segments WHERE id = ?').bind(id).run();
  return (r.meta?.changes ?? 0) > 0;
}
