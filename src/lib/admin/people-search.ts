// Quick people lookup for the admin ⌘K palette (AdminTopBar → /api/admin/people-search).
// listPeople aggregates every table into tens of thousands of rows — far too
// heavy to run per keystroke — so this asks SQL directly: every address the
// site knows (retreat, course and workshop orders, the contacts list) whose
// email or name contains the typed text, one row per address, best match first.

export type PersonHit = {
  email: string;
  name: string | null;
  orders: number; // secured orders (paid / comped) across all three sources
  lastSeen: string | null;
};

function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const fullName = (first: string, last: string) =>
  `NULLIF(TRIM(COALESCE(${first}, '') || ' ' || COALESCE(${last}, '')), '')`;

export async function searchPeople(db: D1Database, query: string, limit = 12): Promise<PersonHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const term = likeTerm(q);
  const prefix = `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const L = (col: string) => `LOWER(${col}) LIKE ?1 ESCAPE '\\'`;

  const sql = `
    SELECT email, MAX(name) AS name, SUM(secured) AS orders, MAX(seen) AS seen
    FROM (
      SELECT LOWER(TRIM(r.email)) AS email,
             COALESCE(${fullName('r.first_name', 'r.last_name')}, NULLIF(TRIM(r.name), '')) AS name,
             CASE WHEN r.status = 'paid' THEN 1 ELSE 0 END AS secured,
             r.created_at AS seen
        FROM registrations r
       WHERE ${L('r.email')} OR ${L(fullName('r.first_name', 'r.last_name'))} OR ${L('r.name')}
      UNION ALL
      SELECT LOWER(TRIM(c.email)), ${fullName('c.first_name', 'c.last_name')},
             CASE WHEN c.status = 'paid' THEN 1 ELSE 0 END, c.created_at
        FROM course_registrations c
       WHERE ${L('c.email')} OR ${L(fullName('c.first_name', 'c.last_name'))}
      UNION ALL
      SELECT LOWER(TRIM(w.email)), NULLIF(TRIM(w.name), ''),
             CASE WHEN w.payment_status IN ('paid', 'coupon') THEN 1 ELSE 0 END, w.created_at
        FROM workshop_registrations w
       WHERE ${L('w.email')} OR ${L('w.name')}
      UNION ALL
      SELECT LOWER(TRIM(k.email)), NULLIF(TRIM(k.name), ''), 0, k.updated_at
        FROM contacts k
       WHERE ${L('k.email')} OR ${L('k.name')}
    )
    WHERE email IS NOT NULL AND email <> ''
    GROUP BY email
    ORDER BY (email LIKE ?2 ESCAPE '\\' OR LOWER(COALESCE(name, '')) LIKE ?2 ESCAPE '\\') DESC,
             orders DESC, seen DESC
    LIMIT ?3`;

  const res = await db.prepare(sql).bind(term, prefix, limit).all<{
    email: string;
    name: string | null;
    orders: number | null;
    seen: string | null;
  }>();
  return (res.results ?? []).map((r) => ({
    email: r.email,
    name: r.name,
    orders: Number(r.orders ?? 0),
    lastSeen: r.seen,
  }));
}
