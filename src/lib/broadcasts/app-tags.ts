// The member app's `app:` tags on the contact list, so a broadcast can be aimed
// at "everyone with an app account" (`app:member`) or a course's students in
// the app (`app:course:svh-12week`) like any other tag.
//
// The contact list (contacts + contact_tags) was a Drip export plus the buyers
// the purchase mirror adds; nothing on it said who has an account in the app,
// and the people imported from Mighty who never bought here were not on it at
// all. The app knows. So the site asks it, through the APP_ADMIN binding
// (the app's SiteAdmin.broadcastMembers, songdance-app
// apps/api/src/lib/broadcast-tags.ts, where every tag is defined), and writes
// the answer here. This site never reads an app_ table; the app never writes a
// site table.
//
// What the sync does:
//   • Every tag under `app:` is the app's. A tag the app lists is added, a tag
//     it no longer lists is taken off; nothing outside the prefix is touched.
//     The prefix is checked: the app can never write any other tag.
//   • A member who is not on the list yet becomes a contact (source 'app'), so
//     `app:member` really is everyone. An existing contact only has a missing
//     name or timezone filled in, never one replaced.
//   • One D1 batch (a transaction), so a launch never snapshots half a sync.
//     Steady state writes nothing: the change is worked out first.
//   • An answer with nobody in it changes nothing (an app that answers empty is
//     more likely broken than empty).
//
// When: on the hourly cron, and just before a broadcast that names an `app:`
// tag is launched or its segments are refreshed (segment-refresh.ts). A failed
// sync leaves the tags as they were and says why (the last result is kept in
// workshop_config so the admin pages can show it).

import { askApp, type AppBroadcastMember } from '../admin/app-access';
import { getConfig, setConfig } from '../workshops/db';
import { logEventSafe } from '../registrations/db';
import { normalizeTimezone } from './db';

export const APP_TAG_PREFIX = 'app:';
export const APP_MEMBER_TAG = 'app:member';
const APP_TAG_RE = /^app:[a-z0-9][a-z0-9:._-]{0,80}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Rows per json_each statement: a bound string stays well under D1's 2 MB.
const CHUNK = 400;
const SYNCED_KEY = 'broadcast_app_tags_synced';
const ERROR_KEY = 'broadcast_app_tags_error';

export function isAppTag(tag: string): boolean {
  return tag.startsWith(APP_TAG_PREFIX);
}

export function usesAppTags(tags: Iterable<string>): boolean {
  for (const t of tags) if (isAppTag(t)) return true;
  return false;
}

export type AppTagSyncOk = {
  ok: true;
  at: string;
  members: number;
  added: number;
  removed: number;
  created: number;
};
export type AppTagSyncResult = AppTagSyncOk | { ok: false; at: string; error: string; message: string };

type Clean = { email: string; name: string | null; timezone: string | null; tags: Set<string> };

/** Pure: the app's answer as rows this site will write (bad addresses and non-`app:` tags dropped). */
export function cleanAppMembers(raw: unknown): Map<string, Clean> {
  const out = new Map<string, Clean>();
  if (!Array.isArray(raw)) return out;
  for (const r of raw as Array<Partial<AppBroadcastMember>>) {
    const email = String(r?.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254 || email.endsWith('.invalid')) continue;
    const tags = (Array.isArray(r?.tags) ? r.tags : [])
      .map((t) => String(t ?? '').trim().toLowerCase())
      .filter((t) => APP_TAG_RE.test(t));
    if (!tags.length) continue;
    const seen = out.get(email);
    if (seen) {
      for (const t of tags) seen.tags.add(t);
      continue;
    }
    const name = String(r?.name ?? '').trim().slice(0, 200) || null;
    out.set(email, { email, name, timezone: normalizeTimezone(r?.timezone ?? null), tags: new Set(tags) });
  }
  return out;
}

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

const pairKey = (email: string, tag: string) => `${email}\u0000${tag}`;

