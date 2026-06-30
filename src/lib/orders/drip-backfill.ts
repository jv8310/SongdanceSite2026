// One-shot historical backfill of Drip ecommerce orders.
//
// Migration 0057 seeds `drip_order_backfill` with one row per past paid
// purchase across all three tables (retreats, courses, workshops). This cron
// drain paces those out to Drip's Shopper Activity API so Drip's native
// lifetime value reflects the full purchase history — not just orders recorded
// from the day the live path shipped.
//
// Safety:
//   • GATED. Does nothing unless DRIP_BACKFILL_ENABLED is "1"/"true", so simply
//     deploying this never emits historical orders. The owner flips it on
//     deliberately (and flips it off when the queue is drained).
//   • Idempotent. Orders are keyed on order id (retreat-/course-/workshop-<id>),
//     so a row re-sent after a crash UPDATES the same Drip order instead of
//     double-counting. The queue's per-row status is just there to pace + track.
//   • Back-dated. Each order carries the purchase's real `occurred_at`, so a
//     historical drain doesn't look like a flood of "today" orders.
//   • Paced. A small batch per 5-minute tick with a gap between sends keeps us
//     well under Drip's ~3,600 req/hr limit and finishes inside the tick.

import { recordOrder, type DripOrder } from '../registrations/drip';
import {
  buildDripOrder,
  dripConfig,
  type PurchaseOrderItem,
} from './drip-order';
import { parsePurchasedBumps } from '../courses/db';
import { BUMPS, isBumpSlug } from '../courses/bumps';

type BackfillEnv = {
  DB: D1Database;
  DRIP_API_TOKEN?: string;
  DRIP_ACCOUNT_ID?: string;
  // "1" / "true" (case-insensitive) turns the drain on. Anything else = off.
  DRIP_BACKFILL_ENABLED?: string;
};

// Per-tick volume. ~120 sends × ~200ms gap ≈ 24s, comfortably inside the
// 5-minute tick and far under Drip's rate limit. Raise to drain faster.
const MAX_PER_TICK = 120;
const GAP_MS = 200;
const MAX_ATTEMPTS = 4;

const COURSE_ITEM_LABELS: Record<string, string> = {
  'cc-cert': 'SVH Certification',
  'cc-bundle': 'SVH Certification + Foundation bundle',
  'grief-course': 'The Grief Course',
  'svh-12week': '12-Week SVH Foundation Course',
};

type QueueRow = {
  id: number;
  order_type: 'retreat' | 'course' | 'workshop';
  source_id: number;
  email: string;
  occurred_at: string | null;
  attempts: number;
};

