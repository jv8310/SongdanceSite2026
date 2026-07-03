// D1 rejects any statement carrying more than 100 bound parameters ("too many
// SQL variables"). Several admin/reporting queries filter by an id list —
// `WHERE x IN (?, ?, …)` — whose length grows with the data, so once there are
// >100 ids the whole query throws. That is exactly what took out /admin/orders
// (every workshop registration id bound at once) and silently killed the daily
// SD-REPORT digest (a busy day's payment ids bound at once).
//
// This helper runs such a query in ≤`chunkSize` batches and concatenates the
// rows, keeping every statement under the cap — the same discipline the
// broadcasts importer already uses for its bulk upserts.
//
// Correctness note for group-by-id callers (e.g. "latest payment per
// registration"): chunk by the SAME id you group on, so every row for a given
// id lands in one batch and per-id ordering/last-write-wins is preserved.

// Stay comfortably under D1's 100-parameter cap (matches broadcasts/db.ts,
// which chunks its email upserts at 90/statement).
const DEFAULT_CHUNK = 90;

export async function selectByIdsChunked<T>(
  db: D1Database,
  ids: ReadonlyArray<number | string>,
  buildSql: (placeholders: string) => string,
  opts: { chunkSize?: number; tailBinds?: unknown[] } = {},
): Promise<T[]> {
  if (ids.length === 0) return [];
  // Leave room for any fixed trailing binds so slice + tail stays ≤100.
  const tail = opts.tailBinds ?? [];
  const size = Math.max(1, Math.min(opts.chunkSize ?? DEFAULT_CHUNK, 100 - tail.length));
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const slice = ids.slice(i, i + size);
    const placeholders = slice.map(() => '?').join(',');
    const res = await db
      .prepare(buildSql(placeholders))
      .bind(...slice, ...tail)
      .all<T>();
    out.push(...(res.results ?? []));
  }
  return out;
}
