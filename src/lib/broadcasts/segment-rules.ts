// Segment builder — the rules a broadcast's audience can be written in instead
// of the include/exclude tags (migration 0100, broadcasts.audience_rules).
//
// Pure, apart from the table probes: parseSegmentRules checks and normalises a
// rule set (from the compose page, a saved segment, the app), compileSegment
// turns it into one SQL fragment against a `contacts c` row for audienceSql
// (db.ts) to AND onto the suppression and topic clauses, and describeSegment
// says it in words for the broadcast page.
//
// How the SQL is shaped, and why:
//   • Every list is bound as ONE JSON parameter (`IN (SELECT value FROM
//     json_each(?))`), so D1's 100-parameter cap depends on the number of
//     conditions, never on the length of a list. A rule set may bind at most 90
//     values (the snapshot adds its broadcast id, the topic one more).
//   • Conditions that read another table are UNCORRELATED: `c.email IN (SELECT
//     lower(email) FROM … WHERE …)`. SQLite runs such a subquery once and keeps
//     its answer, where a correlated EXISTS would look the table up once per
//     contact — on a 55k list, against `registrations` (indexed on email, not
//     lower(email)), that is millions of rows read on every live count.
//   • Every email column used on the right of a NOT IN is NOT NULL, so a NULL
//     can never turn "not in" into "unknown" for everyone.
//   • "Did not open / did not click" hold only for people who RECEIVED the
//     broadcast: on its own, `NOT IN (openers)` would match the whole list.
//   • Prefix matches use GLOB ('broadcast_*'), which needs no escaping inside a
//     JS template literal (LIKE … ESCAPE '\' does, and breaks silently).
//   • Times are compared through julianday(), which reads every format the
//     tables hold (datetime('now'), ISO with T…Z).

import { LABEL_BY_SLUG } from '../courses/journeys';
import { findCountry } from '../countries';
import { TOPIC_KEY_RE } from '../email/topics';

export type Match = 'all' | 'any';
export type BoughtProduct = 'any' | 'course' | 'workshop' | 'masterclass' | 'retreat' | 'album';
export type BoughtWhen = 'ever' | 'within' | 'never' | 'since_broadcast' | 'not_since_broadcast';
export type EmailOp = 'received' | 'opened' | 'not_opened' | 'clicked' | 'not_clicked' | 'clicked_link';
export type FieldOp = 'eq' | 'neq' | 'contains' | 'empty' | 'not_empty' | 'gt' | 'lt';

export type Condition =
  | { type: 'tag'; op: 'any' | 'none' | 'all'; tags: string[] }
  | { type: 'field'; key: string; op: FieldOp; value?: string }
  | { type: 'topic'; op: 'subscribed' | 'left'; topic: string }
  | { type: 'country'; op: 'in' | 'not_in'; countries: string[] } // ISO-2
  | {
      type: 'bought';
      product: BoughtProduct;
      items?: string[]; // course keys | retreat slugs | album ids
      when: BoughtWhen;
      days?: number;
      broadcastId?: number;
    }
  | { type: 'booked'; kind: 'workshop' | 'retreat'; workshopId?: number; retreat?: string }
  | { type: 'email'; op: EmailOp; broadcastId: number; text?: string }
  | { type: 'activity'; op: 'engaged' | 'not_engaged'; days: number }
  | { type: 'newsletter'; days: number }
  | { type: 'added'; days: number };
export type ConditionGroup = { match: Match; conditions: Condition[] }; // one level only
export type SegmentRules = { match: Match; conditions: Array<Condition | ConditionGroup> };

export const SEGMENT_LIMITS = { conditions: 20, listItems: 200, binds: 90, text: 200, days: 3650, fieldKey: 100 };

// A rule set that can't be read or can't be counted. audienceSql throws it and
// every caller that snapshots or counts treats it as "refuse", never as "send
// to the whole list".
export class AudienceRulesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudienceRulesError';
  }
}

export type SegmentFeatures = { topics: boolean; linkClicks: boolean; newsletter: boolean };

// What a course key means in purchases: product slugs on course_registrations,
// a slug prefix (the live passes), a course-checkout bump slug (the bumps JSON)
// and workshop-ledger course lines (workshop_purchases → workshop_products).
export type SegmentCourse = {
  key: string;
  label: string;
  slugs: string[];
  prefix?: string;
  bump?: string;
  ledger?: string[];
};
export const SEGMENT_COURSES: SegmentCourse[] = [
  { key: 'svh-12week', label: '12-week course', slugs: ['svh-12week', 'cc-bundle'], ledger: ['12w-course'] },
  { key: 'cc-cert', label: 'Certification course', slugs: ['cc-cert', 'cc-bundle'], ledger: ['cert-course'] },
  { key: 'cc-bundle', label: 'Certification path (both)', slugs: ['cc-bundle'] },
  { key: 'grief-course', label: 'The Grief Course', slugs: ['grief-course', 'grief'], bump: 'grief' },
  { key: 'forgiveness-course', label: 'The Forgiveness Course', slugs: ['forgiveness-course'] },
  {
    key: 'asj',
    label: 'Authentic Singing Journey',
    slugs: ['asj', 'asj-pro', 'journeys-bundle', 'journeys-bundle-pro'],
    bump: 'asj',
  },
  { key: 'mmj', label: LABEL_BY_SLUG.mmj, slugs: ['mmj', 'journeys-bundle', 'journeys-bundle-pro'] },
  {
    key: 'inner-child',
    label: LABEL_BY_SLUG['inner-child'],
    slugs: ['inner-child', 'journeys-bundle', 'journeys-bundle-pro'],
  },
  { key: 'live-pass', label: 'Live pass (any length)', slugs: [], prefix: 'live-pass-' },
  { key: 'qa-plan-deepening', label: 'Live pass monthly', slugs: ['qa-plan-deepening'] },
];
const COURSE_BY_KEY = new Map(SEGMENT_COURSES.map((c) => [c.key, c]));

