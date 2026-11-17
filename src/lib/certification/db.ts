// Certification submissions (migration 0100): one row per form sent on
// /certification/apply, per row imported from the old Google Sheet, and per
// one added by hand. Reviewed on /admin/certification. Everything else about a
// certification (the day, the certificate, the feedback the student reads)
// lives in the member app and is reached through APP_ADMIN.

export type CertStatus = 'submitted' | 'response' | 'certified' | 'archived';
export const CERT_STATUSES: CertStatus[] = ['submitted', 'response', 'certified', 'archived'];

export const CERT_STATUS_LABEL: Record<CertStatus, string> = {
  submitted: 'waiting for review',
  response: 'response sent',
  certified: 'certified',
  archived: 'set aside',
};

// The site's pill colours: pending = waiting, low = answered, paid = certified, cancelled = set aside.
export const CERT_STATUS_PILL: Record<CertStatus, string> = {
  submitted: 'pending',
  response: 'low',
  certified: 'paid',
  archived: 'cancelled',
};

export type CertSource = 'site' | 'google-form' | 'admin';

export type CertApplication = {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  classes_confirmed: number;
  video_url: string | null;
  video_uploaded: number;
  course_feedback: string | null;
  testimonial: string | null;
  comments: string | null;
  source: CertSource;
  import_key: string | null;
  submitted_at: string;
  status: CertStatus;
  response: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  admin_note: string | null;
  received_email_at: string | null;
  outcome_email_at: string | null;
  app_sync_pending: number;
  app_sync_error: string | null;
  created_at: string;
  updated_at: string;
};

export type NewCertApplication = {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  classes_confirmed?: boolean;
  video_url?: string | null;
  video_uploaded?: boolean;
  course_feedback?: string | null;
  testimonial?: string | null;
  comments?: string | null;
  source: CertSource;
  import_key?: string | null;
  submitted_at?: string;
  status?: CertStatus;
  admin_note?: string | null;
};

const clean = (v: string | null | undefined) => (v ?? '').trim() || null;

export const certName = (a: Pick<CertApplication, 'first_name' | 'last_name' | 'email'>) =>
  [a.first_name, a.last_name].filter(Boolean).join(' ').trim() || a.email;

/** True on a database that has the table (a preview runs before its migration). */
export async function certTableReady(db: D1Database): Promise<boolean> {
  try {
    await db.prepare(`SELECT 1 FROM cert_applications LIMIT 1`).first();
    return true;
  } catch {
    return false;
  }
}

/** Inserts a row; null when its import_key is already there. */
export async function insertCertApplication(db: D1Database, a: NewCertApplication): Promise<CertApplication | null> {
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO cert_applications
         (email, first_name, last_name, classes_confirmed, video_url, video_uploaded, course_feedback, testimonial, comments,
          source, import_key, submitted_at, status, admin_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      a.email.trim().toLowerCase(),
      clean(a.first_name),
      clean(a.last_name),
      a.classes_confirmed ? 1 : 0,
      clean(a.video_url),
      a.video_uploaded ? 1 : 0,
      clean(a.course_feedback),
      clean(a.testimonial),
      clean(a.comments),
      a.source,
      a.import_key ?? null,
      a.submitted_at ?? new Date().toISOString(),
      a.status ?? 'submitted',
      clean(a.admin_note),
    )
    .run();
  if (!(r.meta?.changes ?? 0)) return null;
  return getCertApplication(db, Number(r.meta.last_row_id));
}

export async function getCertApplication(db: D1Database, id: number): Promise<CertApplication | null> {
  return db.prepare(`SELECT * FROM cert_applications WHERE id = ?`).bind(id).first<CertApplication>();
}

/** One person's submissions, newest first. */
export async function listCertApplicationsForEmail(db: D1Database, email: string): Promise<CertApplication[]> {
  const r = await db
    .prepare(`SELECT * FROM cert_applications WHERE email = ? ORDER BY submitted_at DESC, id DESC`)
    .bind(email.trim().toLowerCase())
    .all<CertApplication>();
  return r.results;
}

/** The one the member app should reflect: their newest that is not set aside. */
export async function latestOpenCertApplication(db: D1Database, email: string): Promise<CertApplication | null> {
  return db
    .prepare(`SELECT * FROM cert_applications WHERE email = ? AND status != 'archived' ORDER BY submitted_at DESC, id DESC LIMIT 1`)
    .bind(email.trim().toLowerCase())
    .first<CertApplication>();
}

export type CertListFilter = { status?: CertStatus | 'all'; q?: string };

