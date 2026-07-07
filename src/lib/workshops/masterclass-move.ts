// One-shot drain that moves secured seats from one Somatic Vocal Healing
// Masterclass onto another and emails each person that their seat has moved.
//
// Migration 0059 seeds `masterclass_seat_move` with one row per secured seat on
// masterclass-4 that isn't already on masterclass-5 (see that file for who and
// why). This cron drain — wired into the 5-minute tick in worker-entrypoint.ts
// — does the actual work one registration at a time, reusing the exact same
// primitives as the on-site "move me to another date" flow:
//
//   moveRegistrationToWorkshop()      the seat travels; the old date stops
//                                     reminding/counting them, the new date
//                                     picks up its own cadence from scratch
//   sendWorkshopDateChangedForMove()  Drip re-tag + the transactional
//                                     "your place has moved, same seat, new
//                                     day" email (paid-handler.ts)
//
// Safety, mirroring the Drip order backfill (src/lib/orders/drip-backfill.ts):
//   • GATED. Does nothing unless MASTERCLASS_MOVE_ENABLED is "1"/"true"/…, so
//     merging/deploying this never moves or emails anyone on its own; the owner
//     flips it on deliberately and back off (or leaves it — a drained queue
//     makes every later tick a no-op).
//   • Never moves a seat it can't then email — the move and the notice are one
//     job, so a missing RESEND_API_KEY skips the whole run rather than leaving
//     silently-moved seats.
//   • Idempotent + paced. Each row is claimed atomically (pending → moving), so
//     two overlapping ticks can't both process it; the move is a no-op once the
//     seat is already on target, and the email carries a stable ref so an
//     accidental resend threads/dedups client-side. A crash mid-row leaves it
//     pending (recovered after 15 min) to retry.
//   • Self-stopping. Once the queue is empty every tick early-returns cheaply,
//     so the cron can stay wired forever at no cost.

import {
  getRegistrationById,
  getWorkshopById,
  moveRegistrationToWorkshop,
} from './db';
import { sendWorkshopDateChangedForMove } from './paid-handler';

type MoveEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  RESEND_REPLY_TO?: string;
  PUBLIC_BASE_URL: string;
  DRIP_API_TOKEN?: string;
  DRIP_ACCOUNT_ID?: string;
  // "1"/"true"/"yes"/"on" (case-insensitive) turns the drain on. Anything else
  // (incl. unset / "false") keeps it off.
  MASTERCLASS_MOVE_ENABLED?: string;
} & Record<string, unknown>;

// Per-tick volume. 50 seats × 600ms gap ≈ 30s of single Resend sends, well
// inside the 5-minute tick and under Resend's ~2 req/s. A bigger class just
// takes a few more ticks to drain.
const MAX_PER_TICK = 50;
const GAP_MS = 600;
const MAX_ATTEMPTS = 4;
const STUCK_MINUTES = 15;