// Spellings a contact's free-text country may carry besides the ISO code and
// the name in countries.ts (Drip exports and old CSVs). Upper-cased.
const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ['USA', 'U.S.A.', 'U.S.', 'UNITED STATES OF AMERICA', 'AMERICA'],
  GB: ['UK', 'U.K.', 'GREAT BRITAIN', 'ENGLAND', 'SCOTLAND', 'WALES', 'NORTHERN IRELAND'],
  NL: ['THE NETHERLANDS', 'HOLLAND', 'NEDERLAND'],
  BE: ['BELGIË', 'BELGIE', 'BELGIQUE', 'BELGIEN'],
  DE: ['DEUTSCHLAND', 'GERMANY'],
  CH: ['SCHWEIZ', 'SUISSE', 'SVIZZERA'],
  AT: ['ÖSTERREICH', 'OSTERREICH'],
  FR: ['FRANCE'],
  ES: ['ESPAÑA', 'ESPANA'],
  IT: ['ITALIA'],
};

// The workshop lifecycle marketing emails (workshops/cron.ts) — counted, with
// broadcasts and course sequences, as "a marketing email" for the activity
// condition. Inlined: they are constants, not reader input.
const MARKETING_LIFECYCLE = [
  'abandoned_1', 'abandoned_2', 'course_abandoned_1', 'course_abandoned_2',
  'post_attended', 'post_attended_2', 'post_attended_3',
  'post_attended_pro', 'post_attended_pro_2', 'post_attended_pro_3',
  'post_no_show', 'post_no_show_2', 'post_no_show_3',
  'downsell_1', 'downsell_2', 'downsell_3',
];

const TYPE_LABEL: Record<Condition['type'], string> = {
  tag: 'Tag',
  field: 'Custom field',
  topic: 'Topic',
  country: 'Country',
  bought: 'Bought',
  booked: 'Booked',
  email: 'Email',
  activity: 'Email activity',
  newsletter: 'Newsletter signup',
  added: 'Added to the list',
};

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/;

export function isConditionGroup(x: Condition | ConditionGroup): x is ConditionGroup {
  return !!x && typeof x === 'object' && !('type' in x) && Array.isArray((x as ConditionGroup).conditions);
}

// ── Parsing ──────────────────────────────────────────────────────────────────

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// Check and normalise a rule set. Accepts an object or a JSON string; '' / null /
// undefined → rules null (tags mode). Tags are trimmed and lowercased, countries
// upper-cased ISO-2, days whole numbers 1–3650, ids positive integers. Errors
// name the condition: "Condition 3 (Email): pick a broadcast." An empty group is
// dropped (the builder makes one before its first condition).
export function parseSegmentRules(
  raw: unknown,
): { ok: true; rules: SegmentRules | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, rules: null };
  let v: unknown = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return { ok: true, rules: null };
    try {
      v = JSON.parse(s);
    } catch {
      return { ok: false, error: "The audience rules aren't valid JSON." };
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return { ok: false, error: 'The audience rules must be an object with a list of conditions.' };
  }
  const o = v as Record<string, unknown>;
  const match = parseMatch(o.match);
  if (!match) return { ok: false, error: 'Pick "all" or "any" for the audience rules.' };
  const list = o.conditions === undefined ? [] : o.conditions;
  if (!Array.isArray(list)) return { ok: false, error: 'The audience rules must hold a list of conditions.' };

  const out: Array<Condition | ConditionGroup> = [];
  let leaves = 0;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const n = String(i + 1);
    if (item && typeof item === 'object' && !Array.isArray(item) && !('type' in item)) {
      const g = item as Record<string, unknown>;
      const gm = parseMatch(g.match);
      if (!gm) return { ok: false, error: `Group ${n}: pick "all" or "any".` };
      const inner = g.conditions === undefined ? [] : g.conditions;
      if (!Array.isArray(inner)) return { ok: false, error: `Group ${n}: it must hold a list of conditions.` };
      const conds: Condition[] = [];
      for (let j = 0; j < inner.length; j++) {
        const x = inner[j];
        if (x && typeof x === 'object' && !Array.isArray(x) && !('type' in x)) {
          return { ok: false, error: `Group ${n}: a group can't hold another group.` };
        }
        const c = parseCondition(x, `${n}.${j + 1}`);
        if (!c.ok) return c;
        conds.push(c.value);
      }
      leaves += conds.length;
      if (conds.length) out.push({ match: gm, conditions: conds });
      continue;
    }
    const c = parseCondition(item, n);
    if (!c.ok) return c;
    leaves += 1;
    out.push(c.value);
  }
  if (leaves > SEGMENT_LIMITS.conditions) {
    return {
      ok: false,
      error: `Use at most ${SEGMENT_LIMITS.conditions} conditions (these rules have ${leaves}).`,
    };
  }
  return { ok: true, rules: { match, conditions: out } };
}

