// Course email sequences — what follows a confirmation, sent by the site
// instead of a Drip workflow.
//
//   asj-weekly     Week 2 … Week 40 of the Authentic Singing Journey, one a week
//                  (Week 1 rides the confirmation, as it always did in Drip).
//                  Everyone who holds the journey in English: standalone, in a
//                  bundle, as an order bump, or "both editions".
//   asj-weekly-nl  The same 39 weeks in Dutch (Authentiek Zingen), for buyers
//                  who chose the Dutch edition only.
//   twelve-week    The 12-Week Course onboarding: day 1, day 2, week 2, week 6,
//                  week 12. Path buyers ride it too (variant path-wait /
//                  path-now), with "your certification course is open" at the
//                  end of the twelve weeks when they chose to wait.
//   certification  The standalone certification onboarding: day 1, day 2.
//
// Table course_email_sequences (migration 0090): one row per (sequence, email).
// Step k falls due at 09:00 in the buyer's own timezone, `dayOffset` days after
// the day they paid — the "wait N days, send at 9:00" rhythm Drip ran — and the
// hourly cron sends whatever is due, inside the local 08:00–21:00 window. Each
// step is claimed by a compare-and-swap on next_step and rolled back if the
// send fails, so a step goes out once and a failure retries next hour.
//
// Enrolment is gated by the course's handover switch (./handover.ts), and only
// orders paid AFTER the switch went on are enrolled — anyone earlier is Drip's
// until an admin presses "Bring in earlier buyers", which joins them at the
// step their own schedule has reached (never from the start).
//
// A stop is per series (the email's button, the mail client's one-click
// unsubscribe, an admin, a full refund, or an address on the suppression list)
// and never touches the course itself.

import type { CourseRegistration } from '../db';
import { parsePurchasedBumps } from '../db';
import { getCertAccessForEmail } from '../cert-access';
import { isEmailSuppressed } from '../../email/unsubscribe';
import { MARKETING_FROM_DEFAULT, MARKETING_REPLY_TO_DEFAULT, type EmailContent } from '../../workshops/emails';
import { sendEmail } from '../../workshops/resend';
import { DEFAULT_SEND_TZ, withinSendWindow } from '../../workshops/time';
import { logEvent } from '../../registrations/db';
import { ASJ_WEEK_COUNT, asjWeek } from './asj-weeks';
import { loadHandover, type HandoverUnit } from './handover';
import { ASJ_NL_COMPLETE, asjWeekNl } from './asj-weeks-nl';
import {
  asjWeeklyEmail,
  asjWeeklyEmailNl,
  certificationStepEmail,
  twelveWeekStepEmail,
  type SequenceEmailCtx,
} from './sequence-emails';
import { sequenceOneClickUrl, sequenceStopUrl, signSequenceToken } from './stop-link';

export type SequenceKey = 'asj-weekly' | 'asj-weekly-nl' | 'twelve-week' | 'certification';

export type SequenceStep = {
  n: number;
  dayOffset: number;
  label: string;
  // Where the words came from — shown beside the preview.
  origin: 'drip' | 'drip-adapted' | 'new';
  // Variants this step is sent to (absent = everyone on the sequence).
  onlyVariants?: Array<string | null>;
  build: (ctx: SequenceEmailCtx) => EmailContent | null;
};

export type SequenceDef = {
  key: SequenceKey;
  label: string;
  steps: SequenceStep[];
};

const ASJ_STEPS: SequenceStep[] = Array.from({ length: ASJ_WEEK_COUNT - 1 }, (_, i) => {
  const week = i + 2;
  const w = asjWeek(week)!;
  return {
    n: week,
    dayOffset: 7 * (week - 1),
    label: `Week ${week} — ${w.title}`,
    origin: w.source === 'drip' ? 'drip' : 'drip-adapted',
    build: (ctx: SequenceEmailCtx) => asjWeeklyEmail(week, ctx),
  };
});

// Only the weeks that have their Dutch words (enrolment waits for all of them —
// see ASJ_NL_COMPLETE below — so this list is complete whenever it is used).
const ASJ_STEPS_NL: SequenceStep[] = Array.from({ length: ASJ_WEEK_COUNT - 1 }, (_, i) => i + 2).flatMap((week) => {
  const w = asjWeekNl(week);
  if (!w) return [];
  return [
    {
      n: week,
      dayOffset: 7 * (week - 1),
      label: `Week ${week} — ${w.title}`,
      origin: w.source === 'drip' ? ('drip' as const) : ('drip-adapted' as const),
      build: (ctx: SequenceEmailCtx) => asjWeeklyEmailNl(week, ctx),
    },
  ];
});

