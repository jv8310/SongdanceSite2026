-- Email engagement tracking: one row per Resend send, updated in place as
-- Resend delivers open/click/bounce/complaint webhooks. Powers the open/click
-- rate per email type on /admin/emails/stats, and is the foundation for future
-- A/B testing (the `variant` column).
--
-- `resend_id` is the message id Resend returns from POST /emails; the webhook
-- (src/pages/api/webhooks/resend.ts) matches events back to the row on it.
-- `email_type` is the engine's own notification vocabulary (reminder_1d,
-- post_attended, attended_2, abandoned_1, confirmation, …) so stats group by
-- the same names the cadence uses.
--
-- Open tracking is only as reliable as the inbox allows (Apple Mail Privacy
-- Protection inflates opens); click rate is the trustworthy signal. Counts and
-- first/last timestamps are both kept so a later view can show either.

CREATE TABLE IF NOT EXISTS email_sends (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  resend_id        TEXT UNIQUE,                 -- Resend message id (POST /emails → { id })
  email_type       TEXT NOT NULL,               -- reminder_1d | post_attended | abandoned_1 | confirmation | …
  variant          TEXT,                        -- A/B variant label (null = single version)
  registration_id  INTEGER,                     -- workshop_registrations.id when known
  to_email         TEXT NOT NULL,
  subject          TEXT,
  sent_at          TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at     TEXT,
  first_opened_at  TEXT,
  last_opened_at   TEXT,
  open_count       INTEGER NOT NULL DEFAULT 0,
  first_clicked_at TEXT,
  last_clicked_at  TEXT,
  click_count      INTEGER NOT NULL DEFAULT 0,
  bounced_at       TEXT,
  complained_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_sends_type ON email_sends(email_type);
CREATE INDEX IF NOT EXISTS idx_email_sends_reg ON email_sends(registration_id);
