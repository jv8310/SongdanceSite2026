// The site's half of the member app's broadcast tools (songdance-app MCP
// `broadcast_*`), so Claude can do what /admin/broadcasts does: see the tags
// and how many people each reaches, write a draft with its audience set, show
// the email as it will arrive, send a test, and launch or schedule it. Reached
// only through the AppBridge entrypoint (src/worker-entrypoint.ts), never over
// HTTP. Every function here is the admin pages' own code (broadcasts/db.ts,
// broadcasts/email.ts); nothing is a second implementation.
//
// Sending moves mail to thousands of inboxes and cannot be taken back, so it
// takes a typed confirmation, always, checked here against the audience as it
// stands at that moment (after the app's tags have been asked for again):
//   SEND <id> <count>       launch a draft now; <count> = who it reaches now
//   SCHEDULE <id> <count>   launch a draft later; the audience is taken again then
//   RESUME <id> <pending>   carry on a paused broadcast; <pending> = still to send
// Any other figure moves nothing, and the answer says the figure it expected.
// Holding (pausing, or cancelling a schedule) needs no confirmation.
//
// Answers are plain data ({ ok: true, … } | { ok: false, error, message }): an
// Error crossing an RPC boundary keeps its message and loses its code.
//
// The sender (0098), topic (0099) and segment rules (0100) are optional fields
// on every call: the app's tools that send none of them behave exactly as
// before. A save that names one writes it through saveBroadcastExtras (its own
// guarded statement), and asking for one the database can't hold yet answers
// `needs-migration` before anything is written. The last audience written
// wins: tags given without rules on a rules broadcast switch it back to tags.

import {
  audienceTags,
  availableTags,
  broadcastColumnsReady,
  broadcastCriteria,
  broadcastEmailType,
  broadcastStats,
  countAudienceChecked,
  countContacts,
  countSendable,
  createBroadcast,
  criteriaUseRules,
  getBroadcast,
  launchBroadcast,
  listBroadcasts,
  pauseBroadcast,
  pendingCount,
  recipientCounts,
  resumeBroadcast,
  saveBroadcastExtras,
  setBroadcastScheduledAt,
  splitTags,
  updateBroadcast,
  type AudienceCriteria,
  type Broadcast,
  type BroadcastExtras,
  type BroadcastInput,
} from '../broadcasts/db';
import {
  AudienceRulesError,
  compileSegment,
  describeSegment,
  parseSegmentRules,
  segmentFeatures,
  type SegmentRules,
} from '../broadcasts/segment-rules';
import { segmentNames } from '../broadcasts/segment-catalog';
import { previewBroadcast, renderBroadcast } from '../broadcasts/email';
import { refreshBroadcastSegments, type SegmentRefreshResult } from '../broadcasts/segment-refresh';
import { appTagSyncState, isAppTag, syncAppTags, usesAppTags } from '../broadcasts/app-tags';
import { sendEmail } from '../workshops/resend';
import { broadcastSender, resolveSenderInput } from '../broadcasts/sender';
import { getTopic, listTopics, topicsByKey, TOPIC_KEY_RE, type EmailTopic } from '../email/topics';
import { preferencesPageUrl, unsubscribeSecret } from '../email/unsubscribe';
import { logEventSafe } from '../registrations/db';
import { broadcastLinkClicks } from '../email/link-clicks';

type BridgeEnv = {
  DB: D1Database;
  APP_ADMIN?: unknown;
  RESEND_API_KEY?: string;
  PUBLIC_BASE_URL: string;
  MARKETING_FROM?: string;
  MARKETING_REPLY_TO?: string;
  UNSUBSCRIBE_SECRET?: string;
  ADMIN_SESSION_SECRET?: string;
};

type Fail = { ok: false; error: string; message: string };
const fail = (error: string, message: string): Fail => ({ ok: false, error, message });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 86_400_000;
/** How far ahead a launch may be scheduled from the app. */
const MAX_SCHEDULE_DAYS = 90;

const actorOf = (v: unknown) => String(v ?? '').trim().slice(0, 120) || 'unknown';
const base = (env: BridgeEnv) => (env.PUBLIC_BASE_URL || 'https://songdance.co').replace(/\/$/, '');
const adminUrl = (env: BridgeEnv, id: number) => `${base(env)}/admin/broadcasts/${id}`;