export const SEQUENCES: Record<SequenceKey, SequenceDef> = {
  'asj-weekly': {
    key: 'asj-weekly',
    label: 'Authentic Singing Journey — weekly sessions',
    steps: ASJ_STEPS,
  },
  'asj-weekly-nl': {
    key: 'asj-weekly-nl',
    label: 'Authentiek Zingen — wekelijkse sessies (Dutch edition)',
    steps: ASJ_STEPS_NL,
  },
  'twelve-week': {
    key: 'twelve-week',
    label: '12-Week Course — onboarding',
    steps: [
      { n: 1, dayOffset: 1, label: 'Day 1 — See you in Q&A?', origin: 'drip-adapted', build: (c) => twelveWeekStepEmail(1, c) },
      { n: 2, dayOffset: 2, label: 'Day 2 — How to pace yourself', origin: 'drip-adapted', build: (c) => twelveWeekStepEmail(2, c) },
      { n: 3, dayOffset: 7, label: 'Week 2 — the deepening sessions', origin: 'drip-adapted', build: (c) => twelveWeekStepEmail(3, c) },
      { n: 4, dayOffset: 35, label: 'Week 6 — halfway', origin: 'drip-adapted', build: (c) => twelveWeekStepEmail(4, c) },
      {
        n: 5,
        dayOffset: 77,
        label: 'Week 12 — the last week of live Q&As (12-week only)',
        origin: 'new',
        onlyVariants: [null],
        build: (c) => twelveWeekStepEmail(5, c),
      },
      {
        n: 6,
        dayOffset: 84,
        label: 'Week 13 — your certification course is open (path, waited)',
        origin: 'drip-adapted',
        onlyVariants: ['path-wait'],
        build: (c) => twelveWeekStepEmail(6, c),
      },
    ],
  },
  certification: {
    key: 'certification',
    label: 'Certification Course — onboarding',
    steps: [
      { n: 1, dayOffset: 1, label: 'Day 1 — See you in the live sessions?', origin: 'drip-adapted', build: (c) => certificationStepEmail(1, c) },
      { n: 2, dayOffset: 2, label: 'Day 2 — How to pace yourself', origin: 'drip-adapted', build: (c) => certificationStepEmail(2, c) },
    ],
  },
};

export const SEQUENCE_KEYS = Object.keys(SEQUENCES) as SequenceKey[];

export function isSequenceKey(v: unknown): v is SequenceKey {
  return typeof v === 'string' && v in SEQUENCES;
}

// Which handover switch governs a sequence for a given order.
function unitForEnrolment(key: SequenceKey, slug: string): HandoverUnit {
  if (key === 'asj-weekly' || key === 'asj-weekly-nl') return 'asj';
  if (key === 'certification') return 'certification';
  return slug === 'cc-bundle' ? 'path' : 'twelve-week';
}

const ASJ_HOLDER_SLUGS = new Set(['asj', 'asj-pro', 'journeys-bundle', 'journeys-bundle-pro']);
const ASJ_BUMP_PARENTS = new Set(['svh-12week', 'cc-cert', 'cc-bundle']);

// The sequences an order puts its buyer on (before the handover switches).
export function sequencesForOrder(
  reg: Pick<CourseRegistration, 'product_slug' | 'language_choice' | 'bumps' | 'activate_choice'>,
): Array<{ key: SequenceKey; variant: string | null }> {
  const out: Array<{ key: SequenceKey; variant: string | null }> = [];
  const slug = reg.product_slug;
  const hasAsjBump =
    ASJ_BUMP_PARENTS.has(slug) && parsePurchasedBumps(reg.bumps).some((b) => b.slug === 'asj');
  if ((ASJ_HOLDER_SLUGS.has(slug) && reg.language_choice !== 'nl') || hasAsjBump) {
    out.push({ key: 'asj-weekly', variant: null });
  } else if (ASJ_HOLDER_SLUGS.has(slug) && reg.language_choice === 'nl' && ASJ_NL_COMPLETE) {
    // The Dutch series only runs once every week has its Dutch words.
    out.push({ key: 'asj-weekly-nl', variant: null });
  }
  if (slug === 'svh-12week') out.push({ key: 'twelve-week', variant: null });
  if (slug === 'cc-bundle') {
    out.push({ key: 'twelve-week', variant: reg.activate_choice === 'now' ? 'path-now' : 'path-wait' });
  }
  if (slug === 'cc-cert') out.push({ key: 'certification', variant: null });
  return out;
}

