-- Native Drip ecommerce ("Shopper Activity") orders + lifetime value.
--
-- Two things ship here:
--
-- 1. A `timezone` column on the two purchase tables that lacked one
--    (registrations / course_registrations). Workshops already store the
--    buyer's IANA timezone; retreats and courses now capture the edge-detected
--    cf.timezone at checkout, so every purchase can forward a real timezone to
--    the Drip subscriber (its native time_zone drives local-time sending).
--
-- 2. A one-shot backfill queue. Going forward, every paid purchase records a
--    Drip order (src/lib/orders/drip-order.ts, wired into the three paid
--    handlers), which is how Drip natively tracks lifetime value. To bring the
--    HISTORY across, we enumerate every past paid purchase into
--    `drip_order_backfill`; the cron drain (src/lib/orders/drip-backfill.ts)
--    paces them out to Drip, building each order with the same shared builder
--    the live path uses. Orders are idempotent on their order id
--    (retreat-/course-/workshop-<id>), so a row sent twice updates the same
--    order and never double-counts revenue.
--
-- This migration runs once (wrangler d1 migrations apply), so the seed captures
-- exactly the purchases that exist at apply time; everything after flows
-- through the live path. The drain itself is GATED behind an env switch
-- (DRIP_BACKFILL_ENABLED) so deploying this never blasts Drip on its own —
-- the owner turns it on deliberately once any order-triggered Drip automations
-- are safe for historical, back-dated orders.

ALTER TABLE registrations ADD COLUMN timezone TEXT;
ALTER TABLE course_registrations ADD COLUMN timezone TEXT;

-- One row per past paid purchase, drained to Drip as an ecommerce order.
CREATE TABLE IF NOT EXISTS drip_order_backfill (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_type  TEXT NOT NULL,                       -- 'retreat' | 'course' | 'workshop'
  source_id   INTEGER NOT NULL,                    -- row id in the source table
  email       TEXT NOT NULL,
  occurred_at TEXT,                                -- when it was paid (drives order timestamp + oldest-first order)
  status      TEXT NOT NULL DEFAULT 'pending',     -- pending | sent | failed
  attempts    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  claimed_at  TEXT,
  sent_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(order_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_drip_order_backfill_status
  ON drip_order_backfill(status, occurred_at);

-- Seed: retreats that ever paid (paid_at set, including later refunded rows —
-- they did transact). amount_cents is the running total received.
INSERT OR IGNORE INTO drip_order_backfill (order_type, source_id, email, occurred_at)
  SELECT 'retreat', id, email, paid_at
    FROM registrations
   WHERE paid_at IS NOT NULL;

-- Seed: course registrations that ever collected money (mirrors the stats
-- definition — paid_at set, not a pending/expired session). Includes free
-- comps (amount 0) just as the live path records a 0-value order for them.
INSERT OR IGNORE INTO drip_order_backfill (order_type, source_id, email, occurred_at)
  SELECT 'course', id, email, paid_at
    FROM course_registrations
   WHERE paid_at IS NOT NULL
     AND status NOT IN ('pending','expired');

-- Seed: workshop registrations that completed (paid or coupon-free). The order
-- timestamp is the paid payment's time, falling back to the registration's
-- own created_at for coupon seats that have no payment row.
INSERT OR IGNORE INTO drip_order_backfill (order_type, source_id, email, occurred_at)
  SELECT 'workshop', wr.id, wr.email,
         COALESCE(
           (SELECT MIN(wp.created_at) FROM workshop_payments wp
             WHERE wp.registration_id = wr.id AND wp.status = 'paid'),
           wr.created_at)
    FROM workshop_registrations wr
   WHERE wr.payment_status IN ('paid','coupon');
