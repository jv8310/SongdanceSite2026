// Contact-level edits for the marketing list (`contacts` + `contact_tags`):
// add by hand, change the name / timezone / country, add and remove tags, set
// and remove custom fields, take a contact off the list, and search it. Used by
// the Contact panel on /admin/people/<email> (ContactPanel.astro) and the
// search / add sections of /admin/contacts, through POST /api/admin/contacts/edit.
//
// `contact_tags` is the source of truth for tags; `contacts.tags` is the display
// copy and is resynced after every tag change. Rules that hold for every edit:
//   • `app:` tags belong to the member app's hourly sync (broadcasts/app-tags.ts):
//     read-only here.
//   • Purchase evidence (site-tags.ts: prod_* / cert_* / ceee* / *vsh* tags,
//     `in-drip`, the Drip-synced SVH custom keys) is the only proof of purchase
//     for people who bought before the site took payments. Removing one, or
//     changing an evidence field's value, needs an explicit confirm and is
//     logged as such; taking the whole contact off the list is refused while any
//     is there (Erase keeps it and removes the rest).
//   • An erased address (erase.ts) cannot be added back.
//   • Every change is logged (`contact.*` events, source 'admin', with the
//     admin's address as `by`). These payloads carry the contact's address;
//     erase.ts deletes them with the rest.

import { logEventSafe } from '../registrations/db';
import { normalizeTimezone, splitTags } from '../broadcasts/db';
import { isAppTag } from '../broadcasts/app-tags';
import { findCountry } from '../countries';
import { addContactTagStatements } from './mirror';
import { isErased } from './erase';
import { isPurchaseEvidenceField, isPurchaseEvidenceTag } from './site-tags';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 120;
const MAX_TAG = 80;
const MAX_TAGS_PER_ADD = 30;
const MAX_FIELD_KEY = 80;
const MAX_FIELD_VALUE = 1000;
const APP_TAG_REFUSAL = "Tags starting with app: belong to the member app and can't be changed here.";

export type ContactFull = {
  email: string;
  name: string | null;
  timezone: string | null;
  country: string | null;
  tags: string[];
  custom: Record<string, string>;
  source: string | null;
  created_at: string;
  updated_at: string;
};

export type Suppression = { reason: string; source: string | null; created_at: string };

export type EditResult = { ok: true; message: string } | { ok: false; error: string };

const norm = (email: string) => String(email ?? '').trim().toLowerCase();
const fail = (error: string): EditResult => ({ ok: false, error });
const okMsg = (message: string): EditResult => ({ ok: true, message });