// ── Time ───────────────────────────────────────────────────────────────────

const SEND_LOCAL_HOUR = 9;
// A late step (the cron was down, a switch was flipped, someone resumed) never
// bunches up: the next one waits at least this long after it.
const MIN_GAP_MS = 20 * 3_600_000;

// '2026-10-06 12:00:00' (D1) or an ISO string → epoch ms, read as UTC.
export function utcMs(s: string | null | undefined): number {
  if (!s) return NaN;
  const t = s.includes('T') ? s : s.replace(' ', 'T');
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
}

export function sqlUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function validTz(tz: string | null | undefined): string {
  if (tz) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: tz });
      return tz;
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_SEND_TZ;
}

// Minutes the zone is ahead of UTC at `ms`.
function tzOffsetMinutes(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - ms) / 60_000);
}

// 09:00 local time, `dayOffset` calendar days after the local day of `startMs`.
export function dueAtMs(startMs: number, dayOffset: number, tz: string | null | undefined): number {
  const zone = validTz(tz);
  const local = new Date(startMs + tzOffsetMinutes(startMs, zone) * 60_000);
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset, SEND_LOCAL_HOUR);
  let utc = guess - tzOffsetMinutes(guess, zone) * 60_000;
  utc = guess - tzOffsetMinutes(utc, zone) * 60_000; // settle across a DST change
  return utc;
}

// ── Enrolment ──────────────────────────────────────────────────────────────

type SeqEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  ADMIN_SESSION_SECRET?: string;
  PUBLIC_BASE_URL?: string;
  MARKETING_FROM?: string;
  MARKETING_REPLY_TO?: string;
};

function firstStepFrom(def: SequenceDef, variant: string | null, startMs: number, tz: string | null, notBeforeMs: number) {
  for (const s of def.steps) {
    if (s.onlyVariants && !s.onlyVariants.includes(variant)) continue;
    const due = dueAtMs(startMs, s.dayOffset, tz);
    if (due > notBeforeMs) return { step: s, due };
  }
  return null;
}

// Put a paid order's buyer on their sequences — the ones whose switch is on and
// was on when they paid. Idempotent (UNIQUE sequence+email: a second order
// never restarts or duplicates a series). Never throws.
export async function enrollCourseSequences(
  env: SeqEnv,
  reg: CourseRegistration,
  handover?: Map<HandoverUnit, string>,
): Promise<SequenceKey[]> {
  const enrolled: SequenceKey[] = [];
  if (reg.status !== 'paid') return enrolled;
  const sw = handover ?? (await loadHandover(env.DB));
  const paidMs = utcMs(reg.paid_at) || utcMs(reg.created_at);
  for (const { key, variant } of sequencesForOrder(reg)) {
    const since = sw.get(unitForEnrolment(key, reg.product_slug));
    if (!since || !(paidMs >= utcMs(since))) continue;
    try {
      if (await insertEnrolment(env.DB, reg, key, variant, paidMs, paidMs)) enrolled.push(key);
    } catch (err) {
      await logEvent(env.DB, {
        registration_id: null,
        kind: 'course.sequence.enrol_error',
        source: 'system',
        payload: { course_registration_id: reg.id, sequence: key, error: String(err) },
      }).catch(() => {});
    }
  }
  return enrolled;
}

