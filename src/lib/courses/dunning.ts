// Failed installment payments — three reminders, then a hand-off to support.
//
// A Stripe course installment plan whose monthly charge fails used to go quiet:
// Stripe retried the same card, the row sat at `past_due` / `unpaid` on
// /admin/courses/future-revenue, and chasing it was a manual job. Now every
// failed installment opens one RUN (table `course_dunning`, migration 0085):
//
//   reminder 1   as soon as the run is seen
//   reminder 2   3 days after reminder 1
//   reminder 3   4 days after reminder 2
//   hand-off     3 days after reminder 3 — an internal "SD-PAYMENT" email to
//                support@ (DUNNING_ALERTS_TO), who decide what happens to the
//                plan: write to the buyer, stop it, or leave it open
//
// Each reminder carries the buyer's own card-update link (./card-update-link.ts)
// — our URL, never Stripe's, so it still works when the email is read a week
// later — which saves a new card AND charges what is outstanding with it
// (./card-update.ts).
//
// Where a run comes from:
//   • the invoice.payment_failed webhook, the moment a charge fails; and
//   • this sweep, for any live plan Stripe has marked `past_due` / `unpaid`
//     with no run open — so a missed webhook, or a plan that fell behind before
//     this existed, is picked up within the hour.
//
// A run is keyed on the Stripe INVOICE that failed. That invoice's live status
// is what closes it (paid → 'paid'; voided / written off in Stripe → 'void'),
// and a later installment that fails is a different invoice, so a new run.
// Our own row closes it too: a plan cancelled, refunded, or stopped by an admin
// is 'stopped', and nothing more is sent.
//
// Two safety rules, because this emails people about money:
//   1. Stripe is asked, live, before EVERY reminder and before the hand-off,
//      whether the invoice is still owed. A stale status mirror never emails
//      someone who has already paid; if Stripe can't be read, nothing is sent
//      that tick.
//   2. Reminders are held to the buyer's local 08:00–21:00, and paused for a
//      day after the buyer saves a card (a week if the new card is a bank
//      debit that is still clearing) — so nobody is told the installment is
//      open while their payment is on its way.
//
// Runs on the hourly cron. Idempotent: every send is claimed by stamping its
// column first (a failed send un-stamps it, so the next tick retries).

import { getCourseRegistrationById, type CourseRegistration } from './db';
import { effectiveTotal } from './installment-forecast';
import { abandonedCourseMeta } from './abandoned';
import { isJourneySlug, LABEL_BY_SLUG } from './journeys';
import { buildCardUpdateUrl } from './card-update-link';
import type { CardUpdateOutcome } from './card-update';
import {
  dunningEscalationEmail,
  dunningReminderEmail,
  type DunningStep,
} from './dunning-emails';
import {
  listOutstandingSubscriptionInvoices,
  retrieveInvoice,
  type StripeInvoiceSummary,
} from '../registrations/stripe';
import { logEventSafe } from '../registrations/db';
import { sendEmail } from '../workshops/resend';
import { formatMoney } from '../workshops/currency';
import { withinSendWindow } from '../workshops/time';
import { makeOrderNo } from '../admin/orders';
import { stripeMode, stripeSubscriptionUrl } from '../admin/provider-links';

export type DunningEnv = {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  ADMIN_SESSION_SECRET: string;
  PUBLIC_BASE_URL?: string;
  // Comma/space-separated recipients for the SD-PAYMENT hand-off.
  DUNNING_ALERTS_TO?: string;
};

// Days between steps, each counted from the step before it (so a reminder
// held overnight by the send window never crowds the next one).
export const DUNNING_GAP_DAYS = { reminder2: 3, reminder3: 4, handoff: 3 } as const;
// Where the hand-off lands when DUNNING_ALERTS_TO is unset.
export const DUNNING_ALERTS_DEFAULT = 'support@songdance.co';