/** Ask the app who has an account and write its `app:` tags onto the contact list. */
export async function syncAppTags(env: { DB: D1Database; APP_ADMIN?: unknown }): Promise<AppTagSyncResult> {
  const at = new Date().toISOString();
  const fail = async (error: string, message: string): Promise<AppTagSyncResult> => {
    const r = { ok: false as const, at, error, message };
    try {
      await setConfig(env.DB, ERROR_KEY, JSON.stringify(r));
    } catch {
      /* the marker is a convenience */
    }
    return r;
  };

  const answer = await askApp(env, async (app) =>
    app.broadcastMembers
      ? app.broadcastMembers()
      : { ok: false as const, error: 'not-deployed', message: 'The member app has not been deployed with broadcast tags yet.' },
  );
  if (!answer.ok) return fail(answer.error, answer.message);

  const want = cleanAppMembers(answer.data.members);
  if (want.size === 0) return fail('empty', 'The app answered with nobody; the app: tags were left as they were.');

  try {
    const db = env.DB;
    const current = (
      await db.prepare(`SELECT email, tag FROM contact_tags WHERE tag LIKE 'app:%'`).all<{ email: string; tag: string }>()
    ).results ?? [];
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
    const removed: Array<[string, string]> = current.filter((r) => !wanted.has(pairKey(r.email, r.tag))).map((r) => [r.email, r.tag]);

    // Which members are not contacts yet (for the count; the upsert creates them).
    const members = [...want.values()];
    let existing = 0;
    for (const part of chunks(members.map((m) => m.email))) {
      const r = await db
        .prepare(`SELECT COUNT(*) AS n FROM contacts WHERE email IN (SELECT value FROM json_each(?1))`)
        .bind(JSON.stringify(part))
        .first<{ n: number }>();
      existing += r?.n ?? 0;
    }

    const statements: D1PreparedStatement[] = [];
    for (const part of chunks(members)) {
      statements.push(
        db
          .prepare(
            `INSERT INTO contacts (email, name, timezone, source)
               SELECT json_extract(value, '$.e'), json_extract(value, '$.n'), json_extract(value, '$.z'), 'app'
                 FROM json_each(?1) WHERE 1
             ON CONFLICT(email) DO UPDATE SET
               name = COALESCE(contacts.name, excluded.name),
               timezone = COALESCE(contacts.timezone, excluded.timezone),
               updated_at = datetime('now')
             WHERE (contacts.name IS NULL AND excluded.name IS NOT NULL)
                OR (contacts.timezone IS NULL AND excluded.timezone IS NOT NULL)`,
          )
          .bind(JSON.stringify(part.map((m) => ({ e: m.email, n: m.name, z: m.timezone })))),
      );
    }
    for (const part of chunks(removed)) {
      statements.push(
        db
          .prepare(
            `DELETE FROM contact_tags
              WHERE tag LIKE 'app:%'
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
    // The display column follows the normalized tags for every contact touched.
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
    await db.batch(statements);

    const result: AppTagSyncOk = {
      ok: true,
      at,
      members: members.length,
      added: added.length,
      removed: removed.length,
      created: members.length - existing,
    };
    await setConfig(db, SYNCED_KEY, JSON.stringify(result));
    await db.prepare('DELETE FROM workshop_config WHERE key = ?').bind(ERROR_KEY).run();
    if (result.added || result.removed || result.created) {
      await logEventSafe(db, {
        registration_id: null,
        kind: 'broadcast.app_tags.synced',
        source: 'system',
        payload: { members: result.members, added: result.added, removed: result.removed, created: result.created },
      });
    }
    return result;
  } catch (err) {
    console.error('[broadcasts/app-tags] sync failed', err);
    return fail('write-failed', `The app: tags could not be written (${String((err as Error)?.message ?? err).slice(0, 200)}). They were left as they were.`);
  }
}

export type AppTagSyncState = { lastOk: AppTagSyncOk | null; lastError: { at: string; error: string; message: string } | null };

/** The last sync and the last failure since it, for the admin pages and the app's tools. */
export async function appTagSyncState(db: D1Database): Promise<AppTagSyncState> {
  const read = async <T>(key: string): Promise<T | null> => {
    try {
      const v = await getConfig(db, key);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  };
  return { lastOk: await read<AppTagSyncOk>(SYNCED_KEY), lastError: await read(ERROR_KEY) };
}
