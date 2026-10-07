-- Course email sequences — the site taking over what Drip workflows sent.
--
-- One row per (sequence, person): the weekly Authentic Singing Journey emails,
-- the 12-week course onboarding, the certification onboarding. The words and
-- the cadence live in code (src/lib/courses/emails/); this table only records
-- where each person stands, so the hourly cron knows what is due.
--
--   next_step / next_due_at — the step to send next and when it falls due
--                             (UTC). Claimed by a compare-and-swap UPDATE on
--                             next_step, rolled back if the send fails.
--   stopped_at / stop_source — the person pressed "stop these emails" (link /
--                             one-click), an admin stopped it, the order was
--                             refunded, or the address is on the suppression
--                             list. A stop is per sequence, never global.
--   completed_at            — every step has gone out.
--
-- UNIQUE (sequence, email): buying the journey twice (a bump and a standalone,
-- say) never runs the series twice.

CREATE TABLE IF NOT EXISTS course_email_sequences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence TEXT NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  timezone TEXT,
  -- The order that enrolled them (NULL when added by hand).
  course_registration_id INTEGER,
  -- Per-person flavour of a shared sequence, e.g. 'path-wait' / 'path-now'
  -- for a certification-path buyer riding the 12-week sequence.
  variant TEXT,
  -- Day 0 of the schedule (UTC, 'YYYY-MM-DD HH:MM:SS'): normally paid_at.
  started_at TEXT NOT NULL,
  next_step INTEGER NOT NULL DEFAULT 1,
  next_due_at TEXT,
  last_sent_step INTEGER,
  last_sent_at TEXT,
  stopped_at TEXT,
  stop_source TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (sequence, email)
);

CREATE INDEX IF NOT EXISTS idx_course_email_sequences_due
  ON course_email_sequences (next_due_at)
  WHERE stopped_at IS NULL AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_course_email_sequences_reg
  ON course_email_sequences (course_registration_id);
