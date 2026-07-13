// One-shot historical backfill of order → contact tags.
//
// Migration 0068 seeds `contact_tag_backfill` with one row per past paid
// purchase across the three tables (retreats, courses, workshops). This cron
// drain reads each row, recomputes its Drip tags with the SAME builders the live
// paid-handlers use (workshop/course/retreat drip-tags.ts), and mirrors them
// onto the local People/contacts list via the shared writer — so a tag applied
// to a buyer at purchase time becomes searchable/targetable on the contacts list
// even for orders placed before the live mirror shipped.
//
// Safety:
//   • Local-only. Writes ONLY to our own D1 (contacts / contact_tags) — no
//     external API, no Drip automations — so it needs no env gate and can drain
//     on the shared cron without side effects. It no-ops entirely once drained.
//   • Idempotent. writeContactTags upserts the contact (COALESCE) and adds tags
//     INSERT OR IGNORE on (email, tag), so a row re-run — or a buyer also touched
//     by the live path — adds nothing new.
//   • Paced. A modest batch per 5-minute tick keeps well inside the tick and
//     under the Worker's subrequest budget (shared with the other cron tasks).

import { writeContactTags } from './mirror';
import { getRegistrationById as getRetreatRegistration } from '../registrations/db';
import { retreatDripTags } from '../registrations/drip-tags';
import { getCourseRegistrationById } from '../courses/db';
import { courseDripTags } from '../courses/drip-tags';
import {
  getRegistrationById as getWorkshopRegistration,
  getWorkshopById,
  getProductById,
} from '../workshops/db';
import { workshopDripTags } from '../workshops/drip-tags';

type BackfillEnv = { DB: D1Database };

// Per-tick volume. Local D1 writes only (no external rate limit), so no
// inter-row gap; kept modest so it shares the tick's subrequest budget with the
// workshop cron / broadcasts / other backfills. Raise to drain faster.
const MAX_PER_TICK = 100;
const MAX_ATTEMPTS = 4;

type QueueRow = {
  id: number;
  order_type: 'retreat' | 'course' | 'workshop';
  source_id: number;
  attempts: number;
};

export type ContactTagBackfillResult = {
  done: number;
  failed: number;
  remaining: number;
};

export async function runContactTagBackfill(
  env: BackfillEnv,
): Promise<ContactTagBackfillResult> {
  // Recover rows a crashed/timed-out tick left mid-write — BEFORE the empty
  // check, so a final batch stranded in 'sending' can still be recovered.
  await env.DB.prepare(
    `UPDATE contact_tag_backfill SET status='pending'
      WHERE status='sending' AND claimed_at < datetime('now','-15 minutes')`,
  ).run();

  // Cheap self-stop: once the queue is drained this early-returns every tick, so
  // the cron can stay wired forever at no cost.
  const pendingBefore = await pendingCount(env.DB);
  if (pendingBefore === 0) return { done: 0, failed: 0, remaining: 0 };

  const batch = await env.DB.prepare(
    `SELECT id, order_type, source_id, attempts
       FROM contact_tag_backfill
      WHERE status='pending'
      ORDER BY id
      LIMIT ?`,
  )
    .bind(MAX_PER_TICK)
    .all<QueueRow>();
  const rows = batch.results ?? [];

  let done = 0;
  let failed = 0;
  for (const row of rows) {
    // Claim atomically; skip if a concurrent tick already took it.
    const claim = await env.DB.prepare(
      `UPDATE contact_tag_backfill
          SET status='sending', claimed_at=datetime('now'), attempts=attempts+1
        WHERE id=? AND status='pending'`,
    )
      .bind(row.id)
      .run();
    if ((claim.meta?.changes ?? 0) === 0) continue;

    try {
      const existed = await mirrorOne(env.DB, row);
      // A vanished source row (existed === false) is treated as done — nothing
      // to mirror and it never will be.
      await env.DB.prepare(
        `UPDATE contact_tag_backfill SET status='done', done_at=datetime('now'), error=? WHERE id=?`,
      )
        .bind(existed ? null : 'source_missing', row.id)
        .run();
      done++;
    } catch (err) {
      const giveUp = row.attempts + 1 >= MAX_ATTEMPTS;
      await env.DB.prepare(
        `UPDATE contact_tag_backfill SET status=?, error=? WHERE id=?`,
      )
        .bind(giveUp ? 'failed' : 'pending', String(err).slice(0, 500), row.id)
        .run();
      failed++;
    }
  }

  const remaining = await pendingCount(env.DB);
  return { done, failed, remaining };
}

async function pendingCount(db: D1Database): Promise<number> {
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM contact_tag_backfill WHERE status='pending'`)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

// Mirror one queued purchase's tags onto contacts/contact_tags. Returns false
// when the source row no longer exists (nothing to do).
async function mirrorOne(db: D1Database, row: QueueRow): Promise<boolean> {
  if (row.order_type === 'workshop') return mirrorWorkshop(db, row.source_id);
  if (row.order_type === 'course') return mirrorCourse(db, row.source_id);
  return mirrorRetreat(db, row.source_id);
}

async function mirrorWorkshop(db: D1Database, id: number): Promise<boolean> {
  const reg = await getWorkshopRegistration(db, id);
  if (!reg) return false;
  const workshop = await getWorkshopById(db, reg.workshop_id);
  if (!workshop) return false;
  const bump =
    reg.wants_bump && workshop.bump_product_id
      ? await getProductById(db, workshop.bump_product_id)
      : null;
  const tags = workshopDripTags(reg, workshop, bump);
  await writeContactTags(db, {
    email: reg.email,
    name: reg.name,
    timezone: reg.timezone,
    country: reg.country,
    tags,
    source: 'workshop-order',
  });
  return true;
}

async function mirrorCourse(db: D1Database, id: number): Promise<boolean> {
  const reg = await getCourseRegistrationById(db, id);
  if (!reg) return false;
  const tags = courseDripTags(reg);
  await writeContactTags(db, {
    email: reg.email,
    name: [reg.first_name, reg.last_name].filter(Boolean).join(' ') || null,
    timezone: reg.timezone,
    country: reg.country,
    tags,
    source: 'course-order',
  });
  return true;
}

async function mirrorRetreat(db: D1Database, id: number): Promise<boolean> {
  const reg = await getRetreatRegistration(db, id);
  if (!reg) return false;
  const product = await db
    .prepare('SELECT slug, drip_tag FROM products WHERE id = ?')
    .bind(reg.product_id)
    .first<{ slug: string; drip_tag: string | null }>();
  const tags = retreatDripTags(product);
  await writeContactTags(db, {
    email: reg.email,
    name: reg.name,
    timezone: reg.timezone,
    country: reg.country,
    tags,
    source: 'retreat-order',
  });
  return true;
}

// Exported so an admin status view can read progress without duplicating the SQL.
export async function contactTagBackfillProgress(
  db: D1Database,
): Promise<{ pending: number; done: number; failed: number; total: number }> {
  const r = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status IN ('pending','sending') THEN 1 ELSE 0 END) AS pending,
         COUNT(*) AS total
       FROM contact_tag_backfill`,
    )
    .first<{ done: number; failed: number; pending: number; total: number }>();
  return {
    pending: r?.pending ?? 0,
    done: r?.done ?? 0,
    failed: r?.failed ?? 0,
    total: r?.total ?? 0,
  };
}