const DAY_MS = 86_400_000;
const RECHECK_MS = 6 * 3_600_000;
// After the buyer saves a card: wait a day before the next reminder, or a week
// while a bank debit (SEPA) is still clearing.
const CARD_HOLD_MS = DAY_MS;
const PROCESSING_HOLD_MS = 7 * DAY_MS;
const MAX_SEED_PER_TICK = 25;
const MAX_RUNS_PER_TICK = 50;

export type DunningRun = {
  id: number;
  course_registration_id: number;
  stripe_invoice_id: string;
  amount_minor: number | null;
  currency: string | null;
  opened_at: string;
  reminder1_sent_at: string | null;
  reminder2_sent_at: string | null;
  reminder3_sent_at: string | null;
  escalated_at: string | null;
  card_updated_at: string | null;
  card_update_outcome: string | null;
  card_update_message: string | null;
  last_checked_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
};

// SQLite `datetime('now')` → epoch ms (it is UTC, without the zone marker).
export function sqlTimeMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const ms = Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms : null;
}

// A plan this sequence may chase: a live Stripe installment plan that has
// started (≥ 1 charge taken) and still has charges to take. The first charge
// never fails into here — it happens at checkout, with the buyer present.
export function dunningEligible(reg: CourseRegistration): boolean {
  return (
    reg.provider !== 'paypal' &&
    reg.installments_total > 1 &&
    !!reg.stripe_subscription_id &&
    reg.status === 'paid' &&
    reg.installments_paid >= 1 &&
    reg.installments_paid < effectiveTotal(reg)
  );
}

// "the 12-Week Somatic Vocal Healing Course" — the name the buyer knows it by.
export function courseDisplayName(slug: string): string {
  const meta = abandonedCourseMeta(slug);
  if (meta) return meta.name;
  if (isJourneySlug(slug)) return LABEL_BY_SLUG[slug];
  return 'your course';
}

// Open (or keep) the run for this failed invoice. Returns true if it was new.
// Never throws — it rides the Stripe webhook, and a preview deploy runs
// against a database that may not have the table yet.
export async function openDunningRun(
  db: D1Database,
  reg: CourseRegistration,
  inv: { id: string; amountMinor?: number | null; currency?: string | null },
): Promise<boolean> {
  if (!dunningEligible(reg)) return false;
  try {
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO course_dunning
           (course_registration_id, stripe_invoice_id, amount_minor, currency)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(reg.id, inv.id, inv.amountMinor ?? null, inv.currency?.toUpperCase() ?? null)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  } catch (err) {
    console.error(`[dunning] could not open run for C-${reg.id}: ${String(err)}`);
    return false;
  }
}

async function resolveRun(db: D1Database, runId: number, resolution: string): Promise<void> {
  await db
    .prepare(
      `UPDATE course_dunning
          SET resolved_at = datetime('now'), resolution = ?
        WHERE id = ? AND resolved_at IS NULL`,
    )
    .bind(resolution, runId)
    .run();
}

// The invoice was paid (invoice.paid webhook) — close whatever run chases it,
// at once, so no reminder can slip out in the hour before the sweep notices.
export async function resolveDunningRunsForInvoice(
  db: D1Database,
  invoiceId: string,
  resolution: 'paid' | 'void',
): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE course_dunning
            SET resolved_at = datetime('now'), resolution = ?
          WHERE stripe_invoice_id = ? AND resolved_at IS NULL`,
      )
      .bind(resolution, invoiceId)
      .run();
  } catch {
    // Table not migrated yet (preview) — nothing to close.
  }
}

// The buyer used their link: note what happened on every open run for the
// plan (the admin list and the hand-off both show it), and close the ones
// whose invoices this attempt paid.
export async function recordCardUpdateOnRuns(
  db: D1Database,
  courseRegistrationId: number,
  o: CardUpdateOutcome,
): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE course_dunning
            SET card_updated_at = datetime('now'),
                card_update_outcome = ?,
                card_update_message = ?
          WHERE course_registration_id = ? AND resolved_at IS NULL`,
      )
      .bind(o.result, o.result === 'error' ? null : o.message, courseRegistrationId)
      .run();
    for (const id of o.paidInvoiceIds) {
      await db
        .prepare(
          `UPDATE course_dunning
              SET resolved_at = datetime('now'), resolution = 'paid'
            WHERE course_registration_id = ? AND stripe_invoice_id = ? AND resolved_at IS NULL`,
        )
        .bind(courseRegistrationId, id)
        .run();
    }
  } catch {
    // Table not migrated yet (preview).
  }
}

