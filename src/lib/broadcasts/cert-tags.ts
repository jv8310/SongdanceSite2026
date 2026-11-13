// The certification course's `cert:` tags on the contact list, so a broadcast
// can be aimed at "everyone whose window to apply closes on 31 December" like
// any other tag (November 2026: the window-deadline email went out from here
// instead of Drip).
//
// Drip has had these people tagged since October (`cert_ends_2026`,
// `cert_ends_later`, `cert_no_certification`, cert-access-drip.ts), but the
// contact list never had: those tags live in Drip only. The list is computed
// here from the same two sources the Drip push reads, so the two always agree:
//   • listCertAccess        — everyone with a certification order on the site
//                             (the path, the cert alone, the workshop ledger),
//                             their end with any certification-window extension;
//   • listLegacyCertAccess  — the Drip-only holders (prod_SVH_9m, prod_CEEE-25)
//                             with no order here.
//
// The tags:
//   cert:holder            holds the certification course
//   cert:ends-2026         it ends (extension included) on or before 31 Dec 2026
//   cert:ends-later        it ends after that
//   cert:no-certification  the CEEE 2025 cohort: the course without the right to
//                          apply (lifted by an extension, as in Drip)
//
// Who is certified already is the member app's to say: exclude `app:certified`
// (app-tags.ts) beside these.
//
// The sync follows app-tags.ts: everything under `cert:` is this module's — a
// tag it no longer computes comes off, nothing outside the prefix is touched; a
// holder who is not a contact yet becomes one (source 'cert'); one D1 batch,
// diffed first, so steady state writes nothing. An empty answer changes nothing
// (more likely a broken read than a course with no students).
//
// When: on the hourly cron, and just before a broadcast that names a `cert:`
// tag is launched or its segments are refreshed (segment-refresh.ts).

import { listCertAccess } from '../courses/cert-access';
import { listLegacyCertAccess } from '../courses/cert-access-legacy';
import { logEventSafe } from '../registrations/db';

export const CERT_TAG_PREFIX = 'cert:';
export const CERT_HOLDER_TAG = 'cert:holder';
export const CERT_ENDS_2026_TAG = 'cert:ends-2026';
export const CERT_ENDS_LATER_TAG = 'cert:ends-later';
export const CERT_NO_CERTIFICATION_CONTACT_TAG = 'cert:no-certification';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHUNK = 400;

export function usesCertTags(tags: Iterable<string>): boolean {
  for (const t of tags) if (t.startsWith(CERT_TAG_PREFIX)) return true;
  return false;
}

export type CertTagEntry = {
  email: string;
  name: string | null;
  group: 'end-2026' | 'later';
  noCertification: boolean;
};

type Clean = { email: string; name: string | null; tags: Set<string> };

/** Pure: who carries which `cert:` tag. Bad and stand-in addresses are dropped. */
export function certTagsFor(entries: CertTagEntry[]): Map<string, Clean> {
  const out = new Map<string, Clean>();
  for (const e of entries) {
    const email = String(e.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254 || email.endsWith('.invalid')) continue;
    if (out.has(email)) continue; // the site list wins: legacy rows exclude site emails anyway
    const tags = new Set([CERT_HOLDER_TAG, e.group === 'end-2026' ? CERT_ENDS_2026_TAG : CERT_ENDS_LATER_TAG]);
    if (e.noCertification) tags.add(CERT_NO_CERTIFICATION_CONTACT_TAG);
    out.set(email, { email, name: String(e.name ?? '').trim().slice(0, 200) || null, tags });
  }
  return out;
}

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

const pairKey = (email: string, tag: string) => `${email}\u0000${tag}`;

export type CertTagSyncResult =
  | { ok: true; holders: number; added: number; removed: number; created: number }
  | { ok: false; error: string };