function enabled(env: MoveEnv): boolean {
  const v = (env.MASTERCLASS_MOVE_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type QueueRow = {
  id: number;
  registration_id: number;
  source_workshop_id: number;
  target_workshop_id: number;
  attempts: number;
};

export type MasterclassSeatMoveResult = {
  skipped?: boolean;
  moved: number; // seats moved + emailed this tick
  noop: number; // rows resolved without a move (already on target / conflict / gone)
  failed: number; // rows that errored this tick (retry unless exhausted)
  remaining: number;
};

export async function runMasterclassSeatMove(
  env: MoveEnv,
): Promise<MasterclassSeatMoveResult> {
  const idle = { moved: 0, noop: 0, failed: 0, remaining: 0 };
  if (!enabled(env)) return { skipped: true, ...idle };
  // The move and the "your seat moved" note are one job — never split them.
  if (!env.RESEND_API_KEY) return { skipped: true, ...idle };

  // Recover rows a crashed/timed-out tick stranded in 'moving', BEFORE the
  // empty-queue check — otherwise a final stranded batch (zero 'pending' left)
  // would make every later tick early-return and never recover them.
  try {
    await env.DB.prepare(
      `UPDATE masterclass_seat_move SET status='pending'
        WHERE status='moving' AND claimed_at < datetime('now','-${STUCK_MINUTES} minutes')`,
    ).run();
  } catch {
    // Queue table not present yet (migrations apply in a separate workflow from
    // the code deploy). The gate is off by default, so by the time it's flipped
    // on the table exists; treat a missing table as an idle no-op, not an error.
    return { skipped: true, ...idle };
  }

  const pendingBefore = await pendingCount(env.DB);
  if (pendingBefore === 0) return idle;

  const batch = await env.DB.prepare(
    `SELECT id, registration_id, source_workshop_id, target_workshop_id, attempts
       FROM masterclass_seat_move
      WHERE status='pending'
      ORDER BY id
      LIMIT ?`,
  )
    .bind(MAX_PER_TICK)
    .all<QueueRow>();
  const rows = batch.results ?? [];
  if (rows.length === 0) return { moved: 0, noop: 0, failed: 0, remaining: pendingBefore };

  // Validate the shared target once. If it's gone/soft-deleted, don't move
  // anyone onto a dead date — leave the queue pending so a corrected target can
  // still drain it later (every row in the seed shares one target).
  const target = await getWorkshopById(env.DB, rows[0].target_workshop_id);
  if (!target || target.deleted === 1) {
    return { skipped: true, moved: 0, noop: 0, failed: 0, remaining: pendingBefore };
  }

  let moved = 0;
  let noop = 0;
  let failed = 0;
  for (const row of rows) {
    // Claim atomically; skip if a concurrent tick already took it.
    const claim = await env.DB.prepare(
      `UPDATE masterclass_seat_move
          SET status='moving', claimed_at=datetime('now'), attempts=attempts+1
        WHERE id=? AND status='pending'`,
    )
      .bind(row.id)
      .run();
    if ((claim.meta?.changes ?? 0) === 0) continue;

    try {
      const reg = await getRegistrationById(env.DB, row.registration_id);
      if (!reg) {
        await finish(env.DB, row.id, 'skipped', 'reg_missing');
        noop++;
        continue;
      }
      // Only ever move a secured seat (matches the seed + the on-site flow).
      if (reg.payment_status !== 'paid' && reg.payment_status !== 'coupon') {
        await finish(env.DB, row.id, 'skipped', 'not_secured');
        noop++;
        continue;
      }

      if (reg.workshop_id === row.source_workshop_id) {
        const res = await moveRegistrationToWorkshop(
          env.DB,
          row.registration_id,
          row.target_workshop_id,
        );
        if (!res.ok) {
          // already_on_target: a *different* registration already holds this
          // person's seat on masterclass-5 → keep the one seat, don't email.
          // not_found is unreachable here (reg just loaded) — treated the same.
          await finish(env.DB, row.id, 'skipped', res.reason);
          noop++;
          continue;
        }
        // moved → fall through to the notice
      } else if (reg.workshop_id !== row.target_workshop_id) {
        // Seat has since travelled somewhere other than the target — leave it.
        await finish(env.DB, row.id, 'skipped', 'not_on_source');
        noop++;
        continue;
      }
      // reg is on the target now (moved just now, or already there from a
      // retried tick): send the "your place has moved" note. Rethrows on a send
      // failure so the row stays pending and retries.
      await sendWorkshopDateChangedForMove(
        env,
        row.registration_id,
        `masterclass-move-${row.registration_id}`,
      );
      await finish(env.DB, row.id, 'done', null);
      moved++;
    } catch (err) {
      const giveUp = row.attempts + 1 >= MAX_ATTEMPTS;
      await env.DB.prepare(
        `UPDATE masterclass_seat_move SET status=?, error=? WHERE id=?`,
      )
        .bind(giveUp ? 'failed' : 'pending', String(err).slice(0, 500), row.id)
        .run();
      failed++;
    }
    await sleep(GAP_MS);
  }

  const remaining = await pendingCount(env.DB);
  return { moved, noop, failed, remaining };
}

async function finish(
  db: D1Database,
  id: number,
  status: 'done' | 'skipped',
  error: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE masterclass_seat_move SET status=?, error=?, done_at=datetime('now') WHERE id=?`,
    )
    .bind(status, error, id)
    .run();
}

async function pendingCount(db: D1Database): Promise<number> {
  const r = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM masterclass_seat_move WHERE status IN ('pending','moving')`,
    )
    .first<{ n: number }>();
  return r?.n ?? 0;
}

// Exported so a future admin status view can read progress without duplicating
// the query.
export async function masterclassSeatMoveProgress(
  db: D1Database,
): Promise<{ pending: number; done: number; skipped: number; failed: number; total: number }> {
  const r = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('pending','moving') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) AS skipped,
         SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
         COUNT(*) AS total
       FROM masterclass_seat_move`,
    )
    .first<{ pending: number; done: number; skipped: number; failed: number; total: number }>();
  return {
    pending: r?.pending ?? 0,
    done: r?.done ?? 0,
    skipped: r?.skipped ?? 0,
    failed: r?.failed ?? 0,
    total: r?.total ?? 0,
  };
}