function enabled(env: BackfillEnv): boolean {
  const v = (env.DRIP_BACKFILL_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type DripBackfillResult = {
  skipped?: boolean;
  sent: number;
  failed: number;
  remaining: number;
};

export async function runDripOrderBackfill(
  env: BackfillEnv,
): Promise<DripBackfillResult> {
  if (!enabled(env)) return { skipped: true, sent: 0, failed: 0, remaining: 0 };
  const cfg = dripConfig(env);
  if (!cfg) return { skipped: true, sent: 0, failed: 0, remaining: 0 };

  // Recover rows a crashed/timed-out tick left mid-send — BEFORE the empty-queue
  // check. Otherwise a final batch stranded in 'sending' (zero rows left
  // 'pending') would make every later tick early-return and never recover them.
  await env.DB.prepare(
    `UPDATE drip_order_backfill SET status='pending'
      WHERE status='sending' AND claimed_at < datetime('now','-15 minutes')`,
  ).run();

  // The drain only matters while there's a queue — cheap to check, and lets the
  // cron stay wired forever without cost once everything's sent.
  const pendingBefore = await pendingCount(env.DB);
  if (pendingBefore === 0) return { sent: 0, failed: 0, remaining: 0 };

  const batch = await env.DB.prepare(
    `SELECT id, order_type, source_id, email, occurred_at, attempts
       FROM drip_order_backfill
      WHERE status='pending'
      ORDER BY (occurred_at IS NULL), occurred_at, id
      LIMIT ?`,
  )
    .bind(MAX_PER_TICK)
    .all<QueueRow>();
  const rows = batch.results ?? [];

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    // Claim atomically; skip if a concurrent tick already took it.
    const claim = await env.DB.prepare(
      `UPDATE drip_order_backfill
          SET status='sending', claimed_at=datetime('now'), attempts=attempts+1
        WHERE id=? AND status='pending'`,
    )
      .bind(row.id)
      .run();
    if ((claim.meta?.changes ?? 0) === 0) continue;

    try {
      const order = await buildBackfillOrder(env.DB, row);
      if (order) await recordOrder(cfg, order);
      // A vanished source row (order === null) is treated as done — nothing to
      // send and it never will be.
      await env.DB.prepare(
        `UPDATE drip_order_backfill SET status='sent', sent_at=datetime('now'), error=? WHERE id=?`,
      )
        .bind(order ? null : 'source_missing', row.id)
        .run();
      sent++;
    } catch (err) {
      const giveUp = row.attempts + 1 >= MAX_ATTEMPTS;
      await env.DB.prepare(
        `UPDATE drip_order_backfill SET status=?, error=? WHERE id=?`,
      )
        .bind(giveUp ? 'failed' : 'pending', String(err).slice(0, 500), row.id)
        .run();
      failed++;
    }
    await sleep(GAP_MS);
  }

  const remaining = await pendingCount(env.DB);
  return { sent, failed, remaining };
}

async function pendingCount(db: D1Database): Promise<number> {
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM drip_order_backfill WHERE status='pending'`)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

// Build the Drip order for one queued purchase by reading its source row(s).
// Returns null when the source row no longer exists.
async function buildBackfillOrder(
  db: D1Database,
  row: QueueRow,
): Promise<DripOrder | null> {
  if (row.order_type === 'retreat') return buildRetreatOrder(db, row);
  if (row.order_type === 'course') return buildCourseOrder(db, row);
  return buildWorkshopOrder(db, row);
}

async function buildRetreatOrder(
  db: D1Database,
  row: QueueRow,
): Promise<DripOrder | null> {
  const reg = await db
    .prepare(
      `SELECT id, email, currency, amount_cents, paid_at, product_id, tier_id, role
         FROM registrations WHERE id=?`,
    )
    .bind(row.source_id)
    .first<{
      id: number;
      email: string;
      currency: string;
      amount_cents: number;
      paid_at: string | null;
      product_id: number;
      tier_id: number;
      role: string | null;
    }>();
  if (!reg) return null;
  const product = await db
    .prepare('SELECT name, slug FROM products WHERE id=?')
    .bind(reg.product_id)
    .first<{ name: string; slug: string }>();
  const tier = await db
    .prepare('SELECT name, slug FROM tiers WHERE id=?')
    .bind(reg.tier_id)
    .first<{ name: string; slug: string }>();
  return buildDripOrder({
    type: 'retreat',
    id: reg.id,
    email: reg.email,
    currency: reg.currency,
    grandTotalCents: reg.amount_cents,
    occurredAt: row.occurred_at ?? reg.paid_at,
    items: [
      {
        name: tier
          ? `${product?.name ?? 'Retreat'} — ${tier.name}`
          : product?.name ?? 'Retreat',
        slug: product?.slug ?? null,
        amountCents: reg.amount_cents,
      },
    ],
    properties: {
      product_slug: product?.slug ?? '',
      tier_slug: tier?.slug ?? '',
      role: reg.role ?? '',
      backfill: 'yes',
    },
  });
}

async function buildCourseOrder(
  db: D1Database,
  row: QueueRow,
): Promise<DripOrder | null> {
  const reg = await db
    .prepare(
      `SELECT id, email, currency, amount_cents, bumps, paid_at, product_slug,
              payment_plan, installments_total, activate_choice, language_choice,
              source_variant
         FROM course_registrations WHERE id=?`,
    )
    .bind(row.source_id)
    .first<{
      id: number;
      email: string;
      currency: string;
      amount_cents: number;
      bumps: string | null;
      paid_at: string | null;
      product_slug: string;
      payment_plan: string;
      installments_total: number;
      activate_choice: string | null;
      language_choice: string | null;
      source_variant: string | null;
    }>();
  if (!reg) return null;
  const bumps = parsePurchasedBumps(reg.bumps);
  const bumpItems: PurchaseOrderItem[] = bumps.map((b) => ({
    name: isBumpSlug(b.slug) ? BUMPS[b.slug].label : b.slug,
    slug: b.slug,
    amountCents: b.amount_cents,
  }));
  const bumpTotal = bumps.reduce((s, b) => s + b.amount_cents, 0);
  return buildDripOrder({
    type: 'course',
    id: reg.id,
    email: reg.email,
    currency: reg.currency,
    grandTotalCents: reg.amount_cents + bumpTotal,
    occurredAt: row.occurred_at ?? reg.paid_at,
    items: [
      {
        name: COURSE_ITEM_LABELS[reg.product_slug] ?? reg.product_slug,
        slug: reg.product_slug,
        amountCents: reg.amount_cents,
      },
      ...bumpItems,
    ],
    properties: {
      product_slug: reg.product_slug,
      payment_plan: reg.payment_plan,
      installments_total: reg.installments_total,
      activate_choice: reg.activate_choice ?? '',
      journey_language: reg.language_choice ?? '',
      source_variant: reg.source_variant ?? '',
      backfill: 'yes',
    },
  });
}

async function buildWorkshopOrder(
  db: D1Database,
  row: QueueRow,
): Promise<DripOrder | null> {
  const reg = await db
    .prepare(
      `SELECT id, email, currency, wants_bump, payment_status, created_at
         FROM workshop_registrations WHERE id=?`,
    )
    .bind(row.source_id)
    .first<{
      id: number;
      email: string;
      currency: string | null;
      wants_bump: number;
      payment_status: string;
      created_at: string;
    }>();
  if (!reg) return null;
  const workshop = await db
    .prepare(
      `SELECT title, slug FROM workshops w
         JOIN workshop_registrations r ON r.workshop_id = w.id
        WHERE r.id=?`,
    )
    .bind(row.source_id)
    .first<{ title: string; slug: string }>();

  // Total actually paid + its currency (from the paid payment rows).
  const pay = await db
    .prepare(
      `SELECT SUM(amount_minor) AS total, MAX(currency) AS currency
         FROM workshop_payments WHERE registration_id=? AND status='paid'`,
    )
    .bind(row.source_id)
    .first<{ total: number | null; currency: string | null }>();
  const grandTotalCents = pay?.total ?? 0;
  const currency = pay?.currency || reg.currency || 'EUR';

  // Line items from the paid payments, with product names; fall back to a
  // single "ticket = the workshop" line when there are no itemised purchases.
  const lines = await db
    .prepare(
      `SELECT prod.name AS name, prod.slug AS slug, pur.amount_minor AS amount_minor,
              pur.product_type AS product_type
         FROM workshop_purchases pur
         JOIN workshop_payments p ON p.id = pur.payment_id AND p.status='paid'
         LEFT JOIN workshop_products prod ON prod.id = pur.product_id
        WHERE pur.registration_id=?`,
    )
    .bind(row.source_id)
    .all<{
      name: string | null;
      slug: string | null;
      amount_minor: number;
      product_type: string;
    }>();
  const items: PurchaseOrderItem[] =
    (lines.results ?? []).length > 0
      ? (lines.results ?? []).map((l) => ({
          name: l.name || workshop?.title || 'Workshop',
          slug: l.slug ?? workshop?.slug ?? null,
          amountCents: l.amount_minor,
        }))
      : [
          {
            name: workshop?.title || 'Workshop',
            slug: workshop?.slug ?? null,
            amountCents: grandTotalCents,
          },
        ];

  return buildDripOrder({
    type: 'workshop',
    id: reg.id,
    email: reg.email,
    currency,
    grandTotalCents,
    occurredAt: row.occurred_at ?? reg.created_at,
    items,
    properties: {
      workshop_slug: workshop?.slug ?? '',
      bump: reg.wants_bump ? 'yes' : 'no',
      payment_status: reg.payment_status,
      backfill: 'yes',
    },
  });
}

// Exported only so a future admin status page can read progress without
// duplicating the query.
export async function dripBackfillProgress(
  db: D1Database,
): Promise<{ pending: number; sent: number; failed: number; total: number }> {
  const r = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status IN ('pending','sending') THEN 1 ELSE 0 END) AS pending,
         COUNT(*) AS total
       FROM drip_order_backfill`,
    )
    .first<{ sent: number; failed: number; pending: number; total: number }>();
  return {
    pending: r?.pending ?? 0,
    sent: r?.sent ?? 0,
    failed: r?.failed ?? 0,
    total: r?.total ?? 0,
  };
}