// "Tue, 3 Nov 2026, 09:00 Brussels time": the business clock.
function brussels(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (!Number.isFinite(ms)) return iso;
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
  return `${f} Brussels time`;
}

// Tags arrive as a list or a comma-separated string; stored comma-separated.
function tagField(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const raw = Array.isArray(v) ? v.map((t) => String(t ?? '')).join(',') : String(v);
  const tags = splitTags(raw);
  return tags.length ? tags.join(', ') : null;
}

// A broadcast's criteria come from broadcastCriteria (broadcasts/db.ts), the
// same mapping the admin count and the launch snapshot use — so the SEND
// confirmation always names the audience the snapshot will take (topic
// opt-outs included).

// Tags the criteria name that no contact carries: almost always a typo. The
// list is bound once as JSON, so its length never meets D1's parameter cap.
async function unknownTags(db: D1Database, c: AudienceCriteria): Promise<string[]> {
  const tags = [...audienceTags(c)];
  if (!tags.length) return [];
  const r = await db
    .prepare(`SELECT DISTINCT tag FROM contact_tags WHERE tag IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(tags))
    .all<{ tag: string }>();
  const known = new Set((r.results ?? []).map((t) => t.tag));
  return tags.filter((t) => !known.has(t));
}

// A broadcast as the app lists it. Synchronous: it runs for every row of a
// list, so the topic names come in a map loaded once (topicsByKey) and the
// rules are only described in detail().
function summary(env: BridgeEnv, b: Broadcast, topics: Map<string, EmailTopic>) {
  const c = broadcastCriteria(b);
  const sender = broadcastSender(b, env);
  return {
    id: b.id,
    name: b.name,
    subject: b.subject,
    status: b.status,
    format: b.format,
    createdAt: b.created_at,
    startedAt: b.started_at,
    completedAt: b.completed_at,
    scheduledAt: b.scheduled_at,
    scheduledWhen: brussels(b.scheduled_at),
    pausedReason: b.paused_reason,
    sender: {
      from: sender.from,
      replyTo: sender.replyTo,
      custom: !sender.isDefault,
      fromName: b.from_name ?? null,
      fromLocal: b.from_local ?? null,
    },
    topic: b.topic ? { key: b.topic, name: topics.get(b.topic)?.name ?? b.topic } : null,
    audience: {
      // 'rules': the segment rules decide and the tag fields below are kept
      // but ignored; 'tags': include/exclude/field as always.
      mode: criteriaUseRules(c) ? ('rules' as const) : ('tags' as const),
      rules: c.rules ?? null,
      rulesError: c.rulesError ?? null,
      includeTags: splitTags(b.audience_include_tags),
      excludeTags: splitTags(b.audience_exclude_tags),
      field: b.audience_field,
      fieldValue: b.audience_field_value,
    },
    resendOf: b.resend_of ?? null,
    window: { startHour: b.window_start_hour, endHour: b.window_end_hour, urgent: !!b.urgent },
    stopAt: b.stop_at,
    adminUrl: adminUrl(env, b.id),
  };
}

async function detail(env: BridgeEnv, b: Broadcast) {
  const c = broadcastCriteria(b);
  const [counted, queue, stats, unknown, topics, names, clicks] = await Promise.all([
    countAudienceChecked(env.DB, c),
    b.status === 'draft' ? Promise.resolve(null) : recipientCounts(env.DB, b.id),
    b.status === 'draft' ? Promise.resolve(null) : broadcastStats(env.DB, broadcastEmailType(b.id)),
    unknownTags(env.DB, c),
    topicsByKey(env.DB),
    c.rules ? segmentNames(env.DB, c.rules) : Promise.resolve(null),
    b.status === 'draft' ? Promise.resolve(null) : broadcastLinkClicks(env.DB, b.id),
  ]);
  const head = summary(env, b, topics);
  return {
    ...head,
    audience: {
      ...head.audience,
      description: c.rules ? describeSegment(c.rules, names ?? {}) : null,
    },
    preheader: b.preheader,
    heading: b.heading,
    body: b.body,
    bodyText: b.body_text,
    heroImage: b.hero_image,
    ctaLabel: b.cta_label,
    ctaHref: b.cta_href,
    // 0 when it can't be counted; audienceError then says why (unreadable or
    // uncompilable rules — a launch would be refused, never sent to everyone).
    audienceNow: 'count' in counted ? counted.count : 0,
    audienceError: 'error' in counted ? counted.error : null,
    unknownTags: unknown,
    queue,
    stats,
    // Clicks per link (migration 0097, src/lib/email/link-clicks.ts): null on a
    // draft or before 0097, else the broadcast page's own table, most-clicked first.
    links: clicks && clicks.ready ? clicks.rows : null,
  };
}

// ── Reading ─────────────────────────────────────────────────────────────────

export async function broadcastTagsForApp(env: BridgeEnv, input: { query?: unknown; limit?: unknown; refresh?: unknown }) {
  let appTags = null;
  if (input?.refresh === true) appTags = await syncAppTags(env);
  const q = String(input?.query ?? '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(500, Number(input?.limit) || 100));
  const all = await availableTags(env.DB, 5000);
  const app = all.filter((t) => isAppTag(t.tag));
  const rest = all.filter((t) => !isAppTag(t.tag) && (!q || t.tag.includes(q)));
  const [contacts, sendable, sync, topics] = await Promise.all([
    countContacts(env.DB),
    countSendable(env.DB),
    appTagSyncState(env.DB),
    listTopics(env.DB),
  ]);
  return {
    ok: true as const,
    contacts,
    sendable,
    // The email topics a broadcast may name (saveBroadcast `topic`); [] before 0099.
    topics: topics.map((t) => ({ key: t.key, name: t.name, description: t.description })),
    appTags: app.filter((t) => !q || t.tag.includes(q)),
    appTagSync: appTags ?? sync,
    tags: rest.slice(0, limit),
    more: rest.length > limit,
  };
}

// How many an audience reaches now: tags (include/exclude/field) or, when
// `rules` is given, segment rules instead — and, with `topic`, minus everyone
// who left that topic. The same count the SEND confirmation will ask for.
export async function broadcastAudienceForApp(
  env: BridgeEnv,
  input: {
    includeTags?: unknown;
    excludeTags?: unknown;
    field?: unknown;
    fieldValue?: unknown;
    refresh?: unknown;
    rules?: unknown;
    topic?: unknown;
  },
) {
  const topic = await checkTopic(env.DB, input?.topic);
  if (topic && 'ok' in topic) return topic;
  const parsed = rulesInput(input?.rules);
  if (parsed && !parsed.ok) return fail('bad-rules', parsed.error);
  const rules = parsed?.rules ?? null;
  const c: AudienceCriteria = rules
    ? { rules, topic: topic?.key ?? null }
    : {
        includeTags: tagField(input?.includeTags) ?? null,
        excludeTags: tagField(input?.excludeTags) ?? null,
        field: String(input?.field ?? '').trim() || null,
        fieldValue: String(input?.fieldValue ?? '').trim() || null,
        topic: topic?.key ?? null,
      };
  let refreshed: SegmentRefreshResult | null = null;
  if (input?.refresh === true) refreshed = await refreshBroadcastSegments(env.DB, audienceTags(c), env);
  const [counted, sendable, unknown] = await Promise.all([
    countAudienceChecked(env.DB, c),
    countSendable(env.DB),
    unknownTags(env.DB, c),
  ]);
  if ('error' in counted) return fail('bad-rules', counted.error);
  return {
    ok: true as const,
    mode: rules ? ('rules' as const) : ('tags' as const),
    count: counted.count,
    sendable,
    unknownTags: unknown,
    refreshed,
  };
}

// The rules a caller passed: undefined → not given (null), '' / null → tags
// mode ({ ok, rules: null }), else parsed and dry-compiled against the tables
// this database has — an error comes back as words.
function rulesInput(raw: unknown): { ok: true; rules: SegmentRules | null } | { ok: false; error: string } | null {
  if (raw === undefined) return null;
  const json = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null) ?? '';
  if (json.length > RULES_MAX) {
    return { ok: false, error: `rules may be at most ${RULES_MAX.toLocaleString('en')} characters as JSON.` };
  }
  const parsed = parseSegmentRules(raw);
  if (!parsed.ok) return parsed;
  return parsed;
}
async function compileCheck(db: D1Database, rules: SegmentRules): Promise<string | null> {
  try {
    compileSegment(rules, await segmentFeatures(db));
    return null;
  } catch (err) {
    if (err instanceof AudienceRulesError) return err.message;
    return `The rules could not be compiled: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`;
  }
}

// A topic key a caller passed: undefined/''/null → null (no topic); a known
// active topic → { key }; anything else → a Fail naming the topics there are.
async function checkTopic(db: D1Database, raw: unknown): Promise<{ key: string } | Fail | null> {
  if (raw === undefined || raw === null) return null;
  const key = String(raw).trim();
  if (!key) return null;
  const topics = await listTopics(db);
  if (!topics.length) return fail('needs-migration', 'Email topics need migration 0099 (applied when merged), so a topic cannot be used yet.');
  const t = TOPIC_KEY_RE.test(key) ? topics.find((x) => x.key === key) : undefined;
  if (!t) return fail('bad-topic', `Unknown topic "${key.slice(0, 40)}". Topics: ${topics.map((x) => `${x.key} (${x.name})`).join(', ')}.`);
  return { key: t.key };
}

export async function broadcastsForApp(env: BridgeEnv, input: { limit?: unknown; status?: unknown }) {
  const limit = Math.max(1, Math.min(100, Number(input?.limit) || 20));
  const status = String(input?.status ?? '').trim();
  const all = (await listBroadcasts(env.DB)).filter((b) => !status || b.status === status);
  const topics = await topicsByKey(env.DB);
  return { ok: true as const, broadcasts: all.slice(0, limit).map((b) => summary(env, b, topics)), more: all.length > limit };
}

export async function broadcastForApp(env: BridgeEnv, input: { id?: unknown }) {
  const b = await getBroadcast(env.DB, Number(input?.id));
  if (!b) return fail('not-found', `No broadcast ${String(input?.id)}.`);
  return { ok: true as const, broadcast: await detail(env, b) };
}

// The email as it will arrive: as a contact on the list (their name and their
// own unsubscribe link) or, with no address, as the sample reader "Maria".
export async function previewBroadcastForApp(env: BridgeEnv, input: { id?: unknown; as?: unknown }) {
  const b = await getBroadcast(env.DB, Number(input?.id));
  if (!b) return fail('not-found', `No broadcast ${String(input?.id)}.`);
  const as = String(input?.as ?? '').trim().toLowerCase();
  const topic = b.topic ? await getTopic(env.DB, b.topic) : null;
  if (!as) {
    const content = previewBroadcast(b, base(env), topic?.name ?? null);
    return { ok: true as const, id: b.id, as: null, firstName: 'Maria', subject: content.subject, preheader: b.preheader || b.subject, html: content.html, text: content.text };
  }
  if (!EMAIL_RE.test(as)) return fail('bad-email', `"${as}" is not an email address.`);
  const contact = await env.DB.prepare('SELECT name FROM contacts WHERE email = ?').bind(as).first<{ name: string | null }>();
  const firstName = (contact?.name ?? '').trim().split(/\s+/)[0] || as.split('@')[0] || 'friend';
  const secret = unsubscribeSecret(env);
  const unsub = secret ? await preferencesPageUrl(base(env), secret, as, topic?.key) : undefined;
  const content = renderBroadcast(b, { firstName, unsubscribeUrl: unsub, email: as, topicName: topic?.name ?? null });
  return {
    ok: true as const,
    id: b.id,
    as,
    onList: !!contact,
    firstName,
    subject: content.subject,
    preheader: b.preheader || b.subject,
    html: content.html,
    text: content.text,
  };
}

// ── Writing ─────────────────────────────────────────────────────────────────

export type SaveBroadcastInput = {
  id?: number | null;
  name?: string;
  subject?: string;
  preheader?: string | null;
  heading?: string;
  body?: string;
  format?: 'simple' | 'html';
  bodyText?: string | null;
  heroImage?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  includeTags?: string[] | string | null;
  excludeTags?: string[] | string | null;
  field?: string | null;
  fieldValue?: string | null;
  windowStartHour?: number;
  windowEndHour?: number;
  // 0098 — the sender: a name and the part before the @ (the domain is always
  // the marketing domain), and a reply-to. Both name and address null = the
  // default sender; reply-to null = support@songdance.co.
  fromName?: string | null;
  fromLocal?: string | null;
  replyTo?: string | null;
  // 0099 — an email_topics key (broadcastTags lists them); null = no topic.
  topic?: string | null;
  // 0100 — segment rules (an object or its JSON); null = back to the tags.
  rules?: SegmentRules | string | null;
  actor?: string;
};

const LIMITS: Record<string, number> = {
  name: 200,
  subject: 300,
  preheader: 300,
  heading: 300,
  body: 200_000,
  bodyText: 100_000,
  heroImage: 500,
  ctaLabel: 100,
  ctaHref: 1000,
  field: 100,
  fieldValue: 300,
  fromName: 80,
  fromLocal: 64,
  replyTo: 254,
  topic: 32,
};
// `rules` is an object, so LIMITS (which measures strings) can't check it:
// its JSON is measured on its own.
const RULES_MAX = 20_000;

// A link the email may carry: our own path or an https address.
const okLink = (v: string) => /^https:\/\/[^\s"'<>]+$/i.test(v) || /^\/[^\s"'<>]*$/.test(v);

export async function saveBroadcastFromApp(env: BridgeEnv, input: SaveBroadcastInput) {
  const p = (input ?? {}) as Record<string, unknown>;
  const actor = actorOf(p.actor);
  const id = Number(p.id) > 0 ? Math.floor(Number(p.id)) : null;
  for (const [k, max] of Object.entries(LIMITS)) {
    const v = p[k];
    if (v != null && String(v).length > max) return fail('too-long', `${k} may be at most ${max.toLocaleString('en')} characters.`);
  }
  // undefined = leave as it is (an edit), null or '' = clear it.
  const str = (v: unknown): string | null | undefined => (v === undefined ? undefined : String(v ?? '').trim() || null);

  const existing = id ? await getBroadcast(env.DB, id) : null;
  if (id && !existing) return fail('not-found', `No broadcast ${id}.`);
  if (existing && existing.status !== 'draft' && existing.status !== 'paused') {
    return fail(
      'not-editable',
      existing.status === 'done'
        ? `Broadcast ${id} has finished and can no longer be changed.`
        : `Broadcast ${id} is sending. Pause it first (broadcast_hold), then change it: the change reaches everyone not sent yet.`,
    );
  }

  const pick = <T>(given: T | undefined, current: T): T => (given === undefined ? current : given);
  const format = p.format === undefined ? (existing?.format ?? 'simple') : p.format === 'html' ? 'html' : 'simple';
  const fields: BroadcastInput = {
    name: pick(str(p.name), existing?.name ?? null) ?? '',
    subject: pick(str(p.subject), existing?.subject ?? null) ?? '',
    preheader: pick(str(p.preheader), existing?.preheader ?? null),
    heading: pick(str(p.heading), existing?.heading ?? null) ?? '',
    body: pick(p.body === undefined ? undefined : String(p.body ?? '').trim(), existing?.body ?? '') ?? '',
    format,
    body_text: pick(str(p.bodyText), existing?.body_text ?? null),
    hero_image: pick(str(p.heroImage), existing?.hero_image ?? null),
    cta_label: pick(str(p.ctaLabel), existing?.cta_label ?? null),
    cta_href: pick(str(p.ctaHref), existing?.cta_href ?? null),
    window_start_hour: p.windowStartHour === undefined ? (existing?.window_start_hour ?? 8) : Number(p.windowStartHour),
    window_end_hour: p.windowEndHour === undefined ? (existing?.window_end_hour ?? 21) : Number(p.windowEndHour),
    audience_include_tags: pick(tagField(p.includeTags), existing?.audience_include_tags ?? null),
    audience_exclude_tags: pick(tagField(p.excludeTags), existing?.audience_exclude_tags ?? null),
    audience_field: pick(str(p.field), existing?.audience_field ?? null),
    audience_field_value: pick(str(p.fieldValue), existing?.audience_field_value ?? null),
  };
  if (format === 'html' && !fields.heading) fields.heading = fields.name;
  if (!fields.name || !fields.subject || !fields.heading || !fields.body) {
    return fail('missing', 'A broadcast needs a name, a subject, a heading (simple format) and a body.');
  }
  if (fields.cta_href && !okLink(fields.cta_href)) return fail('bad-link', 'The button link must be an https:// address or a path on songdance.co.');
  if (fields.hero_image && !okLink(fields.hero_image)) return fail('bad-link', 'The picture must be an https:// address or a /media/… path.');
  if ((fields.cta_label && !fields.cta_href) || (!fields.cta_label && fields.cta_href)) {
    return fail('missing', 'A button needs both its words (ctaLabel) and its link (ctaHref).');
  }
  if (fields.audience_field && !fields.audience_field_value) return fail('missing', 'A field filter needs both the field and the value.');

  // The later columns: every one checked before anything is written, and one
  // the database can't hold yet refused rather than dropped.
  const extras: BroadcastExtras = {};
  const ready = await broadcastColumnsReady(env.DB);
  if (p.fromName !== undefined || p.fromLocal !== undefined || p.replyTo !== undefined) {
    if (!ready.sender) return fail('needs-migration', 'A sender per broadcast needs migration 0098 (applied when merged). Nothing was saved.');
    // Given values over what the broadcast has now; both name and address
    // empty = the default sender.
    const given = <T>(v: unknown, current: T) => (v === undefined ? current : v);
    const sender = resolveSenderInput({
      preset: 'custom',
      from_name: given(p.fromName, existing?.from_name ?? null) ?? '',
      from_local: given(p.fromLocal, existing?.from_local ?? null) ?? '',
      reply_to: given(p.replyTo, existing?.reply_to ?? null) ?? '',
    });
    if (!sender.ok) return fail('bad-sender', `${sender.error} Nothing was saved.`);
    Object.assign(extras, sender.fields);
  }
  if (p.topic !== undefined) {
    if (p.topic !== null && String(p.topic).trim()) {
      if (!ready.topic) return fail('needs-migration', 'Email topics need migration 0099 (applied when merged). Nothing was saved.');
      const t = await checkTopic(env.DB, p.topic);
      if (t && 'ok' in t) return t;
      extras.topic = t?.key ?? null;
    } else if (ready.topic) {
      extras.topic = null;
    }
  }
  const rulesGiven = rulesInput(p.rules);
  if (rulesGiven) {
    if (!rulesGiven.ok) return fail('bad-rules', `${rulesGiven.error} Nothing was saved.`);
    if (rulesGiven.rules) {
      if (!ready.rules) return fail('needs-migration', 'Audience rules need migration 0100 (applied when merged). Nothing was saved.');
      const err = await compileCheck(env.DB, rulesGiven.rules);
      if (err) return fail('bad-rules', `${err} Nothing was saved.`);
      extras.audience_rules = JSON.stringify(rulesGiven.rules);
    } else if (ready.rules) {
      extras.audience_rules = null;
    }
  } else if (
    existing &&
    criteriaUseRules(broadcastCriteria(existing)) &&
    (p.includeTags !== undefined || p.excludeTags !== undefined || p.field !== undefined || p.fieldValue !== undefined)
  ) {
    // The last audience written wins: tags just written replace the rules.
    extras.audience_rules = null;
  }

  let saved: number;
  if (existing) {
    await updateBroadcast(env.DB, existing.id, fields);
    saved = existing.id;
  } else {
    saved = await createBroadcast(env.DB, fields);
    if (!saved) return fail('server-error', 'The draft could not be saved.');
  }
  // Only the groups a field was given for are written (a key left undefined
  // writes nothing), so a call with the old fields alone touches none of them.
  const { skipped } = Object.keys(extras).length
    ? await saveBroadcastExtras(env.DB, saved, extras)
    : { skipped: [] as string[] };
  await logEventSafe(env.DB, {
    registration_id: null,
    kind: existing ? 'app.broadcast.updated' : 'app.broadcast.created',
    source: 'app',
    payload: {
      broadcastId: saved,
      actor,
      fields: Object.keys(p).filter((k) => k !== 'actor' && k !== 'id'),
      ...(skipped.length ? { skipped } : {}),
    },
  });
  const b = await getBroadcast(env.DB, saved);
  return {
    ok: true as const,
    created: !existing,
    ...(skipped.length
      ? { warning: `Saved, but the ${skipped.join(' and ')} could not be written. Check the broadcast before sending.` }
      : {}),
    broadcast: await detail(env, b!),
  };
}

export async function testBroadcastFromApp(env: BridgeEnv, input: { id?: unknown; to?: unknown; actor?: unknown }) {
  const to = String(input?.to ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return fail('bad-email', `"${to}" is not an email address.`);
  if (!env.RESEND_API_KEY) return fail('not-configured', 'RESEND_API_KEY is not set on songdance.co.');
  const b = await getBroadcast(env.DB, Number(input?.id));
  if (!b) return fail('not-found', `No broadcast ${String(input?.id)}.`);
  const contact = await env.DB.prepare('SELECT name FROM contacts WHERE email = ?').bind(to).first<{ name: string | null }>();
  const firstName = (contact?.name ?? '').trim().split(/\s+/)[0] || to.split('@')[0] || 'friend';
  const secret = unsubscribeSecret(env);
  const topic = b.topic ? await getTopic(env.DB, b.topic) : null;
  const unsub = secret ? await preferencesPageUrl(base(env), secret, to, topic?.key) : undefined;
  const content = renderBroadcast(b, { firstName, unsubscribeUrl: unsub, email: to, topicName: topic?.name ?? null });
  const { from, replyTo } = broadcastSender(b, env);
  try {
    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      from,
      replyTo,
      to,
      subject: `[Test] ${content.subject}`,
      html: content.html,
      text: content.text,
      entityRefId: `broadcast-test-${b.id}`,
    });
  } catch (err) {
    return fail('send-failed', `Resend refused the test: ${String(err).slice(0, 300)}`);
  }
  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'app.broadcast.test_sent',
    source: 'app',
    payload: { broadcastId: b.id, to, actor: actorOf(input?.actor) },
  });
  return { ok: true as const, id: b.id, sentTo: to, subject: `[Test] ${content.subject}` };
}

// ── Sending ─────────────────────────────────────────────────────────────────

/** Pure: "SEND 12 1,912" → { verb: 'SEND', id: 12, count: 1912 }; null when it is not that shape. */
export function parseSendConfirm(raw: unknown): { verb: 'SEND' | 'SCHEDULE' | 'RESUME'; id: number; count: number } | null {
  const m = String(raw ?? '')
    .trim()
    .toUpperCase()
    .match(/^(SEND|SCHEDULE|RESUME)\s+#?(\d+)\s+(\d{1,3}(?:[,.\s]\d{3})*|\d+)$/);
  if (!m) return null;
  return { verb: m[1] as 'SEND' | 'SCHEDULE' | 'RESUME', id: Number(m[2]), count: Number(m[3].replace(/[,.\s]/g, '')) };
}

export async function sendBroadcastFromApp(
  env: BridgeEnv,
  input: { id?: unknown; at?: unknown; confirm?: unknown; actor?: unknown },
) {
  const actor = actorOf(input?.actor);
  const id = Number(input?.id);
  const b = Number.isFinite(id) && id > 0 ? await getBroadcast(env.DB, id) : null;
  if (!b) return fail('not-found', `No broadcast ${String(input?.id)}.`);
  if (!env.RESEND_API_KEY) return fail('not-configured', 'RESEND_API_KEY is not set on songdance.co, so nothing could go out.');

  const atRaw = String(input?.at ?? '').trim();
  const verb: 'SEND' | 'SCHEDULE' | 'RESUME' = b.status === 'paused' ? 'RESUME' : atRaw ? 'SCHEDULE' : 'SEND';
  if (b.status === 'sending') return fail('already-sending', `Broadcast ${b.id} is already sending.`);
  if (b.status === 'done') return fail('done', `Broadcast ${b.id} has finished.`);
  if (verb === 'RESUME' && atRaw) return fail('bad-request', `Broadcast ${b.id} is paused: it can be resumed now, not scheduled.`);

  let atIso: string | null = null;
  if (verb === 'SCHEDULE') {
    const ms = Date.parse(atRaw);
    if (!Number.isFinite(ms) || !/(Z|[+-]\d{2}:?\d{2})$/i.test(atRaw)) {
      return fail('bad-time', 'at must be an instant with its offset, e.g. 2026-11-03T08:00:00Z.');
    }
    if (ms < Date.now() + 60_000) return fail('bad-time', 'Pick a launch time at least a minute ahead.');
    if (ms > Date.now() + MAX_SCHEDULE_DAYS * DAY) return fail('bad-time', `Pick a launch time within ${MAX_SCHEDULE_DAYS} days.`);
    atIso = new Date(ms).toISOString();
  }

  // The figure the confirmation must name, worked out now: the audience after
  // its segments (and the app's tags) are fresh, or what a paused queue has left.
  let expected: number;
  let refreshed: SegmentRefreshResult | null = null;
  if (verb === 'RESUME') {
    expected = await pendingCount(env.DB, b.id);
  } else {
    const c = broadcastCriteria(b);
    const tags = audienceTags(c);
    if (tags.size) refreshed = await refreshBroadcastSegments(env.DB, tags, env);
    if (refreshed?.appTags && !refreshed.appTags.ok && usesAppTags(tags)) {
      return fail('app-tags', `The app's tags could not be asked for, so this audience is not known for sure: ${refreshed.appTags.message} Nothing was sent.`);
    }
    const counted = await countAudienceChecked(env.DB, c);
    if ('error' in counted) return fail('bad-audience', `${counted.error} Nothing was sent.`);
    expected = counted.count;
  }
  const want = `${verb} ${b.id} ${expected}`;
  if (expected === 0) return fail('nobody', `Broadcast ${b.id} reaches nobody right now. Nothing was sent.`);
  const given = parseSendConfirm(input?.confirm);
  if (!given || given.verb !== verb || given.id !== b.id || given.count !== expected) {
    return fail('confirm-mismatch', `The confirmation must be "${want}" (${expected.toLocaleString('en')} ${verb === 'RESUME' ? 'still to send' : 'people now'}). Nothing was sent.`);
  }

  if (verb === 'SCHEDULE') {
    await setBroadcastScheduledAt(env.DB, b.id, atIso);
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'app.broadcast.scheduled',
      source: 'app',
      payload: { broadcastId: b.id, at: atIso, audienceNow: expected, actor },
    });
    const after = await getBroadcast(env.DB, b.id);
    return {
      ok: true as const,
      action: 'scheduled' as const,
      id: b.id,
      scheduledAt: atIso,
      scheduledWhen: brussels(atIso),
      audienceNow: expected,
      note: 'The audience is taken again at launch, so the number can move a little by then. Cancel with broadcast_hold.',
      broadcast: summary(env, after!, await topicsByKey(env.DB)),
    };
  }
  if (verb === 'RESUME') {
    await resumeBroadcast(env.DB, b.id);
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'app.broadcast.resumed',
      source: 'app',
      payload: { broadcastId: b.id, pending: expected, actor },
    });
    return {
      ok: true as const,
      action: 'resumed' as const,
      id: b.id,
      pending: expected,
      broadcast: summary(env, (await getBroadcast(env.DB, b.id))!, await topicsByKey(env.DB)),
    };
  }
  let queued: number;
  try {
    queued = await launchBroadcast(env.DB, b.id, env);
  } catch (err) {
    // Rules that stopped compiling between the count and the snapshot: nothing
    // was queued, the broadcast is still a draft.
    if (err instanceof AudienceRulesError) return fail('bad-audience', `${err.message} Nothing was sent.`);
    throw err;
  }
  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'app.broadcast.launched',
    source: 'app',
    payload: { broadcastId: b.id, confirmed: expected, queued, actor },
  });
  return {
    ok: true as const,
    action: 'launched' as const,
    id: b.id,
    queued,
    note: `Sending over the coming hours, each person inside ${b.window_start_hour}:00–${b.window_end_hour}:00 their own time; it pauses itself if bounces or complaints spike.`,
    broadcast: summary(env, (await getBroadcast(env.DB, b.id))!, await topicsByKey(env.DB)),
  };
}

export async function holdBroadcastFromApp(env: BridgeEnv, input: { id?: unknown; actor?: unknown }) {
  const actor = actorOf(input?.actor);
  const b = await getBroadcast(env.DB, Number(input?.id));
  if (!b) return fail('not-found', `No broadcast ${String(input?.id)}.`);
  let action: 'paused' | 'unscheduled' | 'nothing';
  if (b.status === 'sending') {
    await pauseBroadcast(env.DB, b.id, `Paused from the app (${actor}).`);
    action = 'paused';
  } else if (b.status === 'draft' && b.scheduled_at) {
    await setBroadcastScheduledAt(env.DB, b.id, null);
    action = 'unscheduled';
  } else {
    action = 'nothing';
  }
  if (action !== 'nothing') {
    await logEventSafe(env.DB, { registration_id: null, kind: `app.broadcast.${action}`, source: 'app', payload: { broadcastId: b.id, actor } });
  }
  const after = (await getBroadcast(env.DB, b.id))!;
  return {
    ok: true as const,
    action,
    id: b.id,
    pending: after.status === 'draft' ? 0 : await pendingCount(env.DB, b.id),
    broadcast: summary(env, after, await topicsByKey(env.DB)),
  };
}