// ── Admin read side ─────────────────────────────────────────────────────────

// The run to show per plan: the open one if there is one, else the most recent
// resolved in the last two weeks (so "✓ paid after reminder 2" stays visible
// for a while). Empty when the table doesn't exist yet.
export async function loadDunningRunsByRegistration(
  db: D1Database,
): Promise<Map<number, DunningRun>> {
  const out = new Map<number, DunningRun>();
  try {
    const rows = await db
      .prepare(
        `SELECT * FROM course_dunning
          WHERE resolved_at IS NULL
             OR resolved_at >= datetime('now', '-14 days')
          ORDER BY (resolved_at IS NULL) ASC, opened_at ASC`,
      )
      .all<DunningRun>();
    // Ordered resolved-first, oldest-first, so a later/open run overwrites.
    for (const r of rows.results ?? []) out.set(r.course_registration_id, r);
  } catch {
    // No table yet.
  }
  return out;
}

function shortDate(ms: number, tz = 'Europe/Brussels'): string {
  try {
    return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: tz });
  } catch {
    return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
}

// The step a run is waiting on, and when it falls due (epoch ms).
export function nextDunningStep(
  run: DunningRun,
): { step: DunningStep | 'handoff'; dueMs: number } | null {
  if (run.resolved_at || run.escalated_at) return null;
  const r1 = sqlTimeMs(run.reminder1_sent_at);
  const r2 = sqlTimeMs(run.reminder2_sent_at);
  const r3 = sqlTimeMs(run.reminder3_sent_at);
  if (r1 == null) return { step: 1, dueMs: sqlTimeMs(run.opened_at) ?? 0 };
  if (r2 == null) return { step: 2, dueMs: r1 + DUNNING_GAP_DAYS.reminder2 * DAY_MS };
  if (r3 == null) return { step: 3, dueMs: r2 + DUNNING_GAP_DAYS.reminder3 * DAY_MS };
  return { step: 'handoff', dueMs: r3 + DUNNING_GAP_DAYS.handoff * DAY_MS };
}

// One line for the admin table: where the sequence stands.
export function dunningStatusLine(
  run: DunningRun,
): { text: string; tone: 'open' | 'handoff' | 'done' } {
  if (run.resolved_at) {
    const when = shortDate(sqlTimeMs(run.resolved_at) ?? Date.now());
    const sent = [run.reminder3_sent_at, run.reminder2_sent_at, run.reminder1_sent_at].findIndex(
      (s) => !!s,
    );
    const after = sent === -1 ? '' : ` after reminder ${3 - sent}`;
    const text =
      run.resolution === 'paid'
        ? `✓ Paid${after} · ${when}`
        : run.resolution === 'void'
          ? `Invoice voided in Stripe · ${when}`
          : `Reminders stopped (plan closed) · ${when}`;
    return { text, tone: 'done' };
  }
  if (run.escalated_at) {
    return {
      text: `Handed to support ${shortDate(sqlTimeMs(run.escalated_at) ?? Date.now())} — your call`,
      tone: 'handoff',
    };
  }
  const next = nextDunningStep(run);
  const lastSent = run.reminder3_sent_at
    ? `Reminder 3 sent ${shortDate(sqlTimeMs(run.reminder3_sent_at)!)}`
    : run.reminder2_sent_at
      ? `Reminder 2 sent ${shortDate(sqlTimeMs(run.reminder2_sent_at)!)}`
      : run.reminder1_sent_at
        ? `Reminder 1 sent ${shortDate(sqlTimeMs(run.reminder1_sent_at)!)}`
        : 'Reminder 1 queued';
  const nextText =
    next && next.step !== 1
      ? next.step === 'handoff'
        ? ` · to support ${shortDate(next.dueMs)}`
        : ` · next ${shortDate(next.dueMs)}`
      : '';
  return { text: `${lastSent}${nextText}`, tone: 'open' };
}

