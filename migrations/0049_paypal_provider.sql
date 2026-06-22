-- PayPal as a second payment gateway alongside Stripe.
--
-- A direct PayPal Business integration (NOT PayPal-via-Stripe): one-off
-- payments use the Orders API v2 (create → approve → capture); installment
-- plans use the Subscriptions API with a fixed `total_cycles = N` billing plan,
-- which completes after exactly N monthly charges (the PayPal-native equivalent
-- of the Stripe cancel_at trick).
--
-- A `provider` column records which gateway owns each row ('stripe' default, so
-- every existing row keeps behaving exactly as before). PayPal object ids live
-- in their own columns next to the Stripe ones; the dashboards / refund / future-
-- revenue forecast read the right id per provider. `subscription_status` keeps
-- mirroring the Stripe vocabulary — the PayPal webhook normalises PayPal
-- subscription statuses into it (see normalizePaypalSubStatus) so the course
-- detail badge + installment forecast stay provider-agnostic.

-- ── course_registrations (courses: one-off + 3x/6x/12x installments) ────────
ALTER TABLE course_registrations
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE course_registrations
  ADD COLUMN paypal_order_id TEXT;        -- one-off Orders API order id
ALTER TABLE course_registrations
  ADD COLUMN paypal_capture_id TEXT;      -- captured payment id (refund target)
ALTER TABLE course_registrations
  ADD COLUMN paypal_subscription_id TEXT; -- installment subscription id

CREATE UNIQUE INDEX idx_course_registrations_paypal_order
  ON course_registrations(paypal_order_id)
  WHERE paypal_order_id IS NOT NULL;
CREATE UNIQUE INDEX idx_course_registrations_paypal_subscription
  ON course_registrations(paypal_subscription_id)
  WHERE paypal_subscription_id IS NOT NULL;

-- ── registrations (retreats: one-off + 50% deposit/balance) ─────────────────
ALTER TABLE registrations
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE registrations
  ADD COLUMN paypal_order_id TEXT;        -- one-off / deposit order id
ALTER TABLE registrations
  ADD COLUMN paypal_capture_id TEXT;      -- captured payment id (refund target)
-- The balance ("pay the remainder") second payment, when settled via PayPal.
ALTER TABLE registrations
  ADD COLUMN balance_paypal_order_id TEXT;

CREATE UNIQUE INDEX idx_registrations_paypal_order
  ON registrations(paypal_order_id)
  WHERE paypal_order_id IS NOT NULL;

-- ── workshop_payments (workshops/masterclass: one-off) ──────────────────────
-- This table already carries `provider` (DEFAULT 'stripe') and a `method`
-- column. Add PayPal id columns so a PayPal ticket sale records its order +
-- capture for the stats / refund paths.
ALTER TABLE workshop_payments
  ADD COLUMN paypal_order_id TEXT;
ALTER TABLE workshop_payments
  ADD COLUMN paypal_capture_id TEXT;
