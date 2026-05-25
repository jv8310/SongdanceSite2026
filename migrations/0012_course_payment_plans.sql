-- Support 3-monthly-installment payment plans on course registrations.
--
-- payment_plan = 'full' → existing one-off Stripe Checkout (mode=payment).
-- payment_plan = '3x'   → Stripe Checkout (mode=subscription) creates a
--                         monthly subscription with cancel_at ≈ 75 days from
--                         creation, which yields exactly 3 monthly charges
--                         (invoice at day 0 / ~30 / ~60, then auto-cancel
--                         before day ~90 would-be invoice).
--
-- installments_paid is incremented on every invoice.paid webhook so the
-- admin can see "1 / 3", "2 / 3", "3 / 3" without recomputing from Stripe.

ALTER TABLE course_registrations
  ADD COLUMN payment_plan TEXT NOT NULL DEFAULT 'full';

ALTER TABLE course_registrations
  ADD COLUMN stripe_subscription_id TEXT;

ALTER TABLE course_registrations
  ADD COLUMN installments_paid INTEGER NOT NULL DEFAULT 0;

ALTER TABLE course_registrations
  ADD COLUMN installments_total INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX idx_course_registrations_subscription
  ON course_registrations(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