function stringify(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function parseCustom(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// One line of text: control characters out, runs of space collapsed.
function oneLine(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The whole contact (custom values stringified), or null. Never throws. */
export async function getContactFull(db: D1Database, email: string): Promise<ContactFull | null> {
  const e = norm(email);
  try {
    const [row, tagRows] = await Promise.all([
      db
        .prepare(
          'SELECT email, name, timezone, country, custom, source, created_at, updated_at FROM contacts WHERE email = ?1',
        )
        .bind(e)
        .first<{
          email: string;
          name: string | null;
          timezone: string | null;
          country: string | null;
          custom: string | null;
          source: string | null;
          created_at: string;
          updated_at: string;
        }>(),
      db.prepare('SELECT tag FROM contact_tags WHERE email = ?1 ORDER BY tag').bind(e).all<{ tag: string }>(),
    ]);
    if (!row) return null;
    const custom: Record<string, string> = {};
    for (const [k, v] of Object.entries(parseCustom(row.custom))) custom[k] = stringify(v);
    return {
      email: row.email,
      name: row.name,
      timezone: row.timezone,
      country: row.country,
      tags: (tagRows.results ?? []).map((t) => t.tag),
      custom,
      source: row.source,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  } catch {
    return null;
  }
}

/** The address's row on email_suppressions, or null. Never throws. */
export async function getSuppression(db: D1Database, email: string): Promise<Suppression | null> {
  try {
    return (
      (await db
        .prepare('SELECT reason, source, created_at FROM email_suppressions WHERE email = ?1')
        .bind(norm(email))
        .first<Suppression>()) ?? null
    );
  } catch {
    return null;
  }
}

/** The purchase evidence a contact carries (tags + custom keys). */
export function contactEvidence(c: Pick<ContactFull, 'tags' | 'custom'>): { tags: string[]; fields: string[] } {
  return {
    tags: c.tags.filter(isPurchaseEvidenceTag),
    fields: Object.keys(c.custom).filter(isPurchaseEvidenceField),
  };
}

/** Blank → null; an ISO-2 code → that code; anything else kept as typed (≤ 60), so a CSV's "Belgium" survives a save. */
export function cleanCountry(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = oneLine(raw);
  if (!s) return { ok: true, value: null };
  if (s.length === 2) {
    const c = findCountry(s);
    if (c) return { ok: true, value: c.code };
  }
  if (s.length > 60) return { ok: false, error: 'Country is too long (60 characters at most).' };
  return { ok: true, value: s };
}

function cleanName(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = oneLine(raw);
  if (!s) return { ok: true, value: null };
  if (s.length > MAX_NAME) return { ok: false, error: `Name is too long (${MAX_NAME} characters at most).` };
  return { ok: true, value: s };
}

function cleanTimezone(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = oneLine(raw);
  if (!s) return { ok: true, value: null };
  const tz = normalizeTimezone(s);
  if (!tz) return { ok: false, error: `“${s.slice(0, 60)}” is not a timezone. Use a name like Europe/Brussels or America/New_York, or leave it empty.` };
  return { ok: true, value: tz };
}

function cleanTags(raw: string | null | undefined): { ok: true; tags: string[] } | { ok: false; error: string } {
  const tags = splitTags(raw).map(oneLine).filter(Boolean);
  if (tags.some(isAppTag)) return { ok: false, error: APP_TAG_REFUSAL };
  const long = tags.find((t) => t.length > MAX_TAG);
  if (long) return { ok: false, error: `“${long.slice(0, 40)}…” is too long for a tag (${MAX_TAG} characters at most).` };
  if (tags.length > MAX_TAGS_PER_ADD) return { ok: false, error: `At most ${MAX_TAGS_PER_ADD} tags at a time.` };
  return { ok: true, tags };
}

// Resync the display `tags` column from contact_tags.
function displayTagsStatement(db: D1Database, email: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE contacts
          SET tags = (SELECT group_concat(tag, ', ') FROM (SELECT tag FROM contact_tags WHERE email = ?1 ORDER BY tag)),
              updated_at = datetime('now')
        WHERE email = ?1`,
    )
    .bind(email);
}

// ── Add by hand ─────────────────────────────────────────────────────────────

export async function addContact(
  db: D1Database,
  input: { email: string; name?: string | null; timezone?: string | null; country?: string | null; tags?: string | null },
  by: string,
): Promise<EditResult & { existed?: boolean }> {
  const email = norm(input.email);
  if (!EMAIL_RE.test(email) || email.length > 254) return fail("That doesn't look like an email address.");
  if (await isErased(db, email)) return fail("This address was erased. It can't be added back from here.");

  const existing = await db
    .prepare('SELECT 1 AS one FROM contacts WHERE email = ?1')
    .bind(email)
    .first<{ one: number }>();
  if (existing) return { ok: true, existed: true, message: 'Already on the contacts list — edit it below.' };

  const name = cleanName(input.name);
  if (!name.ok) return fail(name.error);
  const timezone = cleanTimezone(input.timezone);
  if (!timezone.ok) return fail(timezone.error);
  const country = cleanCountry(input.country);
  if (!country.ok) return fail(country.error);
  const tags = cleanTags(input.tags);
  if (!tags.ok) return fail(tags.error);

  try {
    await db.batch([
      db
        .prepare(`INSERT INTO contacts (email, name, timezone, country, source) VALUES (?1, ?2, ?3, ?4, 'admin')`)
        .bind(email, name.value, timezone.value, country.value),
      ...addContactTagStatements(db, email, tags.tags),
    ]);
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) return { ok: true, existed: true, message: 'Already on the contacts list — edit it below.' };
    return fail(`Not added: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
  }

  const suppressed = await getSuppression(db, email);
  await logEventSafe(db, {
    registration_id: null,
    kind: 'contact.added',
    source: 'admin',
    payload: { email, by, tags: tags.tags, suppressed: !!suppressed },
  });
  return okMsg(
    suppressed
      ? "Added — but this address is on the suppression list, so it won't be mailed until resubscribed."
      : `Added to the contacts list${tags.tags.length ? ` with ${tags.tags.length === 1 ? '1 tag' : `${tags.tags.length} tags`}` : ''}.`,
  );
}

// ── Name, timezone, country ─────────────────────────────────────────────────

export async function updateContactDetails(
  db: D1Database,
  email: string,
  input: { name: string | null; timezone: string | null; country: string | null },
  by: string,
): Promise<EditResult> {
  const e = norm(email);
  const current = await getContactFull(db, e);
  if (!current) return fail('Not on the contacts list — add the contact first.');

  const name = cleanName(input.name);
  if (!name.ok) return fail(name.error);
  const timezone = cleanTimezone(input.timezone);
  if (!timezone.ok) return fail(timezone.error);
  const country = cleanCountry(input.country);
  if (!country.ok) return fail(country.error);

  const changes: Record<string, [string | null, string | null]> = {};
  if (name.value !== current.name) changes.name = [current.name, name.value];
  if (timezone.value !== current.timezone) changes.timezone = [current.timezone, timezone.value];
  if (country.value !== current.country) changes.country = [current.country, country.value];
  if (Object.keys(changes).length === 0) return okMsg('Nothing changed.');

  // An admin edit does overwrite the name (the importer never does).
  await db
    .prepare(
      `UPDATE contacts SET name = ?2, timezone = ?3, country = ?4, updated_at = datetime('now') WHERE email = ?1`,
    )
    .bind(e, name.value, timezone.value, country.value)
    .run();
  await logEventSafe(db, { registration_id: null, kind: 'contact.updated', source: 'admin', payload: { email: e, by, changes } });
  return okMsg(`Saved: ${Object.keys(changes).join(', ')}.`);
}

// ── Tags ────────────────────────────────────────────────────────────────────

export async function addContactTags(db: D1Database, email: string, rawTags: string, by: string): Promise<EditResult> {
  const e = norm(email);
  const current = await getContactFull(db, e);
  if (!current) return fail('Not on the contacts list — add the contact first.');
  const tags = cleanTags(rawTags);
  if (!tags.ok) return fail(tags.error);
  if (tags.tags.length === 0) return fail('Type at least one tag (comma-separated).');
  const fresh = tags.tags.filter((t) => !current.tags.includes(t));
  if (fresh.length === 0) return okMsg('Those tags were already there.');

  await db.batch(addContactTagStatements(db, e, fresh));
  await logEventSafe(db, {
    registration_id: null,
    kind: 'contact.tags_added',
    source: 'admin',
    payload: { email: e, by, tags: fresh, purchase_evidence: fresh.filter(isPurchaseEvidenceTag) },
  });
  return okMsg(`Added ${fresh.length === 1 ? 'tag' : 'tags'}: ${fresh.join(', ')}.`);
}

export async function removeContactTag(
  db: D1Database,
  email: string,
  rawTag: string,
  by: string,
  opts: { confirmEvidence?: boolean } = {},
): Promise<EditResult> {
  const e = norm(email);
  const tag = String(rawTag ?? '').trim();
  if (!tag) return fail('No tag given.');
  if (isAppTag(tag.toLowerCase())) return fail(APP_TAG_REFUSAL);
  const evidence = isPurchaseEvidenceTag(tag);
  if (evidence && !opts.confirmEvidence) {
    return fail(
      `“${tag}” is purchase evidence: the member app and the site read it to know what this person bought. Nothing was removed. To remove it anyway, tick the box that confirms it.`,
    );
  }

  const res = await db.batch([
    db.prepare('DELETE FROM contact_tags WHERE email = ?1 AND tag = ?2').bind(e, tag),
    displayTagsStatement(db, e),
  ]);
  if (Number(res[0]?.meta?.changes ?? 0) === 0) return fail(`“${tag}” is not on this contact.`);
  await logEventSafe(db, {
    registration_id: null,
    kind: 'contact.tag_removed',
    source: 'admin',
    payload: { email: e, by, tag, purchase_evidence: evidence },
  });
  return okMsg(evidence ? `Removed the purchase-evidence tag ${tag} (logged).` : `Removed the tag ${tag}.`);
}

// ── Custom fields ───────────────────────────────────────────────────────────

function cleanKey(raw: unknown): { ok: true; key: string } | { ok: false; error: string } {
  const key = String(raw ?? '').trim();
  if (!key) return { ok: false, error: 'A field needs a name.' };
  if (key.length > MAX_FIELD_KEY) return { ok: false, error: `Field names are ${MAX_FIELD_KEY} characters at most.` };
  if (!/^[^"\\\u0000-\u001f\u007f]+$/.test(key)) return { ok: false, error: 'Field names cannot contain quotes, backslashes or line breaks.' };
  return { ok: true, key };
}

// The JSON path of one top-level key, quoted so dots and spaces in a CSV header
// ("First Name", "a.b") address that key and nothing else.
const KEY_PATH_SQL = `'$."' || ?2 || '"'`;

export async function setContactField(
  db: D1Database,
  email: string,
  rawKey: string,
  rawValue: string,
  by: string,
  opts: { confirmEvidence?: boolean } = {},
): Promise<EditResult> {
  const e = norm(email);
  const k = cleanKey(rawKey);
  if (!k.ok) return fail(k.error);
  const value = String(rawValue ?? '').trim();
  if (value.length > MAX_FIELD_VALUE) return fail(`Field values are ${MAX_FIELD_VALUE} characters at most.`);
  const current = await getContactFull(db, e);
  if (!current) return fail('Not on the contacts list — add the contact first.');

  const had = Object.prototype.hasOwnProperty.call(current.custom, k.key);
  const before = had ? current.custom[k.key] : null;
  if (had && before === value) return okMsg('Nothing changed.');
  const evidence = isPurchaseEvidenceField(k.key);
  if (evidence && had && !opts.confirmEvidence) {
    return fail(
      `“${k.key}” is purchase evidence (the member app reads it for the course they bought). Nothing was changed. To change it anyway, tick the box that confirms it.`,
    );
  }

  await db
    .prepare(
      `UPDATE contacts
          SET custom = json_set(CASE WHEN json_valid(custom) THEN custom ELSE '{}' END, ${KEY_PATH_SQL}, ?3),
              updated_at = datetime('now')
        WHERE email = ?1`,
    )
    .bind(e, k.key, value)
    .run();
  await logEventSafe(db, {
    registration_id: null,
    kind: 'contact.field_set',
    source: 'admin',
    // Values are only logged for evidence fields (course progress, worth an audit trail).
    payload: { email: e, by, key: k.key, purchase_evidence: evidence, ...(evidence ? { from: before, to: value } : {}) },
  });
  return okMsg(had ? `Saved the field ${k.key}.` : `Added the field ${k.key}.`);
}

export async function removeContactField(
  db: D1Database,
  email: string,
  rawKey: string,
  by: string,
  opts: { confirmEvidence?: boolean } = {},
): Promise<EditResult> {
  const e = norm(email);
  const k = cleanKey(rawKey);
  if (!k.ok) return fail(k.error);
  const current = await getContactFull(db, e);
  if (!current) return fail('Not on the contacts list.');
  if (!Object.prototype.hasOwnProperty.call(current.custom, k.key)) return fail(`“${k.key}” is not on this contact.`);
  const evidence = isPurchaseEvidenceField(k.key);
  if (evidence && !opts.confirmEvidence) {
    return fail(
      `“${k.key}” is purchase evidence (the member app reads it for the course they bought). Nothing was removed. To remove it anyway, tick the box that confirms it.`,
    );
  }

  await db
    .prepare(
      `UPDATE contacts
          SET custom = CASE WHEN json_valid(custom) THEN json_remove(custom, ${KEY_PATH_SQL}) ELSE custom END,
              updated_at = datetime('now')
        WHERE email = ?1`,
    )
    .bind(e, k.key)
    .run();
  await logEventSafe(db, {
    registration_id: null,
    kind: 'contact.field_removed',
    source: 'admin',
    payload: { email: e, by, key: k.key, purchase_evidence: evidence, ...(evidence ? { from: current.custom[k.key] } : {}) },
  });
  return okMsg(evidence ? `Removed the purchase-evidence field ${k.key} (logged).` : `Removed the field ${k.key}.`);
}

// ── Off the list ────────────────────────────────────────────────────────────

/**
 * Take the contact and its tags off the list, and out of the not-yet-sent part
 * of any broadcast that is sending or paused (otherwise a "removed" contact is
 * still mailed). Refused while the contact carries purchase evidence: Erase
 * keeps that and removes the rest. Suppression and sent-mail records stay.
 */
export async function deleteContact(db: D1Database, email: string, by: string): Promise<EditResult> {
  const e = norm(email);
  const current = await getContactFull(db, e);
  if (!current) return fail('Not on the contacts list.');
  const ev = contactEvidence(current);
  if (ev.tags.length || ev.fields.length) {
    return fail(
      `Not removed: this contact carries purchase evidence (${[...ev.tags, ...ev.fields].join(', ')}), which the member app and the site read for the courses they bought. Use Erase below instead: it keeps that evidence and removes everything else.`,
    );
  }

  const res = await db.batch([
    db.prepare('DELETE FROM contact_tags WHERE email = ?1 OR lower(email) = ?1').bind(e),
    db.prepare('DELETE FROM contacts WHERE email = ?1').bind(e),
    db
      .prepare(
        `DELETE FROM broadcast_recipients
          WHERE broadcast_id IN (SELECT id FROM broadcasts WHERE status IN ('sending', 'paused'))
            AND email = ?1 AND status = 'pending'`,
      )
      .bind(e),
  ]);
  const tags = Number(res[0]?.meta?.changes ?? 0);
  const queued = Number(res[2]?.meta?.changes ?? 0);
  await logEventSafe(db, {
    registration_id: null,
    kind: 'contact.deleted',
    source: 'admin',
    payload: { email: e, by, tags, queued_removed: queued },
  });
  return okMsg(
    `Removed from the contacts list (and ${tags === 1 ? '1 tag' : `${tags} tags`}${queued ? `; taken out of ${queued === 1 ? '1 broadcast' : `${queued} broadcasts`} still sending` : ''}).`,
  );
}

// ── Search ──────────────────────────────────────────────────────────────────

export type ContactSearchRow = {
  email: string;
  name: string | null;
  country: string | null;
  timezone: string | null;
  tags: string | null;
  source: string | null;
  created_at: string;
  suppression: string | null; // email_suppressions.reason ('erased', 'unsubscribe', …) or null
};

export const SEARCH_PAGE_SIZES = [25, 50, 100] as const;

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Contacts whose address or name contains `q` (≥ 2 characters), prefix matches first. */
export async function searchContacts(
  db: D1Database,
  opts: { q: string; page: number; per: number },
): Promise<{ rows: ContactSearchRow[]; total: number }> {
  const q = String(opts.q ?? '').trim().toLowerCase();
  if (q.length < 2) return { rows: [], total: 0 };
  const per = (SEARCH_PAGE_SIZES as readonly number[]).includes(opts.per) ? opts.per : 50;
  const page = Number.isFinite(opts.page) && opts.page >= 1 ? Math.floor(opts.page) : 1;
  const term = `%${likeEscape(q)}%`;
  const prefix = `${likeEscape(q)}%`;
  const where = `(lower(email) LIKE ?1 ESCAPE '\\' OR lower(COALESCE(name, '')) LIKE ?1 ESCAPE '\\')`;
  // One scan: the window count rides on the page's rows.
  const res = await db
    .prepare(
      `SELECT email, name, country, timezone, tags, source, created_at,
              (SELECT reason FROM email_suppressions s WHERE s.email = contacts.email) AS suppression,
              COUNT(*) OVER () AS total
         FROM contacts
        WHERE ${where}
        ORDER BY (lower(email) LIKE ?2 ESCAPE '\\') DESC, id DESC
        LIMIT ?3 OFFSET ?4`,
    )
    .bind(term, prefix, per, (page - 1) * per)
    .all<ContactSearchRow & { total: number }>();
  const rows = res.results ?? [];
  let total = rows[0]?.total ?? 0;
  if (rows.length === 0 && page > 1) {
    total = Number(
      (await db.prepare(`SELECT COUNT(*) AS n FROM contacts WHERE ${where}`).bind(term).first<{ n: number }>())?.n ?? 0,
    );
  }
  return { rows: rows.map(({ total: _t, ...r }) => r), total };
}

// ── Redirects back to the admin page, with a flash ──────────────────────────

// Flash parameters any admin endpoint may have left on a person page's URL.
// They are dropped before a new flash is set (and from the page's own
// return_to), so an old error never rides along into a later success.
export const FLASH_PARAMS = ['contact_msg', 'contact_err', 'flash', 'msg', 'app_msg', 'app_err', 'app_ok', 'erase', 'topics_msg', 'topics_err'] as const;

/** A same-site admin path from a posted return_to, or the fallback. */
export function safeAdminReturn(raw: string | null | undefined, fallback: string): string {
  const s = String(raw ?? '').trim();
  if (!s.startsWith('/admin') || s.startsWith('//')) return fallback;
  try {
    const u = new URL(s, 'https://x.invalid');
    if (u.origin !== 'https://x.invalid' || !u.pathname.startsWith('/admin')) return fallback;
    return u.pathname + u.search;
  } catch {
    return fallback;
  }
}

/** `base` with the old flash parameters dropped, `params` set and `hash` appended. */
export function withFlash(base: string, params: Record<string, string | null>, hash = ''): string {
  const u = new URL(base, 'https://x.invalid');
  for (const k of FLASH_PARAMS) u.searchParams.delete(k);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.pathname + u.search + hash;
}

/** The IANA timezone names for a datalist (empty when the runtime can't list them). */
export function timezoneNames(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