/** Compute the certification course's `cert:` tags and write them onto the contact list. */
export async function syncCertTags(db: D1Database): Promise<CertTagSyncResult> {
  try {
    const site = await listCertAccess(db);
    const legacy = await listLegacyCertAccess(db, new Set(site.map((a) => a.email.trim().toLowerCase())));
    const want = certTagsFor([
      ...site.map((a) => ({ email: a.email, name: a.name, group: a.group, noCertification: false })),
      ...legacy.map((a) => ({ email: a.email, name: a.name, group: a.group, noCertification: a.noCertification })),
    ]);
    if (want.size === 0) return { ok: false, error: 'No certification holders were found; the cert: tags were left as they were.' };

    const current =
      (await db.prepare(`SELECT email, tag FROM contact_tags WHERE tag LIKE 'cert:%'`).all<{ email: string; tag: string }>()).results ?? [];
    const have = new Set(current.map((r) => pairKey(r.email, r.tag)));
    const wanted = new Set<string>();
    const added: Array<[string, string]> = [];
    for (const m of want.values()) {
      for (const t of m.tags) {
        const k = pairKey(m.email, t);
        wanted.add(k);
        if (!have.has(k)) added.push([m.email, t]);
      }
    }
    const removed: Array<[string, string]> = current
      .filter((r) => !wanted.has(pairKey(r.email, r.tag)))
      .map((r) => [r.email, r.tag]);

    // Only the holders who carry a new tag can be missing from the list (a
    // contact already tagged exists), so the insert is limited to them.
    const newEmails = new Set(added.map(([e]) => e));
    const toUpsert = [...want.values()].filter((m) => newEmails.has(m.email));
    let existing = 0;
    for (const part of chunks(toUpsert.map((m) => m.email))) {
      const r = await db
        .prepare(`SELECT COUNT(*) AS n FROM contacts WHERE email IN (SELECT value FROM json_each(?1))`)
        .bind(JSON.stringify(part))
        .first<{ n: number }>();
      existing += r?.n ?? 0;
    }

    const statements: D1PreparedStatement[] = [];
    for (const part of chunks(toUpsert)) {
      statements.push(
        db
          .prepare(
            `INSERT INTO contacts (email, name, source)
               SELECT json_extract(value, '$.e'), json_extract(value, '$.n'), 'cert'
                 FROM json_each(?1) WHERE 1
             ON CONFLICT(email) DO UPDATE SET
               name = COALESCE(contacts.name, excluded.name),
               updated_at = datetime('now')
             WHERE contacts.name IS NULL AND excluded.name IS NOT NULL`,
          )
          .bind(JSON.stringify(part.map((m) => ({ e: m.email, n: m.name })))),
      );
    }
    for (const part of chunks(removed)) {
      statements.push(
        db
          .prepare(
            `DELETE FROM contact_tags
              WHERE tag LIKE 'cert:%'
                AND (email, tag) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1))`,
          )
          .bind(JSON.stringify(part)),
      );
    }
    for (const part of chunks(added)) {
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO contact_tags (email, tag)
               SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1)`,
          )
          .bind(JSON.stringify(part)),
      );
    }
    const touched = [...new Set([...added, ...removed].map(([e]) => e))];
    for (const part of chunks(touched)) {
      statements.push(
        db
          .prepare(
            `UPDATE contacts
                SET tags = (SELECT group_concat(tag, ', ') FROM (SELECT tag FROM contact_tags t WHERE t.email = contacts.email ORDER BY tag)),
                    updated_at = datetime('now')
              WHERE email IN (SELECT value FROM json_each(?1))`,
          )
          .bind(JSON.stringify(part)),
      );
    }
    if (statements.length) await db.batch(statements);

    const result = {
      ok: true as const,
      holders: want.size,
      added: added.length,
      removed: removed.length,
      created: toUpsert.length - existing,
    };
    if (result.added || result.removed || result.created) {
      await logEventSafe(db, {
        registration_id: null,
        kind: 'broadcast.cert_tags.synced',
        source: 'system',
        payload: { holders: result.holders, added: result.added, removed: result.removed, created: result.created },
      });
    }
    return result;
  } catch (err) {
    console.error('[broadcasts/cert-tags] sync failed', err);
    return { ok: false, error: String((err as Error)?.message ?? err).slice(0, 200) };
  }
}
