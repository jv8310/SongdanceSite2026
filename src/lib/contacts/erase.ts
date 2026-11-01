// Erase one person's marketing data — the admin's answer to "please delete my
// data" (/admin/people/<email> → Contact → Erase, POST /api/admin/contacts/erase).
//
// What goes:
//   • the contacts row's personal fields and every tag that is not purchase
//     evidence (below), the newsletter signup, their topic choices, their rows
//     in broadcast send queues, their per-link clicks;
//   • events whose payload names the address, for the kinds this list writes
//     (contact.*, newsletter.*, email.preferences.*);
//   • email_sends rows are KEPT but anonymised (address → erased@erased.invalid,
//     subject nulled because it can carry the first name), so every broadcast's
//     open, click and bounce figures stay as they were.
//
// What stays, on purpose:
//   • PURCHASE EVIDENCE (src/lib/contacts/site-tags.ts). For people who bought
//     before the site took payments, prod_* / cert_* / ceee* / *vsh* tags,
//     `in-drip` and a few Drip-synced custom keys are the only proof of what they
//     own: the member app's sync and the site read them. When any are there, a
//     minimal contacts row stays — the address and those custom keys only, name /
//     timezone / country and every other field nulled — plus those tags.
//   • orders, registrations, payments and invoices (legal retention), the
//     waiting list, intake forms, cert_access_legacy, the order queues
//     (contact_tag_backfill, drip_order_backfill), workshop sign-in codes
//     (workshop_verification_codes, they expire), other events history, the
//     member app account (its own tool) and the Drip subscriber (unsubscribed
//     here; delete it in Drip by hand).
//
// The address then sits on email_suppressions with reason 'erased', which every
// writer of the contacts list checks (importContacts, writeContactTags, the
// newsletter signup, syncAppTags, the admin add, Resubscribe), so it is never
// mailed or imported again. The event that records the erase carries a sha256
// of the address, never the address itself.
//
// This module must not import src/lib/broadcasts/db.ts (that file imports
// erasedAmong from here).

import { logEventSafe } from '../registrations/db';
import { unsubscribeFromAll } from '../registrations/drip';
import { isPurchaseEvidenceField, isPurchaseEvidenceTag } from './site-tags';

export const ERASED_REASON = 'erased';
export const ERASED_ADDRESS = 'erased@erased.invalid';

// The event kinds whose payload may carry the address (`$.email`), erased with
// it. Written as ranges so idx_events_kind (migration 0091) serves them.
const EVENT_KIND_RANGES_SQL = `(
     (kind >= 'contact.' AND kind < 'contact/')
  OR (kind >= 'newsletter.' AND kind < 'newsletter/')
  OR (kind >= 'email.preferences.' AND kind < 'email.preferences/')
)`;
const EVENTS_WHERE = `${EVENT_KIND_RANGES_SQL}
  AND json_valid(payload_json)
  AND lower(json_extract(payload_json, '$.email')) = ?1`;

// Queue rows by address through UNIQUE(broadcast_id, email): every queue row
// belongs to a broadcast (deleteBroadcast removes its queue), so this misses
// none and never scans the whole table.
const RECIPIENTS_WHERE = `broadcast_id IN (SELECT id FROM broadcasts) AND email = ?1`;

const norm = (email: string) => String(email ?? '').trim().toLowerCase();