async function insertEnrolment(
  db: D1Database,
  reg: CourseRegistration,
  key: SequenceKey,
  variant: string | null,
  startMs: number,
  notBeforeMs: number,
): Promise<boolean> {
  const first = firstStepFrom(SEQUENCES[key], variant, startMs, reg.timezone, notBeforeMs);
  if (!first) return false; // the whole schedule is already behind them
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO course_email_sequences
         (sequence, email, first_name, timezone, course_registration_id, variant,
          started_at, next_step, next_due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      key,
      reg.email.trim().toLowerCase(),
      reg.first_name,
      reg.timezone,
      reg.id,
      variant,
      sqlUtc(startMs),
      first.step.n,
      sqlUtc(first.due),
    )
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

// ── Taking over buyers from before the switch ──────────────────────────────

// Paid orders that put someone on `key` but have no row yet, and whose schedule
// still has a step ahead. Bounded to the length of the sequence (a 40-week
// series can't reach back further than 40 weeks).
async function earlierBuyers(db: D1Database, key: SequenceKey): Promise<CourseRegistration[]> {
  const sw = await loadHandover(db);
  const def = SEQUENCES[key];
  const lastOffset = Math.max(...def.steps.map((s) => s.dayOffset));
  const slugs =
    key === 'asj-weekly'
      ? [...ASJ_HOLDER_SLUGS, ...ASJ_BUMP_PARENTS]
      : key === 'asj-weekly-nl'
        ? [...ASJ_HOLDER_SLUGS]
        : key === 'twelve-week'
        ? ['svh-12week', 'cc-bundle']
        : ['cc-cert'];
  const { results } = await db
    .prepare(
      `SELECT r.* FROM course_registrations r
        WHERE r.status = 'paid'
          AND r.product_slug IN (${slugs.map(() => '?').join(',')})
          AND COALESCE(r.paid_at, r.created_at) >= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1 FROM course_email_sequences s
             WHERE s.sequence = ? AND s.email = lower(trim(r.email)))
        ORDER BY COALESCE(r.paid_at, r.created_at)`,
    )
    .bind(...slugs, `-${lastOffset + 1} days`, key)
    .all<CourseRegistration>();
  // Only orders whose course is switched over: a path buyer stays Drip's while
  // the path switch is off, even when the 12-week one is on.
  return (results ?? []).filter(
    (r) => sw.has(unitForEnrolment(key, r.product_slug)) && sequencesForOrder(r).some((s) => s.key === key),
  );
}

export async function countEarlierBuyers(db: D1Database, key: SequenceKey): Promise<number> {
  try {
    const now = Date.now();
    const rows = await earlierBuyers(db, key);
    const seen = new Set<string>();
    let n = 0;
    for (const r of rows) {
      const email = r.email.trim().toLowerCase();
      if (seen.has(email)) continue;
      const variant = sequencesForOrder(r).find((s) => s.key === key)?.variant ?? null;
      const startMs = utcMs(r.paid_at) || utcMs(r.created_at);
      if (firstStepFrom(SEQUENCES[key], variant, startMs, r.timezone, now)) {
        seen.add(email);
        n++;
      }
    }
    return n;
  } catch {
    return 0;
  }
}

// Join everyone found above at the step their own schedule has reached. Meant
// for after the matching Drip workflow is switched off — the admin page says so.
export async function bringInEarlierBuyers(env: SeqEnv, key: SequenceKey): Promise<number> {
  const now = Date.now();
  let n = 0;
  for (const r of await earlierBuyers(env.DB, key)) {
    const variant = sequencesForOrder(r).find((s) => s.key === key)?.variant ?? null;
    const startMs = utcMs(r.paid_at) || utcMs(r.created_at);
    if (await insertEnrolment(env.DB, r, key, variant, startMs, now).catch(() => false)) n++;
  }
  return n;
}

// ── Sending ────────────────────────────────────────────────────────────────

export type EnrolmentRow = {
  id: number;
  sequence: SequenceKey;
  email: string;
  first_name: string | null;
  timezone: string | null;
  course_registration_id: number | null;
  variant: string | null;
  started_at: string;
  next_step: number;
  next_due_at: string | null;
  last_sent_step: number | null;
  last_sent_at: string | null;
  stopped_at: string | null;
  stop_source: string | null;
  completed_at: string | null;
  created_at: string;
};

const SEND_GAP_MS = 600; // under Resend's 2 req/s
const DEFAULT_MAX_PER_RUN = 150;

export type SequenceRunResult = { due: number; sent: number; skipped: number; stopped: number; failed: number };

function baseUrl(env: SeqEnv): string {
  return (env.PUBLIC_BASE_URL || 'https://songdance.co').replace(/\/+$/, '');
}

function formatDay(ymd: string | null | undefined): string | null {
  if (!ymd) return null;
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

export async function sequenceCtxFor(
  env: SeqEnv,
  row: EnrolmentRow,
  secret: string,
): Promise<{ ctx: SequenceEmailCtx; oneClickUrl: string }> {
  const base = baseUrl(env);
  const token = await signSequenceToken(secret, row.id);
  let certEndsOn: string | null = null;
  if (row.sequence === 'certification' || row.variant === 'path-wait' || row.variant === 'path-now') {
    try {
      certEndsOn = formatDay((await getCertAccessForEmail(env.DB, row.email))?.endsOn);
    } catch {
      certEndsOn = null;
    }
  }
  return {
    ctx: { name: row.first_name, base, stopUrl: sequenceStopUrl(base, token), variant: row.variant, certEndsOn },
    oneClickUrl: sequenceOneClickUrl(base, token),
  };
}

// The step after `n` that applies to this variant, and when it falls due.
function nextAfter(row: EnrolmentRow, n: number, nowMs: number): { n: number; dueMs: number } | null {
  const def = SEQUENCES[row.sequence];
  const startMs = utcMs(row.started_at);
  for (const s of def.steps) {
    if (s.n <= n) continue;
    if (s.onlyVariants && !s.onlyVariants.includes(row.variant)) continue;
    return { n: s.n, dueMs: Math.max(dueAtMs(startMs, s.dayOffset, row.timezone), nowMs + MIN_GAP_MS) };
  }
  return null;
}

export async function stopEnrolment(db: D1Database, id: number, source: string): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE course_email_sequences SET stopped_at = datetime('now'), stop_source = ?
        WHERE id = ? AND stopped_at IS NULL`,
    )
    .bind(source, id)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

// Start a stopped series again, from the step it stopped at (never from the
// beginning, never skipping ahead). If that step is already overdue it goes
// out at the next hourly tick inside the person's send window.
export async function resumeEnrolment(db: D1Database, id: number): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE course_email_sequences
          SET stopped_at = NULL, stop_source = NULL,
              next_due_at = CASE WHEN next_due_at < datetime('now') THEN datetime('now') ELSE next_due_at END
        WHERE id = ? AND stopped_at IS NOT NULL AND completed_at IS NULL`,
    )
    .bind(id)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function getEnrolment(db: D1Database, id: number): Promise<EnrolmentRow | null> {
  try {
    return (
      (await db.prepare(`SELECT * FROM course_email_sequences WHERE id = ?`).bind(id).first<EnrolmentRow>()) ??
      null
    );
  } catch {
    return null;
  }
}

// The hourly run: everything due, inside each person's own send window.
export async function runCourseSequences(
  env: SeqEnv,
  opts?: { maxSends?: number; now?: number },
): Promise<SequenceRunResult> {
  const res: SequenceRunResult = { due: 0, sent: 0, skipped: 0, stopped: 0, failed: 0 };
  if (!env.RESEND_API_KEY || !env.ADMIN_SESSION_SECRET) return res;
  const secret = env.ADMIN_SESSION_SECRET;
  const now = opts?.now ?? Date.now();
  const max = opts?.maxSends ?? DEFAULT_MAX_PER_RUN;

  let rows: EnrolmentRow[] = [];
  try {
    const r = await env.DB
      .prepare(
        `SELECT * FROM course_email_sequences
          WHERE stopped_at IS NULL AND completed_at IS NULL
            AND next_due_at IS NOT NULL AND next_due_at <= ?
          ORDER BY next_due_at
          LIMIT ?`,
      )
      .bind(sqlUtc(now), max * 3)
      .all<EnrolmentRow>();
    rows = r.results ?? [];
  } catch {
    return res; // table not there yet (preview before the migration)
  }
  res.due = rows.length;

  for (const row of rows) {
    if (res.sent >= max) break;
    if (!isSequenceKey(row.sequence)) continue;
    if (!withinSendWindow(row.timezone, now)) {
      res.skipped++;
      continue;
    }
    // Someone who unsubscribed from Songdance, bounced or complained: their
    // series stops too (a weekly series is still email they didn't ask to keep).
    if (await isEmailSuppressed(env.DB, row.email).catch(() => false)) {
      if (await stopEnrolment(env.DB, row.id, 'suppressed').catch(() => false)) res.stopped++;
      continue;
    }
    if (row.course_registration_id) {
      const reg = await env.DB
        .prepare(`SELECT status FROM course_registrations WHERE id = ?`)
        .bind(row.course_registration_id)
        .first<{ status: string }>()
        .catch(() => null);
      if (reg?.status === 'refunded') {
        if (await stopEnrolment(env.DB, row.id, 'refunded').catch(() => false)) res.stopped++;
        continue;
      }
    }

    const step = SEQUENCES[row.sequence].steps.find((s) => s.n === row.next_step);
    const next = nextAfter(row, row.next_step, now);
    const { ctx, oneClickUrl } = await sequenceCtxFor(env, row, secret);
    const content = step && (!step.onlyVariants || step.onlyVariants.includes(row.variant)) ? step.build(ctx) : null;

    // Claim the step: move the pointer first; only the tick that moved it sends.
    const claim = await env.DB
      .prepare(
        `UPDATE course_email_sequences
            SET next_step = ?, next_due_at = ?,
                last_sent_step = CASE WHEN ? THEN ? ELSE last_sent_step END,
                last_sent_at = CASE WHEN ? THEN datetime('now') ELSE last_sent_at END,
                completed_at = CASE WHEN ? THEN datetime('now') ELSE NULL END
          WHERE id = ? AND next_step = ? AND stopped_at IS NULL AND completed_at IS NULL`,
      )
      .bind(
        next ? next.n : row.next_step,
        next ? sqlUtc(next.dueMs) : null,
        content ? 1 : 0,
        row.next_step,
        content ? 1 : 0,
        next ? 0 : 1,
        row.id,
        row.next_step,
      )
      .run()
      .catch(() => null);
    if (!claim || (claim.meta?.changes ?? 0) === 0) continue;
    if (!content) {
      res.skipped++; // a step that doesn't apply to this variant — advanced past
      continue;
    }

    try {
      await sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.MARKETING_FROM || MARKETING_FROM_DEFAULT,
        replyTo: env.MARKETING_REPLY_TO || MARKETING_REPLY_TO_DEFAULT,
        to: row.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        entityRefId: `course-seq-${row.id}-${row.next_step}`,
        listUnsubscribeUrl: oneClickUrl,
        track: { db: env.DB, type: `course_seq_${row.sequence}_${row.next_step}`, registrationId: null },
      });
      res.sent++;
    } catch (err) {
      res.failed++;
      // Put the pointer back so the next tick tries this step again — only if
      // it is still where this tick's claim left it.
      await env.DB
        .prepare(
          `UPDATE course_email_sequences
              SET next_step = ?, next_due_at = ?, last_sent_step = ?, last_sent_at = ?, completed_at = NULL
            WHERE id = ? AND next_step = ?`,
        )
        .bind(
          row.next_step,
          row.next_due_at,
          row.last_sent_step,
          row.last_sent_at,
          row.id,
          next ? next.n : row.next_step,
        )
        .run()
        .catch(() => {});
      await logEvent(env.DB, {
        registration_id: null,
        kind: 'course.sequence.send_error',
        source: 'system',
        payload: { enrolment_id: row.id, sequence: row.sequence, step: row.next_step, error: String(err) },
      }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, SEND_GAP_MS));
  }
  return res;
}

