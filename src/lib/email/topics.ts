// Email topics (migration 0099): the three Drip topics — Somatic Vocal Healing,
// Retreat/Workshops & Events, Partner Offerings — on an opt-out model. No row in
// email_topic_optouts means the address is subscribed to that topic.
//
// Scope: topics govern BROADCASTS ONLY. A broadcast may name one topic; its
// audience then leaves out everyone who left it (src/lib/broadcasts/db.ts
// audienceSql + the cron's blockedEmailsIn) and its footer says which topic it
// came under. Workshop lifecycle marketing and course sequences follow the
// global email_suppressions alone, transactional mail ignores both, and
// opt-outs are not mirrored to Drip.
//
// Preview safety: a preview shares production D1 before 0099 is applied, so
// every read here degrades to "no topics" and every caller checks topicsReady
// before writing.

export type EmailTopic = { key: string; name: string; description: string | null; sort_order: number };

export const TOPIC_KEY_RE = /^[a-z][a-z0-9-]{0,30}$/;

let ready = false;
// Both halves of 0099: the opt-out table and the broadcasts.topic column.
// Memoised once true (once present, always present).
export async function topicsReady(db: D1Database): Promise<boolean> {
  if (ready) return true;
  try {
    await db.prepare('SELECT 1 FROM email_topic_optouts LIMIT 0').run();
    await db.prepare('SELECT key FROM email_topics LIMIT 0').run();
    await db.prepare('SELECT topic FROM broadcasts LIMIT 0').run();
    return (ready = true);
  } catch {
    return false;
  }
}

// Active topics in their display order; [] before 0099 or on any error.
export async function listTopics(db: D1Database): Promise<EmailTopic[]> {
  try {
    const r = await db
      .prepare(
        'SELECT key, name, description, sort_order FROM email_topics WHERE active = 1 ORDER BY sort_order, key',
      )
      .all<EmailTopic>();
    return r.results ?? [];
  } catch {
    return [];
  }
}

// One active topic by key, or null (unknown, inactive, malformed, or 0099 absent).
export async function getTopic(db: D1Database, key: string | null | undefined): Promise<EmailTopic | null> {
  const k = String(key ?? '').trim();
  if (!TOPIC_KEY_RE.test(k)) return null;
  try {
    return (
      (await db
        .prepare('SELECT key, name, description, sort_order FROM email_topics WHERE key = ? AND active = 1')
        .bind(k)
        .first<EmailTopic>()) ?? null
    );
  } catch {
    return null;
  }
}

// Every topic key → topic, for pages that label many broadcasts at once.
export async function topicsByKey(db: D1Database): Promise<Map<string, EmailTopic>> {
  return new Map((await listTopics(db)).map((t) => [t.key, t]));
}

export type TopicOptOut = { topic: string; source: string | null; created_at: string };

// The topics this address has left, with where and when. Empty on error.
export async function topicOptOutRows(db: D1Database, email: string): Promise<TopicOptOut[]> {
  try {
    const r = await db
      .prepare('SELECT topic, source, created_at FROM email_topic_optouts WHERE email = ? ORDER BY topic')
      .bind(email.trim().toLowerCase())
      .all<TopicOptOut>();
    return r.results ?? [];
  } catch {
    return [];
  }
}

export async function topicOptOuts(db: D1Database, email: string): Promise<Set<string>> {
  return new Set((await topicOptOutRows(db, email)).map((r) => r.topic));
}

// Leave one topic. Idempotent; throws on a DB error so a caller can fall back
// (the one-click endpoint falls back to a full unsubscribe).
export async function optOutOfTopic(db: D1Database, email: string, topic: string, source: string): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO email_topic_optouts (email, topic, source) VALUES (?, ?, ?)')
    .bind(email.trim().toLowerCase(), topic, source.slice(0, 160))
    .run();
}

// Make the address's opt-outs exactly `optedOut` (among the active topics): one
// batch deletes the ones no longer wanted and adds the new ones. Unknown keys
// are ignored. Returns what changed.
export async function setTopicOptOuts(
  db: D1Database,
  email: string,
  optedOut: string[],
  source: string,
): Promise<{ added: string[]; removed: string[] }> {
  const e = email.trim().toLowerCase();
  const known = new Set((await listTopics(db)).map((t) => t.key));
  const want = new Set(optedOut.filter((k) => known.has(k)));
  const have = await topicOptOuts(db, e);
  const added = [...want].filter((k) => !have.has(k));
  const removed = [...have].filter((k) => known.has(k) && !want.has(k));
  if (!added.length && !removed.length) return { added, removed };
  const stmts: D1PreparedStatement[] = [];
  if (removed.length) {
    stmts.push(
      db
        .prepare('DELETE FROM email_topic_optouts WHERE email = ?1 AND topic IN (SELECT value FROM json_each(?2))')
        .bind(e, JSON.stringify(removed)),
    );
  }
  for (const k of added) {
    stmts.push(
      db
        .prepare('INSERT OR IGNORE INTO email_topic_optouts (email, topic, source) VALUES (?, ?, ?)')
        .bind(e, k, source.slice(0, 160)),
    );
  }
  await db.batch(stmts);
  return { added, removed };
}
