// The free rebook — a missed seat moves once.
//
// A no-show can put their paid seat on another upcoming live date, free, from
// their countdown page (/api/workshops/reregister). That creates a NEW
// coupon-grade registration and leaves the original row exactly as it was, so
// the only record that the original seat has been used is the
// `workshop.rebooked` event, keyed `workshop-rebook-<from>-to-<to>`. Until
// September 2026 nothing read it: the original page kept offering the list, and
// every press minted another free seat (`upsertRegistration` only dedupes per
// session + email). Every "has this seat already moved?" is asked here.
//
// No column, on purpose: the event already exists for every rebook ever made,
// so the rule covers them all the moment it deploys, with no migration and no
// backfill.

export const REBOOK_EVENT_KIND = 'workshop.rebooked';

function rebookEventPrefix(fromRegistrationId: number): string {
  return `workshop-rebook-${fromRegistrationId}-to-`;
}

export function rebookEventId(fromRegistrationId: number, toRegistrationId: number): string {
  return `${rebookEventPrefix(fromRegistrationId)}${toRegistrationId}`;
}

export type Rebook = {
  // The seat it moved to. Null only if the key can't be read back, which still
  // counts as moved.
  toRegistrationId: number | null;
  createdAt: string;
};

// The move out of this registration, if it has made one. Asked as a range on
// external_id rather than a LIKE: the unique index on events.external_id serves
// a range, while SQLite's case-insensitive LIKE can't use a BINARY index and
// would scan the whole audit log. The trailing "-to-" keeps registration 12
// from matching 120. A seat that moved more than once (possible before this
// rule) answers with its latest move — where they most recently chose to go.
export async function findRebook(db: D1Database, fromRegistrationId: number): Promise<Rebook | null> {
  const prefix = rebookEventPrefix(fromRegistrationId);
  // The first string past every key that starts with `prefix` ("-" → ".").
  const upper = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
  const rows = await db
    .prepare(
      `SELECT id, external_id, created_at FROM events
        WHERE kind = ? AND external_id >= ? AND external_id < ?`,
    )
    .bind(REBOOK_EVENT_KIND, prefix, upper)
    .all<{ id: number; external_id: string; created_at: string }>();
  const list = rows.results ?? [];
  if (list.length === 0) return null;
  const latest = list.reduce((a, b) => (b.id > a.id ? b : a));
  const to = Number(latest.external_id.slice(prefix.length));
  return {
    toRegistrationId: Number.isInteger(to) && to > 0 ? to : null,
    createdAt: latest.created_at,
  };
}
