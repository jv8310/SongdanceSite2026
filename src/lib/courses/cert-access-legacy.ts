// Certification holders the site has no order for, read from Drip:
//
//   prod_SVH_9m   — bought the certification before this site took payments.
//   prod_CEEE-25  — the CEEE 2025 cohort, who got the 2026 certification course
//                   free with their programme. They do NOT have the right to
//                   apply for certification, so they also carry
//                   `cert_no_certification` in Drip.
//
// Both end on 31 December 2026 (CERT_ACCESS_FLOOR) — there is no purchase date
// to run 9 months from. Anyone with a paid order on the site is left to that
// order (cert-access.ts) whatever Drip says: a real purchase is the better
// record, and it can only end later. The Drip roster is copied into
// `cert_access_legacy` (migration 0088) so /admin/courses/cert-access can list
// them without a Drip call per page view; it refreshes twice a day from the
// hourly cron and on the admin page's button.

import { listSubscribersByTag } from '../registrations/drip';
import { dripConfig } from '../orders/drip-order';
import { CERT_ACCESS_FLOOR, certGroupFor, type CertAccessGroup } from './cert-access';

export const LEGACY_CERT_TAG = 'prod_SVH_9m';
export const CEEE_2025_TAG = 'prod_CEEE-25';
const REFRESH_HOURS = 12;

export type LegacyCertAccess = {
  email: string;
  name: string | null;
  hasCertTag: boolean;
  hasCeeeTag: boolean;
  // CEEE 2025 free access: the course, not the right to certify.
  noCertification: boolean;
  endsOn: string;
  group: CertAccessGroup;
};

type Row = {
  email: string;
  name: string | null;
  has_cert_tag: number;
  has_ceee_tag: number;
};

// Everyone on the copied roster who has no order on the site. Empty (never a
// throw) before migration 0088 is applied — a preview shares the live D1.
export async function listLegacyCertAccess(
  db: D1Database,
  siteEmails: Set<string>,
): Promise<LegacyCertAccess[]> {
  let rows: Row[] = [];
  try {
    const r = await db
      .prepare(`SELECT email, name, has_cert_tag, has_ceee_tag FROM cert_access_legacy ORDER BY email`)
      .all<Row>();
    rows = r.results ?? [];
  } catch {
    return [];
  }
  return rows
    .filter((r) => !siteEmails.has(r.email))
    .map((r) => ({
      email: r.email,
      name: r.name,
      hasCertTag: !!r.has_cert_tag,
      hasCeeeTag: !!r.has_ceee_tag,
      noCertification: !!r.has_ceee_tag,
      endsOn: CERT_ACCESS_FLOOR,
      group: certGroupFor(CERT_ACCESS_FLOOR),
    }));
}

export async function legacyRosterRefreshedAt(db: D1Database): Promise<string | null> {
  try {
    const r = await db
      .prepare(`SELECT MAX(last_seen_at) AS at FROM cert_access_legacy`)
      .first<{ at: string | null }>();
    return r?.at ?? null;
  } catch {
    return null;
  }
}

type RefreshEnv = { DB: D1Database; DRIP_API_TOKEN?: string; DRIP_ACCOUNT_ID?: string };

// Copy the two tags' subscribers out of Drip. Additive: someone whose tag is
// later removed in Drip keeps their row (and their end date).
export async function refreshLegacyRoster(
  env: RefreshEnv,
  opts: { force?: boolean } = {},
): Promise<{ skipped?: boolean; cert: number; ceee: number }> {
  const cfg = dripConfig(env);
  if (!cfg) return { skipped: true, cert: 0, ceee: 0 };

  if (!opts.force) {
    const at = await legacyRosterRefreshedAt(env.DB);
    if (at && Date.now() - Date.parse(`${at.replace(' ', 'T')}Z`) < REFRESH_HOURS * 3_600_000) {
      return { skipped: true, cert: 0, ceee: 0 };
    }
  }

  const [cert, ceee] = await Promise.all([
    listSubscribersByTag(cfg, LEGACY_CERT_TAG),
    listSubscribersByTag(cfg, CEEE_2025_TAG),
  ]);

  const people = new Map<string, { name: string | null; cert: boolean; ceee: boolean }>();
  const add = (s: { email: string; first_name?: string; last_name?: string }, which: 'cert' | 'ceee') => {
    const email = s.email.trim().toLowerCase();
    if (!email) return;
    const name = [s.first_name, s.last_name].filter(Boolean).join(' ').trim() || null;
    const p = people.get(email) ?? { name, cert: false, ceee: false };
    p.name = p.name ?? name;
    p[which] = true;
    people.set(email, p);
  };
  cert.forEach((s) => add(s, 'cert'));
  ceee.forEach((s) => add(s, 'ceee'));

  const stmts = [...people].map(([email, p]) =>
    env.DB
      .prepare(
        `INSERT INTO cert_access_legacy (email, name, has_cert_tag, has_ceee_tag)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           name = COALESCE(cert_access_legacy.name, excluded.name),
           has_cert_tag = MAX(cert_access_legacy.has_cert_tag, excluded.has_cert_tag),
           has_ceee_tag = MAX(cert_access_legacy.has_ceee_tag, excluded.has_ceee_tag),
           last_seen_at = datetime('now')`,
      )
      .bind(email, p.name, p.cert ? 1 : 0, p.ceee ? 1 : 0),
  );
  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }
  return { cert: cert.length, ceee: ceee.length };
}