// ── Admin read-outs ────────────────────────────────────────────────────────

export type SequenceCounts = { active: number; stopped: number; completed: number; stoppedByLink: number };

export async function sequenceCounts(db: D1Database): Promise<Map<SequenceKey, SequenceCounts> | null> {
  try {
    const { results } = await db
      .prepare(
        `SELECT sequence,
                SUM(CASE WHEN stopped_at IS NULL AND completed_at IS NULL THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN stopped_at IS NOT NULL THEN 1 ELSE 0 END) AS stopped,
                SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN stop_source IN ('link','one-click') THEN 1 ELSE 0 END) AS by_link
           FROM course_email_sequences GROUP BY sequence`,
      )
      .all<{ sequence: string; active: number; stopped: number; completed: number; by_link: number }>();
    const out = new Map<SequenceKey, SequenceCounts>();
    for (const r of results ?? []) {
      if (!isSequenceKey(r.sequence)) continue;
      out.set(r.sequence, {
        active: r.active ?? 0,
        stopped: r.stopped ?? 0,
        completed: r.completed ?? 0,
        stoppedByLink: r.by_link ?? 0,
      });
    }
    return out;
  } catch {
    return null; // migration not applied yet
  }
}

export async function listEnrolmentsForEmail(db: D1Database, email: string): Promise<EnrolmentRow[]> {
  try {
    const { results } = await db
      .prepare(`SELECT * FROM course_email_sequences WHERE email = ? ORDER BY created_at`)
      .bind(email.trim().toLowerCase())
      .all<EnrolmentRow>();
    return results ?? [];
  } catch {
    return [];
  }
}
