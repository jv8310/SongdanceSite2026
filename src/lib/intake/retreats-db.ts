// DB-backed catalogue of intake retreats.
//
// The hardcoded EVENTS map in events.ts remains the source of truth for
// existing retreats (they have hand-written flavour text that grounds
// the Claude assessor). Rows in this table extend or override that map:
// any retreat added here becomes a valid `?event=<slug>` for /intake
// and shows up in the admin filters.

import type { EventDefinition } from './events';
import type { Locale } from './copy';

export interface RetreatRow {
  slug: string;
  name: string;
  flavour: string | null;
  active: number;
  invite_locale: Locale;
  created_at: string;
  updated_at: string;
  // Migration 0085. Read with SELECT * so this module keeps working against a
  // database the migration hasn't reached yet (a preview deploy shares the
  // live D1) — the fields are simply absent there.
  product_id?: number | null;
  sheet_url?: string | null;
  sheet_secret?: string | null;
  sheet_synced_at?: string | null;
  sheet_error?: string | null;
}

export async function listRetreats(db: D1Database): Promise<RetreatRow[]> {
  const q = await db
    .prepare(
      `SELECT *
         FROM intake_retreats
         ORDER BY active DESC, name`,
    )
    .all<RetreatRow>();
  return q.results ?? [];
}

export async function getRetreat(
  db: D1Database,
  slug: string,
): Promise<RetreatRow | null> {
  const row = await db
    .prepare(
      `SELECT *
         FROM intake_retreats
         WHERE slug = ?`,
    )
    .bind(slug)
    .first<RetreatRow>();
  return row ?? null;
}

export function retreatRowToEvent(row: RetreatRow): EventDefinition {
  return {
    code: row.slug,
    label: { nl: row.name, en: row.name },
    flavour:
      row.flavour && row.flavour.trim()
        ? row.flavour.trim()
        : 'Songdance retreat. Beoordeel met algemene SVH-zorgvuldigheid.',
  };
}
