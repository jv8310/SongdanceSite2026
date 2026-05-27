-- Track Stripe-side subscription lifecycle + refunds end-to-end.
--
-- Until now the only post-paid transitions the webhook listened for were
-- `invoice.paid` (bump installments) and `invoice.payment_failed` (log
-- only). A cancellation on the Stripe dashboard, or a refund issued from
-- there, never made it back to D1 — the row stayed `paid`.
--
-- This migration adds:
--   • `subscription_status` mirrors Stripe's subscription.status enum
--     (active, past_due, unpaid, canceled, incomplete, incomplete_expired,
--     trialing, paused). Only meaningful on installment plans.
--   • `cancelled_at` / `refunded_at` timestamps.
--   • `refunded_amount_cents` total refunded (supports partial refunds).
--
-- The existing CHECK constraint on `course_registrations.status` already
-- permits 'cancelled' and 'refunded', so the new webhook code can flip
-- the row without a schema change to the enum.

ALTER TABLE course_registrations
  ADD COLUMN subscription_status TEXT;

ALTER TABLE course_registrations
  ADD COLUMN cancelled_at TEXT;

ALTER TABLE course_registrations
  ADD COLUMN refunded_at TEXT;

ALTER TABLE course_registrations
  ADD COLUMN refunded_amount_cents INTEGER NOT NULL DEFAULT 0;

-- `registrations` already has `cancelled_at`; just add the refund pair.
ALTER TABLE registrations
  ADD COLUMN refunded_at TEXT;

ALTER TABLE registrations
  ADD COLUMN refunded_amount_cents INTEGER NOT NULL DEFAULT 0;