/** Waiting ones oldest first (the order they are reviewed in); everything else newest first. */
export async function listCertApplications(db: D1Database, filter: CertListFilter = {}): Promise<CertApplication[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filter.status && filter.status !== 'all') {
    where.push(`status = ?`);
    binds.push(filter.status);
  }
  const q = (filter.q ?? '').trim().toLowerCase();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    where.push(`(email LIKE ? ESCAPE '\\' OR lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) LIKE ? ESCAPE '\\' OR lower(coalesce(admin_note,'')) LIKE ? ESCAPE '\\')`);
    binds.push(like, like, like);
  }
  const order = filter.status === 'submitted' ? `submitted_at ASC, id ASC` : `submitted_at DESC, id DESC`;
  const r = await db
    .prepare(`SELECT * FROM cert_applications ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT 1000`)
    .bind(...binds)
    .all<CertApplication>();
  return r.results;
}

export async function countCertApplications(db: D1Database): Promise<Record<CertStatus, number> & { all: number }> {
  const out = { submitted: 0, response: 0, certified: 0, archived: 0, all: 0 };
  const r = await db.prepare(`SELECT status, COUNT(*) AS n FROM cert_applications GROUP BY status`).all<{ status: CertStatus; n: number }>();
  for (const row of r.results) {
    if (row.status in out) out[row.status] = Number(row.n);
    out.all += Number(row.n);
  }
  return out;
}

export async function setCertStatus(
  db: D1Database,
  id: number,
  v: { status: CertStatus; response?: string | null; by: string; reviewed?: boolean },
): Promise<void> {
  await db
    .prepare(
      `UPDATE cert_applications
          SET status = ?1,
              response = CASE WHEN ?2 = 1 THEN ?3 ELSE response END,
              reviewed_at = CASE WHEN ?4 = 1 THEN ?5 ELSE reviewed_at END,
              reviewed_by = CASE WHEN ?4 = 1 THEN ?6 ELSE reviewed_by END,
              updated_at = datetime('now')
        WHERE id = ?7`,
    )
    .bind(v.status, v.response !== undefined ? 1 : 0, v.response ?? null, v.reviewed === false ? 0 : 1, new Date().toISOString(), v.by, id)
    .run();
}

export async function setCertAdminNote(db: D1Database, id: number, note: string | null): Promise<void> {
  await db.prepare(`UPDATE cert_applications SET admin_note = ?, updated_at = datetime('now') WHERE id = ?`).bind(clean(note), id).run();
}

export async function updateCertAnswers(
  db: D1Database,
  id: number,
  v: { email: string; first_name: string | null; last_name: string | null; video_url: string | null },
): Promise<void> {
  await db
    .prepare(`UPDATE cert_applications SET email = ?, first_name = ?, last_name = ?, video_url = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(v.email.trim().toLowerCase(), clean(v.first_name), clean(v.last_name), clean(v.video_url), id)
    .run();
}

export async function stampCertEmail(db: D1Database, id: number, which: 'received' | 'outcome'): Promise<void> {
  const col = which === 'received' ? 'received_email_at' : 'outcome_email_at';
  await db.prepare(`UPDATE cert_applications SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`).bind(new Date().toISOString(), id).run();
}

export async function setCertAppSync(db: D1Database, email: string, error: string | null): Promise<void> {
  await db
    .prepare(`UPDATE cert_applications SET app_sync_pending = ?, app_sync_error = ? WHERE email = ?`)
    .bind(error ? 1 : 0, error, email.trim().toLowerCase())
    .run();
}

export async function emailsWithPendingAppSync(db: D1Database, limit = 50): Promise<string[]> {
  const r = await db.prepare(`SELECT DISTINCT email FROM cert_applications WHERE app_sync_pending = 1 LIMIT ?`).bind(limit).all<{ email: string }>();
  return r.results.map((x) => x.email);
}

export async function deleteCertApplication(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM cert_applications WHERE id = ?`).bind(id).run();
}

/** The links in what was typed as "the video": a line may hold two, or words around one. */
export function videoLinks(raw: string | null): string[] {
  return [...(raw ?? '').matchAll(/https?:\/\/[^\s<>"']+/g)].map((m) => m[0].replace(/[),.;]+$/, ''));
}

/** A YouTube link as its embed address, or null for anything else. */
export function youtubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else if (/^\/(shorts|embed|live)\//.test(u.pathname)) id = u.pathname.split('/')[2] ?? null;
    }
    return id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  } catch {
    return null;
  }
}