function parseMatch(v: unknown): Match | null {
  if (v === undefined || v === null || v === '') return 'all';
  return v === 'all' || v === 'any' ? v : null;
}

function parseCondition(raw: unknown, n: string): Parsed<Condition> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `Condition ${n}: it isn't a condition.` };
  }
  const o = raw as Record<string, unknown>;
  const type = String(o.type ?? '') as Condition['type'];
  if (!(type in TYPE_LABEL)) return { ok: false, error: `Condition ${n}: unknown kind “${String(o.type ?? '')}”.` };
  const label = `Condition ${n} (${TYPE_LABEL[type]})`;
  const fail = (msg: string): Parsed<Condition> => ({ ok: false, error: `${label}: ${msg}` });
  const op = String(o.op ?? '');

  switch (type) {
    case 'tag': {
      if (op !== 'any' && op !== 'none' && op !== 'all') return fail('pick “has any of”, “has none of” or “has all of”.');
      const tags = stringList(o.tags, (t) => t.toLowerCase());
      if (!tags.length) return fail('add at least one tag.');
      if (tags.length > SEGMENT_LIMITS.listItems) return fail(`use at most ${SEGMENT_LIMITS.listItems} tags.`);
      if (tags.some((t) => t.length > SEGMENT_LIMITS.text)) return fail(`a tag can be at most ${SEGMENT_LIMITS.text} characters.`);
      return { ok: true, value: { type, op, tags } };
    }
    case 'field': {
      const ops: FieldOp[] = ['eq', 'neq', 'contains', 'empty', 'not_empty', 'gt', 'lt'];
      if (!ops.includes(op as FieldOp)) return fail('pick how to compare the field.');
      const key = String(o.key ?? '').trim();
      if (!key) return fail('name the field.');
      if (key.length > SEGMENT_LIMITS.fieldKey) return fail(`a field name can be at most ${SEGMENT_LIMITS.fieldKey} characters.`);
      if (/["\\]/.test(key)) return fail('a field name can’t contain " or \\.');
      if (op === 'empty' || op === 'not_empty') return { ok: true, value: { type, key, op } };
      const value = String(o.value ?? '').trim();
      if (!value) return fail('give the value to compare with.');
      if (value.length > SEGMENT_LIMITS.text) return fail(`the value can be at most ${SEGMENT_LIMITS.text} characters.`);
      if ((op === 'gt' || op === 'lt') && !Number.isFinite(Number(value))) {
        return fail('“more than” and “less than” need a number.');
      }
      return { ok: true, value: { type, key, op: op as FieldOp, value } };
    }
    case 'topic': {
      if (op !== 'subscribed' && op !== 'left') return fail('pick “is subscribed to” or “has left”.');
      const topic = String(o.topic ?? '').trim().toLowerCase();
      if (!topic) return fail('pick a topic.');
      if (!TOPIC_KEY_RE.test(topic)) return fail(`unknown topic “${topic}”.`);
      return { ok: true, value: { type, op, topic } };
    }
    case 'country': {
      if (op !== 'in' && op !== 'not_in') return fail('pick “is one of” or “is not one of”.');
      const countries = stringList(o.countries, (c) => c.toUpperCase());
      if (!countries.length) return fail('pick at least one country.');
      if (countries.length > SEGMENT_LIMITS.listItems) return fail(`use at most ${SEGMENT_LIMITS.listItems} countries.`);
      const bad = countries.find((c) => !/^[A-Z]{2}$/.test(c) || !findCountry(c));
      if (bad) return fail(`unknown country code “${bad}”.`);
      return { ok: true, value: { type, op, countries } };
    }
    case 'bought': {
      const products: BoughtProduct[] = ['any', 'course', 'workshop', 'masterclass', 'retreat', 'album'];
      const product = String(o.product ?? '') as BoughtProduct;
      if (!products.includes(product)) return fail('pick what was bought.');
      const whens: BoughtWhen[] = ['ever', 'within', 'never', 'since_broadcast', 'not_since_broadcast'];
      const when = String(o.when ?? 'ever') as BoughtWhen;
      if (!whens.includes(when)) return fail('pick when.');
      const c: Extract<Condition, { type: 'bought' }> = { type, product, when };
      if (product === 'course' || product === 'retreat' || product === 'album') {
        const items = stringList(o.items, (s) => s.toLowerCase());
        if (items.length > SEGMENT_LIMITS.listItems) return fail(`pick at most ${SEGMENT_LIMITS.listItems}.`);
        if (product === 'course') {
          const bad = items.find((k) => !COURSE_BY_KEY.has(k));
          if (bad) return fail(`unknown course “${bad}”.`);
        } else {
          const bad = items.find((k) => !SLUG_RE.test(k));
          if (bad) return fail(`“${bad}” isn't a ${product === 'retreat' ? 'retreat' : 'album'} this list knows.`);
        }
        if (items.length) c.items = items;
      }
      if (when === 'within') {
        const d = parseDays(o.days);
        if (d === null) return fail(`the number of days must be a whole number from 1 to ${SEGMENT_LIMITS.days}.`);
        c.days = d;
      }
      if (when === 'since_broadcast' || when === 'not_since_broadcast') {
        const id = parseId(o.broadcastId);
        if (id === null) return fail('pick a broadcast.');
        c.broadcastId = id;
      }
      return { ok: true, value: c };
    }
    case 'booked': {
      const kind = String(o.kind ?? '');
      if (kind === 'workshop') {
        const id = parseId(o.workshopId);
        if (id === null) return fail('pick a session.');
        return { ok: true, value: { type, kind, workshopId: id } };
      }
      if (kind === 'retreat') {
        const slug = String(o.retreat ?? '').trim().toLowerCase();
        if (!slug) return fail('pick a retreat.');
        if (!SLUG_RE.test(slug)) return fail(`“${slug}” isn't a retreat this list knows.`);
        return { ok: true, value: { type, kind, retreat: slug } };
      }
      return fail('pick a workshop session or a retreat.');
    }
    case 'email': {
      const ops: EmailOp[] = ['received', 'opened', 'not_opened', 'clicked', 'not_clicked', 'clicked_link'];
      if (!ops.includes(op as EmailOp)) return fail('pick what they did with the email.');
      const id = parseId(o.broadcastId);
      if (id === null) return fail('pick a broadcast.');
      if (op === 'clicked_link') {
        const text = String(o.text ?? '').trim();
        if (!text) return fail('type part of the link.');
        if (text.length > SEGMENT_LIMITS.text) return fail(`the link text can be at most ${SEGMENT_LIMITS.text} characters.`);
        return { ok: true, value: { type, op, broadcastId: id, text } };
      }
      return { ok: true, value: { type, op: op as EmailOp, broadcastId: id } };
    }
    case 'activity': {
      if (op !== 'engaged' && op !== 'not_engaged') return fail('pick “opened or clicked” or “no open or click”.');
      const d = parseDays(o.days);
      if (d === null) return fail(`the number of days must be a whole number from 1 to ${SEGMENT_LIMITS.days}.`);
      return { ok: true, value: { type, op, days: d } };
    }
    case 'newsletter':
    case 'added': {
      const d = parseDays(o.days);
      if (d === null) return fail(`the number of days must be a whole number from 1 to ${SEGMENT_LIMITS.days}.`);
      return { ok: true, value: { type, days: d } };
    }
  }
}

// A list given as an array or a comma-separated string → trimmed, de-duplicated.
function stringList(v: unknown, norm: (s: string) => string): string[] {
  const parts = Array.isArray(v) ? v.map((x) => String(x ?? '')) : typeof v === 'string' ? v.split(',') : [];
  const seen = new Set<string>();
  for (const p of parts) {
    const s = norm(p.trim());
    if (s) seen.add(s);
  }
  return [...seen];
}

function parseDays(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > SEGMENT_LIMITS.days) return null;
  return n;
}
function parseId(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Probes ───────────────────────────────────────────────────────────────────

// Which tables the optional conditions need exist yet (a preview runs against
// production D1 before its migration): topic opt-outs (0099), link clicks
// (0097) and newsletter signups (0096). Trues are memoised.
const seen: SegmentFeatures = { topics: false, linkClicks: false, newsletter: false };
async function probeTable(db: D1Database, table: string): Promise<boolean> {
  try {
    await db.prepare(`SELECT 1 FROM ${table} LIMIT 0`).run();
    return true;
  } catch {
    return false;
  }
}
export async function segmentFeatures(db: D1Database): Promise<SegmentFeatures> {
  if (!seen.topics) seen.topics = await probeTable(db, 'email_topic_optouts');
  if (!seen.linkClicks) seen.linkClicks = await probeTable(db, 'email_link_clicks');
  if (!seen.newsletter) seen.newsletter = await probeTable(db, 'newsletter_signups');
  return { ...seen };
}

// ── Compiling ────────────────────────────────────────────────────────────────

type Bind = string | number;
type Frag = { sql: string; binds: Bind[] };

// Tagged template: each interpolated string/number becomes a `?` with its bind,
// each interpolated Frag is inlined with its binds — so the binds always come
// out in the order their `?` appear in the text.
function q(strings: TemplateStringsArray, ...vals: Array<Bind | Frag>): Frag {
  let sql = strings[0];
  const binds: Bind[] = [];
  vals.forEach((v, i) => {
    if (typeof v === 'object') {
      sql += v.sql;
      binds.push(...v.binds);
    } else {
      sql += '?';
      binds.push(v);
    }
    sql += strings[i + 1];
  });
  return { sql, binds };
}
function raw(sql: string): Frag {
  return { sql, binds: [] };
}
function joinFrags(frags: Frag[], sep: string): Frag {
  return { sql: frags.map((f) => f.sql).join(sep), binds: frags.flatMap((f) => f.binds) };
}
const daysAgo = (n: number) => `-${n} days`;
const json = (list: string[]) => JSON.stringify(list);

// Compile a rule set to one WHERE fragment against `contacts c` (no leading
// AND). '' when there are no conditions. Throws AudienceRulesError when a
// condition needs a table that isn't there yet, or the rules bind too much.
export function compileSegment(rules: SegmentRules, f: SegmentFeatures): Frag {
  const parts = rules.conditions.map((x) => (isConditionGroup(x) ? compileGroup(x, f) : compileCondition(x, f)));
  const nonEmpty = parts.filter((p) => p.sql);
  if (!nonEmpty.length) return { sql: '', binds: [] };
  const out = nonEmpty.length === 1 ? nonEmpty[0] : q`(${joinFrags(nonEmpty, rules.match === 'any' ? ' OR ' : ' AND ')})`;
  if (out.binds.length > SEGMENT_LIMITS.binds) {
    throw new AudienceRulesError(
      `These rules are too long (limit ${SEGMENT_LIMITS.binds} values per audience, these use ${out.binds.length}). Use fewer conditions.`,
    );
  }
  return out;
}

function compileGroup(g: ConditionGroup, f: SegmentFeatures): Frag {
  const parts = g.conditions.map((c) => compileCondition(c, f));
  if (!parts.length) return { sql: '', binds: [] };
  if (parts.length === 1) return parts[0];
  return q`(${joinFrags(parts, g.match === 'any' ? ' OR ' : ' AND ')})`;
}

function needs(label: string, migration: string): never {
  throw new AudienceRulesError(`“${label}” needs migration ${migration} (applied when merged).`);
}

// The broadcast's recipients who were actually sent it.
function receivedSub(id: number): Frag {
  return q`SELECT r.email FROM broadcast_recipients r WHERE r.broadcast_id = ${id} AND r.status = 'sent'`;
}
function engagedSub(id: number, col: 'first_opened_at' | 'first_clicked_at'): Frag {
  return q`SELECT r.email FROM broadcast_recipients r JOIN email_sends s ON s.resend_id = r.resend_id WHERE r.broadcast_id = ${id} AND r.status = 'sent' AND s.${raw(col)} IS NOT NULL`;
}

function compileCondition(c: Condition, f: SegmentFeatures): Frag {
  switch (c.type) {
    case 'tag': {
      if (c.op === 'all') {
        return q`c.email IN (SELECT t.email FROM contact_tags t WHERE t.tag IN (SELECT value FROM json_each(${json(c.tags)})) GROUP BY t.email HAVING COUNT(DISTINCT t.tag) = ${c.tags.length})`;
      }
      const sub = q`SELECT t.email FROM contact_tags t WHERE t.tag IN (SELECT value FROM json_each(${json(c.tags)}))`;
      return c.op === 'none' ? q`c.email NOT IN (${sub})` : q`c.email IN (${sub})`;
    }
    case 'field': {
      // The field's value as text; NULL when the contact has no such field (or
      // no readable custom JSON). Each use binds the key again.
      const F = () =>
        q`(CASE WHEN json_valid(c.custom) THEN CAST(json_extract(c.custom, '$."' || ${c.key} || '"') AS TEXT) END)`;
      const v = c.value ?? '';
      switch (c.op) {
        case 'eq':
          return q`lower(trim(${F()})) = lower(trim(${v}))`;
        case 'neq':
          return q`COALESCE(lower(trim(${F()})), '') <> lower(trim(${v}))`;
        case 'contains':
          return q`instr(lower(${F()}), lower(${v})) > 0`;
        case 'empty':
          return q`COALESCE(trim(${F()}), '') = ''`;
        case 'not_empty':
          return q`COALESCE(trim(${F()}), '') <> ''`;
        case 'gt':
          return q`(trim(${F()}) GLOB '*[0-9]*' AND CAST(${F()} AS REAL) > CAST(${v} AS REAL))`;
        case 'lt':
          return q`(trim(${F()}) GLOB '*[0-9]*' AND CAST(${F()} AS REAL) < CAST(${v} AS REAL))`;
      }
    }
    case 'topic': {
      if (!f.topics) needs('Topic', '0099');
      const sub = q`SELECT o.email FROM email_topic_optouts o WHERE o.topic = ${c.topic}`;
      return c.op === 'left' ? q`c.email IN (${sub})` : q`c.email NOT IN (${sub})`;
    }
    case 'country': {
      const names = new Set<string>();
      for (const code of c.countries) {
        names.add(code);
        const country = findCountry(code);
        if (country) names.add(country.name.toUpperCase());
        for (const a of COUNTRY_ALIASES[code] ?? []) names.add(a);
      }
      const col = raw(`upper(trim(COALESCE(c.country, '')))`);
      return c.op === 'not_in'
        ? q`${col} NOT IN (SELECT value FROM json_each(${json([...names])}))`
        : q`${col} IN (SELECT value FROM json_each(${json([...names])}))`;
    }
    case 'email': {
      const id = c.broadcastId;
      switch (c.op) {
        case 'received':
          return q`c.email IN (${receivedSub(id)})`;
        case 'opened':
          return q`c.email IN (${engagedSub(id, 'first_opened_at')})`;
        case 'clicked':
          return q`c.email IN (${engagedSub(id, 'first_clicked_at')})`;
        case 'not_opened':
          return q`(c.email IN (${receivedSub(id)}) AND c.email NOT IN (${engagedSub(id, 'first_opened_at')}))`;
        case 'not_clicked':
          return q`(c.email IN (${receivedSub(id)}) AND c.email NOT IN (${engagedSub(id, 'first_clicked_at')}))`;
        case 'clicked_link': {
          if (!f.linkClicks) needs('Email: clicked a link containing…', '0097');
          return q`c.email IN (SELECT r.email FROM broadcast_recipients r JOIN email_link_clicks k ON k.resend_id = r.resend_id WHERE r.broadcast_id = ${id} AND r.status = 'sent' AND k.likely_bot = 0 AND k.link_kind = 'content' AND instr(lower(k.url), lower(${c.text ?? ''})) > 0)`;
        }
      }
    }
    case 'activity': {
      const d = daysAgo(c.days);
      const types = raw(MARKETING_LIFECYCLE.map((t) => `'${t}'`).join(', '));
      const sub = q`SELECT lower(s.to_email) FROM email_sends s WHERE (s.email_type GLOB 'broadcast_*' OR s.email_type GLOB 'course_seq_*' OR s.email_type IN (${types})) AND (julianday(s.last_opened_at) >= julianday('now', ${d}) OR julianday(s.last_clicked_at) >= julianday('now', ${d}))`;
      return c.op === 'not_engaged' ? q`c.email NOT IN (${sub})` : q`c.email IN (${sub})`;
    }
    case 'newsletter': {
      if (!f.newsletter) needs('Newsletter signup', '0096');
      return q`c.email IN (SELECT n.email FROM newsletter_signups n WHERE julianday(n.signed_up_at) >= julianday('now', ${daysAgo(c.days)}))`;
    }
    case 'added':
      return q`julianday(c.created_at) >= julianday('now', ${daysAgo(c.days)})`;
    case 'booked': {
      if (c.kind === 'workshop') {
        return q`c.email IN (SELECT lower(wr.email) FROM workshop_registrations wr WHERE wr.workshop_id = ${c.workshopId ?? 0} AND wr.payment_status IN ('paid', 'coupon'))`;
      }
      return q`c.email IN (SELECT lower(rg.email) FROM registrations rg JOIN products pr ON pr.id = rg.product_id WHERE pr.slug = ${c.retreat ?? ''} AND rg.status = 'paid' AND COALESCE(rg.host, 0) = 0)`;
    }
    case 'bought':
      return compileBought(c);
  }
}

// A place purchases are read from: the buyer's address, the moment it was paid,
// the FROM clause and the WHERE that makes a row a purchase of this kind.
type Source = { email: string; time: string; from: string; where: Frag };

// A course row that holds money: paid, or cancelled after a charge (a partial
// refund stays 'paid').
const PAID_CR = `(cr.status = 'paid' OR (cr.status = 'cancelled' AND COALESCE(cr.installments_paid, 0) > 0))`;
const BUMPS_EACH = `course_registrations cr, json_each(CASE WHEN json_valid(cr.bumps) THEN cr.bumps ELSE '[]' END) bj`;
const LEDGER_FROM = `workshop_purchases p JOIN workshop_registrations wr ON wr.id = p.registration_id JOIN workshop_products wp ON wp.id = p.product_id`;
const SEAT_FROM = `workshop_registrations wr JOIN workshops w ON w.id = wr.workshop_id LEFT JOIN workshop_products mp ON mp.id = w.main_product_id`;
const SEAT_PAID = `wr.payment_status = 'paid' AND w.deleted = 0 AND w.status <> 'cancelled'`;
const RETREAT_FROM = `registrations rg JOIN products pr ON pr.id = rg.product_id`;
const RETREAT_PAID = `rg.status = 'paid' AND COALESCE(rg.host, 0) = 0 AND pr.type = 'retreat'`;
const COURSE_BUMP_SLUGS = SEGMENT_COURSES.map((c) => c.bump).filter((b): b is string => !!b);

function boughtSources(c: Extract<Condition, { type: 'bought' }>): Source[] {
  const items = c.items ?? [];
  const cr = (where: Frag): Source => ({ email: 'cr.email', time: 'cr.paid_at', from: 'course_registrations cr', where });
  const bumps = (slugs: string[]): Source => ({
    email: 'cr.email',
    time: 'cr.paid_at',
    from: BUMPS_EACH,
    where: q`cr.status = 'paid' AND json_extract(bj.value, '$.slug') IN (SELECT value FROM json_each(${json(slugs)}))`,
  });
  const ledger = (where: Frag): Source => ({ email: 'wr.email', time: 'p.created_at', from: LEDGER_FROM, where });
  const seats = (where: string): Source => ({ email: 'wr.email', time: 'wr.created_at', from: SEAT_FROM, where: raw(where) });
  const retreats = (where: Frag): Source => ({ email: 'rg.email', time: 'rg.paid_at', from: RETREAT_FROM, where });

  switch (c.product) {
    case 'any':
      return [cr(raw(PAID_CR)), seats(SEAT_PAID), retreats(raw(RETREAT_PAID))];
    case 'workshop':
      // "Bought" is money changing hands: a free coupon seat counts as booked, not bought.
      return [seats(`${SEAT_PAID} AND instr(COALESCE(mp.slug, ''), 'masterclass') = 0`)];
    case 'masterclass':
      return [seats(`${SEAT_PAID} AND instr(COALESCE(mp.slug, ''), 'masterclass') > 0`)];
    case 'retreat':
      return [
        retreats(
          items.length
            ? q`${raw(RETREAT_PAID)} AND pr.slug IN (SELECT value FROM json_each(${json(items)}))`
            : raw(RETREAT_PAID),
        ),
      ];
    case 'album':
      return [
        cr(
          items.length
            ? q`cr.status = 'paid' AND cr.product_slug IN (SELECT 'album-' || value FROM json_each(${json(items)}))`
            : raw(`cr.status = 'paid' AND cr.product_slug GLOB 'album-*'`),
        ),
      ];
    case 'course': {
      if (!items.length) {
        // Any course: every course row but an album, a course-checkout bump, or
        // a course line in the workshop ledger.
        return [
          cr(raw(`cr.product_slug NOT GLOB 'album-*' AND ${PAID_CR}`)),
          bumps(COURSE_BUMP_SLUGS),
          ledger(raw(`wr.payment_status = 'paid' AND p.product_type = 'course'`)),
        ];
      }
      const slugs = new Set<string>();
      const bumpSlugs = new Set<string>();
      const ledgerSlugs = new Set<string>();
      let prefix = false;
      for (const key of items) {
        const def = COURSE_BY_KEY.get(key);
        if (!def) continue;
        def.slugs.forEach((s) => slugs.add(s));
        if (def.prefix) prefix = true;
        if (def.bump) bumpSlugs.add(def.bump);
        def.ledger?.forEach((s) => ledgerSlugs.add(s));
      }
      const out: Source[] = [];
      if (slugs.size || prefix) {
        const match =
          slugs.size && prefix
            ? q`(cr.product_slug IN (SELECT value FROM json_each(${json([...slugs])})) OR cr.product_slug GLOB 'live-pass-*')`
            : slugs.size
              ? q`cr.product_slug IN (SELECT value FROM json_each(${json([...slugs])}))`
              : raw(`cr.product_slug GLOB 'live-pass-*'`);
        out.push(cr(q`${match} AND ${raw(PAID_CR)}`));
      }
      if (bumpSlugs.size) out.push(bumps([...bumpSlugs]));
      if (ledgerSlugs.size) {
        out.push(
          ledger(
            q`wr.payment_status = 'paid' AND p.product_type = 'course' AND wp.slug IN (SELECT value FROM json_each(${json([...ledgerSlugs])}))`,
          ),
        );
      }
      return out;
    }
  }
}

function compileBought(c: Extract<Condition, { type: 'bought' }>): Frag {
  const sources = boughtSources(c);
  if (!sources.length) return { sql: '', binds: [] };

  if (c.when === 'since_broadcast' || c.when === 'not_since_broadcast') {
    const id = c.broadcastId ?? 0;
    // Judged per person against their own send time, so a broadcast that drained
    // over days is fair to everyone. The purchase table drives (CROSS JOIN keeps
    // it the outer loop) and each purchase probes the recipient by the unique
    // (broadcast_id, email) index.
    const subs = sources.map(
      (s) =>
        q`SELECT r.email FROM ${raw(s.from)} CROSS JOIN broadcast_recipients r WHERE ${s.where} AND r.broadcast_id = ${id} AND r.email = lower(${raw(s.email)}) AND r.status = 'sent' AND julianday(${raw(s.time)}) >= julianday(r.sent_at)`,
    );
    const union = joinFrags(subs, ' UNION ');
    if (c.when === 'since_broadcast') return q`c.email IN (${union})`;
    // "Bought nothing since receiving it" only means something for people who
    // received it.
    return q`(c.email IN (${receivedSub(id)}) AND c.email NOT IN (${union}))`;
  }

  const subs = sources.map((s) =>
    c.when === 'within'
      ? q`SELECT lower(${raw(s.email)}) FROM ${raw(s.from)} WHERE ${s.where} AND julianday(${raw(s.time)}) >= julianday('now', ${daysAgo(c.days ?? 1)})`
      : q`SELECT lower(${raw(s.email)}) FROM ${raw(s.from)} WHERE ${s.where}`,
  );
  const union = joinFrags(subs, ' UNION ');
  return c.when === 'never' ? q`c.email NOT IN (${union})` : q`c.email IN (${union})`;
}

// ── Reading rules ────────────────────────────────────────────────────────────

function leaves(r: SegmentRules): Condition[] {
  return r.conditions.flatMap((x) => (isConditionGroup(x) ? x.conditions : [x]));
}

// Every tag a rule set names — what refreshBroadcastSegments is asked to
// freshen (workshop-passed-nonbuyer, in-drip, app:…) before a count or launch.
export function tagsInRules(r: SegmentRules | null | undefined): string[] {
  if (!r) return [];
  const out = new Set<string>();
  for (const c of leaves(r)) if (c.type === 'tag') c.tags.forEach((t) => out.add(t));
  return [...out];
}

// The broadcasts a rule set refers to (for naming them in describeSegment).
export function broadcastIdsInRules(r: SegmentRules | null | undefined): number[] {
  if (!r) return [];
  const out = new Set<number>();
  for (const c of leaves(r)) {
    if (c.type === 'email') out.add(c.broadcastId);
    if (c.type === 'bought' && c.broadcastId) out.add(c.broadcastId);
  }
  return [...out];
}

export type SegmentNames = {
  broadcasts?: Map<number, string>;
  topics?: Map<string, string>;
  workshops?: Map<number, string>;
  retreats?: Map<string, string>;
  albums?: Map<string, string>;
};

const FIELD_WORDS: Record<FieldOp, string> = {
  eq: 'equals',
  neq: 'does not equal',
  contains: 'contains',
  empty: 'is empty',
  not_empty: 'is not empty',
  gt: 'is more than',
  lt: 'is less than',
};

// The rules in words, e.g. "All of: received “Forgiveness is a paradox” (#14) ·
// did not open #14 · bought nothing since receiving #14". A broadcast is named
// in full the first time it comes up.
export function describeSegment(r: SegmentRules, names: SegmentNames = {}): string {
  const mentioned = new Set<number>();
  const bref = (id: number) => {
    const name = names.broadcasts?.get(id);
    if (name && !mentioned.has(id)) {
      mentioned.add(id);
      return `“${name}” (#${id})`;
    }
    mentioned.add(id);
    return `#${id}`;
  };
  const list = (xs: string[]) => xs.join(', ');
  const or = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : xs[0] ?? '');

  const what = (c: Extract<Condition, { type: 'bought' }>, nothing: boolean): string => {
    const items = c.items ?? [];
    switch (c.product) {
      case 'any':
        return nothing ? 'nothing' : 'anything';
      case 'workshop':
        return 'a workshop seat';
      case 'masterclass':
        return 'a masterclass seat';
      case 'course':
        return items.length ? or(items.map((k) => COURSE_BY_KEY.get(k)?.label ?? k)) : 'a course';
      case 'retreat':
        return items.length ? or(items.map((s) => names.retreats?.get(s) ?? s)) : 'a retreat';
      case 'album':
        return items.length ? or(items.map((s) => `the album ${names.albums?.get(s) ?? s}`)) : 'an album';
    }
  };

  const one = (c: Condition): string => {
    switch (c.type) {
      case 'tag':
        return `${c.op === 'any' ? 'has any of' : c.op === 'none' ? 'has none of' : 'has all of'} the tags ${list(c.tags)}`;
      case 'field':
        return `“${c.key}” ${FIELD_WORDS[c.op]}${c.op === 'empty' || c.op === 'not_empty' ? '' : ` “${c.value ?? ''}”`}`;
      case 'topic': {
        const name = names.topics?.get(c.topic) ?? c.topic;
        return c.op === 'left' ? `left “${name}”` : `subscribed to “${name}”`;
      }
      case 'country':
        return `country ${c.op === 'in' ? 'is one of' : 'is not one of'} ${list(c.countries)}`;
      case 'bought': {
        const id = c.broadcastId ?? 0;
        switch (c.when) {
          case 'ever':
            return `bought ${what(c, false)}`;
          case 'within':
            return `bought ${what(c, false)} in the last ${c.days} days`;
          case 'never':
            return c.product === 'any' ? 'never bought anything' : `never bought ${what(c, false)}`;
          case 'since_broadcast':
            return `bought ${what(c, false)} since receiving ${bref(id)}`;
          case 'not_since_broadcast':
            return c.product === 'any'
              ? `bought nothing since receiving ${bref(id)}`
              : `did not buy ${what(c, false)} since receiving ${bref(id)}`;
        }
      }
      case 'booked':
        return c.kind === 'workshop'
          ? `booked ${names.workshops?.get(c.workshopId ?? 0) ?? `session #${c.workshopId}`}`
          : `booked ${names.retreats?.get(c.retreat ?? '') ?? c.retreat}`;
      case 'email': {
        const b = bref(c.broadcastId);
        switch (c.op) {
          case 'received':
            return `received ${b}`;
          case 'opened':
            return `opened ${b}`;
          case 'not_opened':
            return `received ${b} and did not open it`;
          case 'clicked':
            return `clicked in ${b}`;
          case 'not_clicked':
            return `received ${b} and did not click`;
          case 'clicked_link':
            return `clicked a link containing “${c.text ?? ''}” in ${b}`;
        }
      }
      case 'activity':
        return c.op === 'engaged'
          ? `opened or clicked a marketing email in the last ${c.days} days`
          : `no open or click in the last ${c.days} days`;
      case 'newsletter':
        return `signed up to the newsletter in the last ${c.days} days`;
      case 'added':
        return `added to the list in the last ${c.days} days`;
    }
  };

  if (!r.conditions.length) return 'The whole sendable list (no conditions)';
  const parts = r.conditions.map((x) =>
    isConditionGroup(x) ? `(${x.match === 'any' ? 'any' : 'all'} of: ${x.conditions.map(one).join(' · ')})` : one(x),
  );
  return `${r.match === 'any' ? 'Any' : 'All'} of: ${parts.join(' · ')}`;
}

// The audience of a "resend to non-openers" draft: received broadcast N and
// neither opened nor clicked it — optionally also bought nothing since.
export function resendUnopenedRules(broadcastId: number, excludeBuyers: boolean): SegmentRules {
  const conditions: Condition[] = [
    { type: 'email', op: 'received', broadcastId },
    { type: 'email', op: 'not_opened', broadcastId },
    { type: 'email', op: 'not_clicked', broadcastId },
  ];
  if (excludeBuyers) conditions.push({ type: 'bought', product: 'any', when: 'not_since_broadcast', broadcastId });
  return { match: 'all', conditions };
}