// ── The sweep ──────────────────────────────────────────────────────────────

export type DunningSweepResult = {
  skipped: boolean;
  opened: number;
  reminders: number;
  handoffs: number;
  resolved: number;
  failed: number;
};

function outstandingFor(
  reg: CourseRegistration,
  invoices: StripeInvoiceSummary[],
): { count: number; minor: number; currency: string | null } {
  const allowed = Math.max(0, effectiveTotal(reg) - reg.installments_paid);
  const capped = invoices.slice(0, allowed);
  return {
    count: capped.length,
    minor: capped.reduce(
      (s, i) => s + (i.status === 'draft' ? i.amount_due : i.amount_remaining),
      0,
    ),
    currency: capped[0]?.currency ?? null,
  };
}

function dueLabel(unixSeconds: number, tz: string | null): string {
  const d = new Date(unixSeconds * 1000);
  try {
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      timeZone: tz || 'Europe/Brussels',
    });
  } catch {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
  }
}

function recipients(env: DunningEnv): string[] {
  const list = (env.DUNNING_ALERTS_TO ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : [DUNNING_ALERTS_DEFAULT];
}

const STEP_COLUMN: Record<DunningStep | 'handoff', string> = {
  1: 'reminder1_sent_at',
  2: 'reminder2_sent_at',
  3: 'reminder3_sent_at',
  handoff: 'escalated_at',
};

async function claimStep(db: D1Database, runId: number, step: DunningStep | 'handoff'): Promise<boolean> {
  const col = STEP_COLUMN[step];
  const res = await db
    .prepare(`UPDATE course_dunning SET ${col} = datetime('now') WHERE id = ? AND ${col} IS NULL`)
    .bind(runId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

async function releaseStep(db: D1Database, runId: number, step: DunningStep | 'handoff'): Promise<void> {
  const col = STEP_COLUMN[step];
  await db.prepare(`UPDATE course_dunning SET ${col} = NULL WHERE id = ?`).bind(runId).run();
}

export async function runCourseDunning(
  env: DunningEnv,
  nowMs: number = Date.now(),
): Promise<DunningSweepResult> {
  const result: DunningSweepResult = {
    skipped: false,
    opened: 0,
    reminders: 0,
    handoffs: 0,
    resolved: 0,
    failed: 0,
  };
  const key = env.STRIPE_SECRET_KEY;
  if (!key || !env.RESEND_API_KEY) return { ...result, skipped: true };
  const db = env.DB;
  const base = (env.PUBLIC_BASE_URL || 'https://songdance.co').replace(/\/+$/, '');

  // 1. Seed: live plans Stripe says are behind, with no run open.
  let seeds: CourseRegistration[];
  try {
    seeds =
      (
        await db
          .prepare(
            `SELECT * FROM course_registrations r
              WHERE r.provider = 'stripe'
                AND r.installments_total > 1
                AND r.status = 'paid'
                AND r.installments_paid >= 1
                AND r.stripe_subscription_id IS NOT NULL
                AND r.subscription_status IN ('past_due', 'unpaid')
                AND NOT EXISTS (
                  SELECT 1 FROM course_dunning d
                   WHERE d.course_registration_id = r.id AND d.resolved_at IS NULL)
              LIMIT ?`,
          )
          .bind(MAX_SEED_PER_TICK)
          .all<CourseRegistration>()
      ).results ?? [];
  } catch {
    // course_dunning isn't there yet (migration 0085 not applied) — nothing to do.
    return { ...result, skipped: true };
  }
  for (const reg of seeds) {
    if (!dunningEligible(reg)) continue;
    try {
      const owed = await listOutstandingSubscriptionInvoices(key, reg.stripe_subscription_id!);
      // On a `past_due` plan: a charge that has actually been tried and
      // refused, not a fresh invoice Stripe is about to attempt. On an
      // `unpaid` one, anything outstanding — Stripe has stopped attempting
      // there, so its later invoices never get a failed charge to show.
      const failed = owed.find((i) =>
        reg.subscription_status === 'unpaid' ? true : i.status === 'open' && i.attempt_count > 0,
      );
      if (!failed) continue;
      if (
        await openDunningRun(db, reg, {
          id: failed.id,
          amountMinor: failed.amount_remaining,
          currency: failed.currency,
        })
      ) {
        result.opened++;
      }
    } catch (err) {
      console.error(`[dunning] seed C-${reg.id}: ${String(err)}`);
    }
  }

  // 2. Every open run: close it, wait, or take its next step.
  const runs =
    (
      await db
        .prepare(
          // Runs with a step still to take first: one already handed to
          // support only waits to be closed, and must never crowd a fresh
          // failure out of the tick.
          `SELECT * FROM course_dunning
            WHERE resolved_at IS NULL
            ORDER BY (escalated_at IS NOT NULL) ASC, opened_at ASC
            LIMIT ?`,
        )
        .bind(MAX_RUNS_PER_TICK)
        .all<DunningRun>()
    ).results ?? [];

  for (const run of runs) {
    try {
      const reg = await getCourseRegistrationById(db, run.course_registration_id);
      // Closed on our side: nothing more is sent.
      if (!reg || reg.provider === 'paypal' || reg.status === 'cancelled' || reg.status === 'refunded') {
        await resolveRun(db, run.id, 'stopped');
        result.resolved++;
        continue;
      }
      if (reg.installments_paid >= effectiveTotal(reg)) {
        await resolveRun(db, run.id, reg.installments_paid >= reg.installments_total ? 'paid' : 'stopped');
        result.resolved++;
        continue;
      }

      const next = nextDunningStep(run);
      const stepDue = next != null && nowMs >= next.dueMs;
      const lastCheck = sqlTimeMs(run.last_checked_at);
      const recheck = lastCheck == null || nowMs - lastCheck >= RECHECK_MS;
      if (!stepDue && !recheck) continue;

      // Live truth from Stripe. If it can't be read, send nothing this tick.
      const owed = await listOutstandingSubscriptionInvoices(key, reg.stripe_subscription_id!);
      let runInvoice = owed.find((i) => i.id === run.stripe_invoice_id) ?? null;
      if (!runInvoice) {
        const inv = await retrieveInvoice(key, run.stripe_invoice_id);
        if (inv.status === 'paid' || (inv.status === 'open' && inv.amount_remaining <= 0)) {
          await resolveRun(db, run.id, 'paid');
          result.resolved++;
          continue;
        }
        if (inv.status === 'void' || inv.status === 'uncollectible') {
          await resolveRun(db, run.id, 'void');
          result.resolved++;
          continue;
        }
        runInvoice = inv;
      }
      await db
        .prepare(`UPDATE course_dunning SET last_checked_at = datetime('now') WHERE id = ?`)
        .bind(run.id)
        .run();

      if (!next || !stepDue) continue;

      // The buyer has just acted — give the payment room to land.
      const cardAt = sqlTimeMs(run.card_updated_at);
      if (cardAt != null) {
        const hold = run.card_update_outcome === 'processing' ? PROCESSING_HOLD_MS : CARD_HOLD_MS;
        if (nowMs - cardAt < hold) continue;
      }

      const out = outstandingFor(reg, owed);
      const currency = (runInvoice.currency || out.currency || reg.currency || 'EUR').toUpperCase();
      const installmentMinor =
        runInvoice.status === 'draft' ? runInvoice.amount_due : runInvoice.amount_remaining;
      const installmentLabel = formatMoney(installmentMinor, currency);
      const outstandingCount = Math.max(1, out.count);
      const outstandingLabel = formatMoney(
        Math.max(out.minor, installmentMinor),
        out.currency ?? currency,
      );
      const updateUrl = await buildCardUpdateUrl(env.ADMIN_SESSION_SECRET, base, reg.id);
      const courseName = courseDisplayName(reg.product_slug);

      if (next.step !== 'handoff') {
        // Customer mail waits for their morning.
        if (!withinSendWindow(reg.timezone, nowMs)) continue;
        if (!(await claimStep(db, run.id, next.step))) continue;
        const content = dunningReminderEmail(next.step, {
          name: reg.first_name,
          courseName,
          installmentLabel,
          dueLabel: dueLabel(runInvoice.created, reg.timezone),
          outstandingCount,
          outstandingLabel,
          updateUrl,
        });
        try {
          await sendEmail({
            apiKey: env.RESEND_API_KEY,
            to: reg.email,
            subject: content.subject,
            html: content.html,
            text: content.text,
            entityRefId: `course-dunning-${run.id}-${next.step}`,
            track: { db, type: `course_dunning_${next.step}`, registrationId: null },
          });
          result.reminders++;
        } catch (err) {
          await releaseStep(db, run.id, next.step);
          result.failed++;
          console.error(`[dunning] reminder ${next.step} for C-${reg.id} failed: ${String(err)}`);
        }
        continue;
      }

      // Hand-off: three reminders out, still owed.
      if (!(await claimStep(db, run.id, 'handoff'))) continue;
      const orderNo = makeOrderNo('course', reg.id);
      const name = `${reg.first_name ?? ''} ${reg.last_name ?? ''}`.trim() || reg.email;
      const cardAtMs = sqlTimeMs(run.card_updated_at);
      const content = dunningEscalationEmail({
        orderNo,
        name,
        email: reg.email,
        courseName,
        plan: `${reg.installments_total}×`,
        installmentsPaid: reg.installments_paid,
        installmentsTotal: reg.installments_total,
        outstandingCount,
        outstandingLabel,
        invoiceNumber: runInvoice.number,
        dueLabel: dueLabel(runInvoice.created, 'Europe/Brussels'),
        stripeAttempts: runInvoice.attempt_count,
        subscriptionStatus: reg.subscription_status,
        reminders: [run.reminder1_sent_at, run.reminder2_sent_at, run.reminder3_sent_at]
          .map((s) => sqlTimeMs(s))
          .filter((ms): ms is number => ms != null)
          .map((ms) => shortDate(ms)),
        cardUpdate:
          cardAtMs != null && run.card_update_outcome
            ? {
                when: shortDate(cardAtMs),
                outcome: run.card_update_outcome,
                message: run.card_update_message,
              }
            : null,
        updateUrl,
        orderUrl: `${base}/admin/orders/${orderNo}`,
        futureRevenueUrl: `${base}/admin/courses/future-revenue`,
        stripeUrl: stripeSubscriptionUrl(stripeMode(env), reg.stripe_subscription_id!),
      });
      try {
        await sendEmail({
          apiKey: env.RESEND_API_KEY,
          to: recipients(env),
          subject: content.subject,
          html: content.html,
          text: content.text,
          entityRefId: `course-dunning-${run.id}-handoff`,
        });
        result.handoffs++;
        await logEventSafe(db, {
          registration_id: null,
          kind: 'course.dunning.handoff',
          source: 'system',
          external_id: `course-dunning-handoff-${run.id}`,
          payload: {
            course_registration_id: reg.id,
            invoice_id: run.stripe_invoice_id,
            outstanding_minor: out.minor,
            currency,
          },
        });
      } catch (err) {
        await releaseStep(db, run.id, 'handoff');
        result.failed++;
        console.error(`[dunning] hand-off for C-${reg.id} failed: ${String(err)}`);
      }
    } catch (err) {
      // One plan's Stripe blip never stops the others.
      result.failed++;
      console.error(`[dunning] run ${run.id}: ${String(err)}`);
    }
  }
  return result;
}
