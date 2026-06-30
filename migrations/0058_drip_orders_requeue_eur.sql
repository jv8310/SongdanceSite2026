-- Re-push every Drip order after the EUR-amount fix.
--
-- Orders had been sent in their charge currency (e.g. 49 SEK), which Drip read
-- against the account currency — so non-EUR purchases landed ~10x inflated
-- (€49 instead of ~€4.5). The builder now converts everything to EUR
-- (src/lib/orders/drip-order.ts). This migration re-sends every order through
-- the corrected drain. Orders are idempotent on order_id (retreat-/course-/
-- workshop-<id>), so each re-send UPDATES the existing Drip order's amount and
-- currency and Drip recomputes lifetime value — no duplicates.
--
-- Ordering note: this ships in a later deploy than the builder fix, so the
-- corrected code is already the live Worker (and the drain was paused in
-- between) by the time these rows reset to pending — nothing re-sends with the
-- old amounts.

-- 1) Re-seed (idempotent) to catch any purchases placed while the un-converted
--    code was briefly live, so they get corrected too.
INSERT OR IGNORE INTO drip_order_backfill (order_type, source_id, email, occurred_at)
  SELECT 'retreat', id, email, paid_at
    FROM registrations
   WHERE paid_at IS NOT NULL;

INSERT OR IGNORE INTO drip_order_backfill (order_type, source_id, email, occurred_at)
  SELECT 'course', id, email, paid_at
    FROM course_registrations
   WHERE paid_at IS NOT NULL
     AND status NOT IN ('pending','expired');

INSERT OR IGNORE INTO drip_order_backfill (order_type, source_id, email, occurred_at)
  SELECT 'workshop', wr.id, wr.email,
         COALESCE(
           (SELECT MIN(wp.created_at) FROM workshop_payments wp
             WHERE wp.registration_id = wr.id AND wp.status = 'paid'),
           wr.created_at)
    FROM workshop_registrations wr
   WHERE wr.payment_status IN ('paid','coupon');

-- 2) Reset every row (sent / failed / pending alike) so the corrected drain
--    re-sends all orders in EUR.
UPDATE drip_order_backfill
   SET status = 'pending', attempts = 0, error = NULL,
       claimed_at = NULL, sent_at = NULL;
