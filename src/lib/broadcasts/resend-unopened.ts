// Resend to non-openers: a new draft with the same email, sender and topic,
// aimed at everyone who received broadcast N and neither opened nor clicked it
// (segment rules, resendUnopenedRules in segment-rules.ts), optionally also
// leaving out anyone who bought something after receiving it. Suppressions and
// the topic opt-out apply through audienceSql like any other audience.
//
// Only once the source has finished (done, or paused with nothing left in its
// queue): while it is still sending, everyone mailed minutes earlier would count
// as a non-opener. Opens are approximate either way — Apple Mail opens every
// message by itself, so a few people who never saw it are not in the resend,
// and a send with no tracked email_sends row counts as unopened.
//
// Needs migration 0100 (broadcasts.audience_rules / resend_of). Before it, the
// page and the endpoint say so and nothing is written.

import {
  broadcastColumnsReady,
  countAudienceChecked,
  broadcastCriteria,
  createBroadcast,
  getBroadcast,
  saveBroadcastExtras,
  type Broadcast,
} from './db';
import { resendUnopenedRules } from './segment-rules';
import { logEventSafe } from '../registrations/db';

const SUBJECT_MAX = 300;

export type ResendReadiness = {
  // Migration 0100 is in.
  ready: boolean;
  // A resend may be made now.
  allowed: boolean;
  // Why not, in words (null when allowed).
  reason: string | null;
  // Still queued or being sent right now.
  pending: number;
  // When the last email of the source went out, and how long ago in words.
  lastSentAt: string | null;
  lastSentAgo: string | null;
  // Hours since the last send (null when nothing was sent).
  hoursSinceLast: number | null;
};

// "12 minutes ago" / "5 hours ago" / "3 days ago".
export function agoWords(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return 'just now';
  if (hours < 1) {
    const m = Math.max(1, Math.round(hours * 60));
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  if (hours < 48) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.round(hours / 24);
  return `${d} days ago`;
}

// Where a broadcast stands for a resend: may one be made now, and if not why.
export async function resendReadiness(db: D1Database, b: Broadcast): Promise<ResendReadiness> {
  const ready = (await broadcastColumnsReady(db)).rules;
  let pending = 0;
  let lastSentAt: string | null = null;
  let hours: number | null = null;
  if (b.status !== 'draft') {
    try {
      const r = await db
        .prepare(
          `SELECT
             SUM(CASE WHEN status IN ('pending', 'sending') THEN 1 ELSE 0 END) AS pending,
             MAX(CASE WHEN status = 'sent' THEN sent_at END) AS last_sent,
             (julianday('now') - MAX(CASE WHEN status = 'sent' THEN julianday(sent_at) END)) * 24 AS hours
           FROM broadcast_recipients WHERE broadcast_id = ?`,
        )
        .bind(b.id)
        .first<{ pending: number | null; last_sent: string | null; hours: number | null }>();
      pending = Number(r?.pending ?? 0);
      lastSentAt = r?.last_sent ?? null;
      hours = r?.hours == null ? null : Number(r.hours);
    } catch {
      /* counts stay 0 */
    }
  }
  const lastSentAgo = hours == null ? null : agoWords(hours);
  const base = { ready, pending, lastSentAt, lastSentAgo, hoursSinceLast: hours };

  let reason: string | null = null;
  if (b.status === 'draft') reason = 'Send it first — a draft has no non-openers.';
  else if (b.status === 'sending') {
    reason = `It is still sending (${pending.toLocaleString('en')} still to go). A resend can be made once it has finished: until then, everyone mailed in the last few minutes would count as a non-opener.`;
  } else if (b.status === 'paused' && pending > 0) {
    reason = `It is paused with ${pending.toLocaleString('en')} still queued. A resend can be made once nothing is left to send — resume it and let it finish (or let its auto-stop end it).`;
  } else if (!lastSentAt) reason = 'Nothing of it was sent, so there is nobody to resend to.';
  else if (!ready) reason = 'Resending to non-openers needs migration 0100 (applied when merged).';
  return { ...base, allowed: !reason, reason };
}

// The resend drafts already made from a broadcast. [] before migration 0100.
export async function resendsOf(
  db: D1Database,
  id: number,
): Promise<Array<{ id: number; name: string; status: string }>> {
  try {
    const r = await db
      .prepare(`SELECT id, name, status FROM broadcasts WHERE resend_of = ? ORDER BY id`)
      .bind(id)
      .all<{ id: number; name: string; status: string }>();
    return r.results ?? [];
  } catch {
    return [];
  }
}

export async function createResendDraft(
  db: D1Database,
  sourceId: number,
  opts: { subject?: string | null; excludeBuyers?: boolean; by: string },
): Promise<{ ok: true; id: number; count: number | null; warning?: string } | { ok: false; error: string }> {
  const src = await getBroadcast(db, sourceId);
  if (!src) return { ok: false, error: 'Broadcast not found.' };
  const state = await resendReadiness(db, src);
  if (!state.allowed) return { ok: false, error: state.reason ?? 'A resend cannot be made right now.' };

  const subject = String(opts.subject ?? '').trim() || src.subject;
  if (subject.length > SUBJECT_MAX) return { ok: false, error: `The subject can be at most ${SUBJECT_MAX} characters.` };
  const excludeBuyers = !!opts.excludeBuyers;

  // The source's composable fields, as Duplicate copies them. Its tags stay on
  // the row (the rules replace them while set), so switching the draft back to
  // Tags would aim it at the source's whole audience again — the builder shows
  // the count before anyone launches.
  const id = await createBroadcast(db, {
    name: `${src.name} (resend to unopened)`.slice(0, 200),
    subject,
    preheader: src.preheader,
    heading: src.heading,
    body: src.body,
    format: src.format,
    body_text: src.body_text,
    hero_image: src.hero_image,
    cta_label: src.cta_label,
    cta_href: src.cta_href,
    window_start_hour: src.window_start_hour,
    window_end_hour: src.window_end_hour,
    audience_include_tags: src.audience_include_tags,
    audience_exclude_tags: src.audience_exclude_tags,
    audience_field: src.audience_field,
    audience_field_value: src.audience_field_value,
  });
  if (!id) return { ok: false, error: 'The draft could not be created.' };

  const rules = resendUnopenedRules(src.id, excludeBuyers);
  const extras = await saveBroadcastExtras(db, id, {
    from_name: src.from_name,
    from_local: src.from_local,
    reply_to: src.reply_to,
    topic: src.topic,
    audience_rules: JSON.stringify(rules),
    resend_of: src.id,
  });
  // Without its rules the draft would be aimed at the source's whole audience:
  // never leave that behind.
  if (!extras.saved.includes('rules')) {
    try {
      await db.prepare(`DELETE FROM broadcasts WHERE id = ? AND status = 'draft'`).bind(id).run();
    } catch {
      /* best-effort */
    }
    return { ok: false, error: 'The audience of the resend could not be saved, so no draft was made. Try again.' };
  }

  const after = await getBroadcast(db, id);
  const counted = after ? await countAudienceChecked(db, broadcastCriteria(after)) : null;
  const count = counted && 'count' in counted ? counted.count : null;

  await logEventSafe(db, {
    registration_id: null,
    kind: 'broadcast.resend_created',
    source: 'admin',
    payload: { from: src.id, id, excludeBuyers, subjectChanged: subject !== src.subject, count, by: opts.by },
  });

  const warning = extras.skipped.length
    ? `The draft was made, but its ${extras.skipped.join(' and ')} could not be copied — check them before launching.`
    : undefined;
  return warning ? { ok: true, id, count, warning } : { ok: true, id, count };
}
