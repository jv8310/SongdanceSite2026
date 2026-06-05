-- Deposit balance tracking on registrations.
--
-- A retreat registration may be paid with a 50% deposit, leaving a balance
-- due before the cut-off date. Until now that balance was only recorded in
-- the free-text `notes` field + the checkout event log, which can't be
-- queried. These columns make "who still owes a balance?" a first-class
-- query so the admin can send each deposit-payer a Stripe link for the
-- remaining amount.
--
--   • balance_due_cents        — amount still owed (0 = paid in full / settled)
--   • balance_invite_sent_at   — when we last emailed the "pay the balance" link
--   • balance_paid_at          — when the balance was settled
--   • balance_stripe_session_id— the Checkout Session created for the balance

ALTER TABLE registrations ADD COLUMN balance_due_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN balance_invite_sent_at TEXT;
ALTER TABLE registrations ADD COLUMN balance_paid_at TEXT;
ALTER TABLE registrations ADD COLUMN balance_stripe_session_id TEXT;
