-- Failed installment payments: three reminders, then a hand-off to support.
--
-- A Stripe installment plan whose monthly charge fails used to go quiet on our
-- side: the webhook logged the failure (and not even that — it reused the
-- event's own id and hit the unique index), the row sat at `past_due` /
-- `unpaid` on /admin/courses/future-revenue, and the only way to chase it was
-- by hand. Now each failed installment opens one run here
-- (src/lib/courses/dunning.ts):
--
--   reminder 1  as soon as it's seen (held to the buyer's local 08:00–21:00)
--   reminder 2  3 days after reminder 1
--   reminder 3  4 days after reminder 2
--   escalation  3 days after reminder 3, still unpaid → an internal
--               "SD-PAYMENT" email to support@, who decide what happens to
--               the plan
--
-- Every reminder carries the buyer's own card-update link
-- (/courses/update-payment?t=…), which mints a fresh Stripe page on each click
-- and charges what is outstanding the moment the new card is saved.
--
-- A run is keyed on the Stripe invoice that failed, not on an installment
-- number: the invoice is what is owed, its live status is what settles the run
-- (paid / void / uncollectible), and a later installment that fails is a
-- different invoice and therefore a new run.
CREATE TABLE IF NOT EXISTS course_dunning (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_registration_id INTEGER NOT NULL,
  stripe_invoice_id TEXT NOT NULL,
  -- What the failed invoice asked for, as Stripe reported it when the run
  -- opened (minor units, invoice currency). Refreshed from Stripe before
  -- every send; this copy is for the admin list.
  amount_minor INTEGER,
  currency TEXT,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  reminder1_sent_at TEXT,
  reminder2_sent_at TEXT,
  reminder3_sent_at TEXT,
  escalated_at TEXT,
  -- The buyer saved a new card through the link (last time), and what the
  -- charge that followed did: paid / processing / declined / needs_action.
  card_updated_at TEXT,
  card_update_outcome TEXT,
  card_update_message TEXT,
  -- Last time the sweep asked Stripe whether the invoice is still owed. Runs
  -- between steps (and after the hand-off) are re-checked a few times a day,
  -- so one settled by a path that never told us still closes.
  last_checked_at TEXT,
  -- Set once nothing more should be sent: paid, void (the invoice was voided
  -- or written off in Stripe), stopped (the plan was cancelled, refunded or
  -- ended by an admin stop).
  resolved_at TEXT,
  resolution TEXT,
  UNIQUE (course_registration_id, stripe_invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_course_dunning_open
  ON course_dunning(resolved_at, course_registration_id);