/** sha256 hex of the trimmed, lowercased address. */
export async function emailHash(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(norm(email));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Was this address erased? Fails open (false) so a caller keeps its old behaviour on a DB error. */
export async function isErased(db: D1Database, email: string): Promise<boolean> {
  const e = norm(email);
  if (!e) return false;
  try {
    const r = await db
      .prepare(`SELECT 1 AS one FROM email_suppressions WHERE email = ?1 AND reason = '${ERASED_REASON}'`)
      .bind(e)
      .first<{ one: number }>();
    return !!r;
  } catch {
    return false;
  }
}

/** The erased addresses among a list (lowercased). One bound JSON list per 1000; an error gives an empty set. */
export async function erasedAmong(db: D1Database, emails: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const list = [...new Set(emails.map(norm).filter(Boolean))];
  const CHUNK = 1000;
  try {
    for (let i = 0; i < list.length; i += CHUNK) {
      const part = list.slice(i, i + CHUNK);
      const r = await db
        .prepare(
          `SELECT email FROM email_suppressions
            WHERE reason = '${ERASED_REASON}' AND email IN (SELECT value FROM json_each(?1))`,
        )
        .bind(JSON.stringify(part))
        .all<{ email: string }>();
      for (const row of r.results ?? []) out.add(row.email);
    }
  } catch {
    return new Set();
  }
  return out;
}

// ── Which tables exist (a preview runs on the live database before a merge
//    applies the migrations that create some of them) ───────────────────────

export type EraseTables = { clicks: boolean; topics: boolean; newsletter: boolean };

const present = new Set<string>(); // positive results only: once there, always there
async function tableReady(db: D1Database, table: string): Promise<boolean> {
  if (present.has(table)) return true;
  try {
    await db.prepare(`SELECT 1 FROM ${table} LIMIT 0`).run();
    present.add(table);
    return true;
  } catch {
    return false;
  }
}

export async function eraseTables(db: D1Database): Promise<EraseTables> {
  const [clicks, topics, newsletter] = await Promise.all([
    tableReady(db, 'email_link_clicks'), // migration 0097
    tableReady(db, 'email_topic_optouts'), // migration 0099
    tableReady(db, 'newsletter_signups'), // migration 0096
  ]);
  return { clicks, topics, newsletter };
}

// ── The plan: what an erase would delete, anonymise and keep ────────────────

export type ErasePlan = {
  email: string;
  alreadyErased: boolean;
  contact: boolean; // a contacts row exists
  keepRow: boolean; // a minimal contacts row stays (purchase evidence)
  tagsRemoved: string[];
  tagsKept: string[];
  fieldsRemoved: string[]; // custom keys
  fieldsKept: Record<string, unknown>; // custom key → value, as stored
  personalFields: string[]; // name / timezone / country that hold a value
  recipients: number; // broadcast queue rows
  sends: number; // email_sends rows to anonymise
  clicks: number | null; // null = table not there yet
  topicOptOuts: number | null;
  newsletter: number | null;
  events: number;
  tables: EraseTables;
};

type ContactRowRaw = {
  email: string;
  name: string | null;
  timezone: string | null;
  country: string | null;
  custom: string | null;
};

function parseCustom(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const count = async (stmt: D1PreparedStatement): Promise<number> =>
  Number((await stmt.first<{ n: number }>())?.n ?? 0);

/**
 * What an erase of this address would do. Read on demand (the person page only
 * asks for it when the admin opens the erase step), every lookup on an index.
 */
export async function previewErase(db: D1Database, email: string): Promise<ErasePlan> {
  const e = norm(email);
  const tables = await eraseTables(db);
  const [suppression, contact, tagRows, recipients, sends, clicks, topicOptOuts, newsletter, events] =
    await Promise.all([
      db
        .prepare('SELECT reason FROM email_suppressions WHERE email = ?1')
        .bind(e)
        .first<{ reason: string }>(),
      db
        .prepare('SELECT email, name, timezone, country, custom FROM contacts WHERE email = ?1')
        .bind(e)
        .first<ContactRowRaw>(),
      db
        .prepare('SELECT tag FROM contact_tags WHERE email = ?1 OR lower(email) = ?1 ORDER BY tag')
        .bind(e)
        .all<{ tag: string }>(),
      count(db.prepare(`SELECT COUNT(*) AS n FROM broadcast_recipients WHERE ${RECIPIENTS_WHERE}`).bind(e)),
      count(db.prepare('SELECT COUNT(*) AS n FROM email_sends WHERE lower(to_email) = ?1').bind(e)),
      tables.clicks
        ? count(
            db
              .prepare(
                `SELECT COUNT(*) AS n FROM email_link_clicks
                  WHERE to_email = ?1 OR resend_id IN (SELECT resend_id FROM email_sends WHERE lower(to_email) = ?1)`,
              )
              .bind(e),
          )
        : Promise.resolve(null),
      tables.topics
        ? count(db.prepare('SELECT COUNT(*) AS n FROM email_topic_optouts WHERE email = ?1').bind(e))
        : Promise.resolve(null),
      tables.newsletter
        ? count(db.prepare('SELECT COUNT(*) AS n FROM newsletter_signups WHERE email = ?1').bind(e))
        : Promise.resolve(null),
      count(db.prepare(`SELECT COUNT(*) AS n FROM events WHERE ${EVENTS_WHERE}`).bind(e)),
    ]);

  const tags = [...new Set((tagRows.results ?? []).map((r) => r.tag))];
  const tagsKept = tags.filter(isPurchaseEvidenceTag);
  const tagsRemoved = tags.filter((t) => !isPurchaseEvidenceTag(t));
  const custom = parseCustom(contact?.custom ?? null);
  const fieldsKept: Record<string, unknown> = {};
  const fieldsRemoved: string[] = [];
  for (const [k, v] of Object.entries(custom)) {
    if (isPurchaseEvidenceField(k)) fieldsKept[k] = v;
    else fieldsRemoved.push(k);
  }
  const personalFields = contact
    ? (['name', 'timezone', 'country'] as const).filter((f) => (contact[f] ?? '') !== '')
    : [];

  return {
    email: e,
    alreadyErased: suppression?.reason === ERASED_REASON,
    contact: !!contact,
    keepRow: !!contact && (tagsKept.length > 0 || Object.keys(fieldsKept).length > 0),
    tagsRemoved,
    tagsKept,
    fieldsRemoved,
    fieldsKept,
    personalFields,
    recipients,
    sends,
    clicks,
    topicOptOuts,
    newsletter,
    events,
    tables,
  };
}

// ── The erase ───────────────────────────────────────────────────────────────

export type EraseCounts = {
  contact: 'deleted' | 'minimised' | 'none';
  tags: number; // tags removed
  tagsKept: number;
  fieldsKept: number;
  recipients: number;
  clicks: number;
  topicOptOuts: number;
  newsletter: number;
  sendsAnonymised: number;
  events: number;
};

export type EraseResult =
  | { ok: true; counts: EraseCounts; kept: { tags: string[]; fields: string[] }; drip: 'unsubscribed' | 'not-configured' | 'failed' }
  | { ok: false; error: string };

export async function eraseContact(
  env: { DB: D1Database; DRIP_API_TOKEN?: string; DRIP_ACCOUNT_ID?: string },
  email: string,
  by: string,
): Promise<EraseResult> {
  const db = env.DB;
  const e = norm(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, error: "That doesn't look like an email address." };

  let plan: ErasePlan;
  try {
    plan = await previewErase(db, e);
  } catch (err) {
    return { ok: false, error: `Nothing was erased: the database could not be read (${String(err).slice(0, 200)}).` };
  }
  if (plan.alreadyErased) return { ok: false, error: 'This address was already erased.' };

  const keepTags = plan.tagsKept;
  const keptCustom = Object.keys(plan.fieldsKept).length ? JSON.stringify(plan.fieldsKept) : null;

  // One batch (a transaction). Statements for tables that are not there yet are
  // left out, since one failing statement would fail them all.
  const statements: D1PreparedStatement[] = [];
  const idx: Partial<Record<keyof EraseCounts, number>> = {};
  const add = (key: keyof EraseCounts | null, stmt: D1PreparedStatement) => {
    if (key) idx[key] = statements.length;
    statements.push(stmt);
  };

  if (plan.tables.clicks) {
    // Before email_sends is anonymised: the subquery finds the clicks by its address.
    add(
      'clicks',
      db
        .prepare(
          `DELETE FROM email_link_clicks
            WHERE to_email = ?1 OR resend_id IN (SELECT resend_id FROM email_sends WHERE lower(to_email) = ?1)`,
        )
        .bind(e),
    );
  }
  add('recipients', db.prepare(`DELETE FROM broadcast_recipients WHERE ${RECIPIENTS_WHERE}`).bind(e));
  add(
    'sendsAnonymised',
    db
      .prepare(`UPDATE email_sends SET to_email = '${ERASED_ADDRESS}', subject = NULL WHERE lower(to_email) = ?1`)
      .bind(e),
  );
  add(
    'tags',
    db
      .prepare(
        `DELETE FROM contact_tags
          WHERE (email = ?1 OR lower(email) = ?1)
            AND tag NOT IN (SELECT value FROM json_each(?2))`,
      )
      .bind(e, JSON.stringify(keepTags)),
  );
  if (plan.keepRow) {
    add(
      null,
      db
        .prepare(
          `UPDATE contacts
              SET name = NULL, timezone = NULL, country = NULL,
                  custom = ?2,
                  tags = (SELECT group_concat(tag, ', ') FROM (SELECT tag FROM contact_tags WHERE email = ?1 ORDER BY tag)),
                  updated_at = datetime('now')
            WHERE email = ?1`,
        )
        .bind(e, keptCustom),
    );
  } else {
    add(null, db.prepare('DELETE FROM contacts WHERE email = ?1').bind(e));
  }
  if (plan.tables.topics) add('topicOptOuts', db.prepare('DELETE FROM email_topic_optouts WHERE email = ?1').bind(e));
  if (plan.tables.newsletter) add('newsletter', db.prepare('DELETE FROM newsletter_signups WHERE email = ?1').bind(e));
  add('events', db.prepare(`DELETE FROM events WHERE ${EVENTS_WHERE}`).bind(e));
  add(
    null,
    db
      .prepare(
        `INSERT INTO email_suppressions (email, reason, source) VALUES (?1, '${ERASED_REASON}', 'admin')
         ON CONFLICT(email) DO UPDATE SET reason = '${ERASED_REASON}', source = 'admin', created_at = datetime('now')`,
      )
      .bind(e),
  );

  let results: D1Result[];
  try {
    results = await db.batch(statements);
  } catch (err) {
    return { ok: false, error: `Nothing was erased: ${String((err as Error)?.message ?? err).slice(0, 200)}` };
  }
  const changes = (key: keyof EraseCounts): number => {
    const i = idx[key];
    return i == null ? 0 : Number(results[i]?.meta?.changes ?? 0);
  };

  const counts: EraseCounts = {
    contact: !plan.contact ? 'none' : plan.keepRow ? 'minimised' : 'deleted',
    tags: changes('tags'),
    tagsKept: keepTags.length,
    fieldsKept: Object.keys(plan.fieldsKept).length,
    recipients: changes('recipients'),
    clicks: changes('clicks'),
    topicOptOuts: changes('topicOptOuts'),
    newsletter: changes('newsletter'),
    sendsAnonymised: changes('sendsAnonymised'),
    events: changes('events'),
  };

  // Drip: best-effort, after the local erase has taken effect.
  let drip: 'unsubscribed' | 'not-configured' | 'failed' = 'not-configured';
  if (env.DRIP_API_TOKEN && env.DRIP_ACCOUNT_ID) {
    try {
      await unsubscribeFromAll({ apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID }, e);
      drip = 'unsubscribed';
    } catch {
      drip = 'failed';
    }
  }

  // No plain address anywhere in this event: a hash, so the erase can be
  // proven later for an address someone gives us, and nothing else.
  await logEventSafe(db, {
    registration_id: null,
    kind: 'contact.erased',
    source: 'admin',
    payload: {
      email_sha256: await emailHash(e),
      by,
      counts,
      kept_tags: keepTags.length,
      kept_fields: Object.keys(plan.fieldsKept),
      drip,
    },
  });

  return { ok: true, counts, kept: { tags: keepTags, fields: Object.keys(plan.fieldsKept) }, drip };
}
