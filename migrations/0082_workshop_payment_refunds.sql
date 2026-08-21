-- Partial refunds on workshop payments.
--
-- Until now a workshop refund was all-or-nothing: `charge.refunded` flipped
-- workshop_payments.status to 'refunded' and that was the whole record. Every
-- consumer then treated the payment as fully gone — /admin/stats drops it from
-- revenue (it filters status = 'paid'), and /admin/orders reports the refunded
-- amount as the entire charge. So refunding €5 of a €22 ticket erased all €22
-- from the figures, and left the order un-refundable for the remaining €17.
--
-- Courses and retreats already carry a running refunded total (migration 0016);
-- this gives workshop payments the same pair of columns, so a partial refund
-- subtracts only what was actually given back.
--
-- `status` now means what it says: 'refunded' = fully refunded. A partially
-- refunded payment stays 'paid' and carries the amount in the new column, which
-- is what keeps the existing `status = 'paid'` filters correct.

ALTER TABLE workshop_payments
  ADD COLUMN refunded_amount_minor INTEGER NOT NULL DEFAULT 0;

ALTER TABLE workshop_payments
  ADD COLUMN refunded_at TEXT;

-- Backfill: every row already marked 'refunded' was a full refund under the
-- old model (there was no way to record anything else), so the refunded amount
-- is the charge itself. `updated_at` is when the refund handler last touched
-- the row — the closest thing to a refund date we have for history.
UPDATE workshop_payments
   SET refunded_amount_minor = amount_minor,
       refunded_at = COALESCE(refunded_at, updated_at)
 WHERE status = 'refunded';
