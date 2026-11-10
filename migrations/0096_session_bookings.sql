-- Individual sessions with Jacob, booked on /sessions (November 2026).
--
-- Free moments come from Jacob's Google Calendar: every event titled
-- "Boekingen" is a window that can be booked, cut into sessions of the length
-- set on /admin/sessions (src/lib/sessions/). This table holds what was taken
-- out of those windows: one row per booking, from the moment a checkout starts
-- (a hold) to the session itself.
--
-- The payment rides course_registrations (product slug `individual-session`),
-- so every existing fulfilment path (Stripe webhook, PayPal return, the hourly
-- reconciles, admin mark-paid, SD-ORDER, Drip, Meta) works unchanged; this row
-- points at it.
--
-- status:
--   held      — checkout started; the moment is kept for the buyer until
--               hold_expires_at, after which it is free again (lazily, no sweep
--               needed for correctness)
--   booked    — paid and confirmed (Zoom meeting + calendar event + email)
--   conflict  — paid after the hold lapsed, and someone else had taken the
--               moment meanwhile; Jacob is told, the buyer gets a note
--   cancelled — cancelled by an admin, or the order was refunded in full
--   expired   — a hold that lapsed without payment (swept by the cron)
CREATE TABLE IF NOT EXISTS session_bookings (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  status                  TEXT NOT NULL DEFAULT 'held',
  starts_at_utc           TEXT NOT NULL,              -- ISO instant
  ends_at_utc             TEXT NOT NULL,
  duration_min            INTEGER NOT NULL,
  -- The "Boekingen" calendar event the moment was cut from (informational).
  source_event_id         TEXT,
  email                   TEXT NOT NULL,
  first_name              TEXT,
  last_name               TEXT,
  timezone                TEXT,                       -- the buyer's IANA zone (their browser)
  note                    TEXT,                       -- "what brings you", optional
  course_registration_id  INTEGER,
  hold_expires_at         TEXT,                       -- ISO instant
  confirmed_at            TEXT,
  -- The meeting: from the Zoom API (zoom_meeting_id set), else the link on the
  -- "Boekingen" event, else the standard link from /admin/sessions.
  zoom_meeting_id         TEXT,
  join_url                TEXT,
  join_passcode           TEXT,
  join_source             TEXT,                       -- 'zoom-api' | 'calendar' | 'standard' | 'admin'
  -- The event written into Jacob's calendar for the booked session.
  calendar_event_id       TEXT,
  calendar_error          TEXT,
  reminder_24h_sent_at    TEXT,
  reminder_1h_sent_at     TEXT,
  reschedule_count        INTEGER NOT NULL DEFAULT 0,
  cancelled_at            TEXT,
  cancel_reason           TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_session_bookings_starts ON session_bookings (starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_session_bookings_status ON session_bookings (status, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_session_bookings_reg ON session_bookings (course_registration_id);
CREATE INDEX IF NOT EXISTS idx_session_bookings_email ON session_bookings (lower(email));
