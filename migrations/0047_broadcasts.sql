-- Standalone marketing list + one-off broadcasts (e.g. the "new site"
-- announcement to a CSV-imported audience). This is deliberately separate from
-- the workshop engine: contacts here are not workshop registrations, and a
-- broadcast is a single send drained by the same 5-minute cron — paced, held to
-- each recipient's local 08:00–21:00 window, suppression-checked, and tracked in
-- email_sends (so open/click rates show on /admin/emails/stats just like the
-- lifecycle mail). See src/lib/broadcasts/.

-- The imported marketing list. One row per address, independent of any workshop
-- registration. `timezone` is an IANA string validated at import (invalid/blank
-- → null, which falls back to the default send window); `country` is whatever
-- the source carried, informational only.
CREATE TABLE IF NOT EXISTS contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,                  -- lowercased
  name       TEXT,
  timezone   TEXT,                                  -- IANA (e.g. America/New_York); null → default window
  country    TEXT,                                  -- as imported; informational
  source     TEXT,                                  -- 'import', 'drip-export', …
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One marketing broadcast. The author's copy lives in `body`. In 'simple'
-- format it's paragraphs (light inline HTML allowed) wrapped in the shared email
-- shell; in 'html' format `body` IS the full email HTML, used as-is (so a
-- designed template can be pasted straight in). `{{first_name}}` is substituted
-- per recipient everywhere; in 'html' format `{{unsubscribe_url}}` is too (and
-- if it's absent an unsubscribe footer is appended for compliance). `body_text`
-- is an optional plain-text part (auto-generated from the body when blank).
-- The send window is the local-hour range a recipient may be mailed in
-- (defaults 08:00–21:00); widen it to push a big list out faster.
CREATE TABLE IF NOT EXISTS broadcasts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,                   -- internal label
  subject           TEXT NOT NULL,
  preheader         TEXT,                            -- inbox preview line (simple format only)
  heading           TEXT NOT NULL,                   -- big line at the top of the card (simple format)
  body              TEXT NOT NULL,                   -- author's copy (paragraphs) or full HTML
  format            TEXT NOT NULL DEFAULT 'simple',  -- simple | html
  body_text         TEXT,                            -- optional plain-text part
  hero_image        TEXT,                            -- absolute image URL (simple format, optional)
  cta_label         TEXT,
  cta_href          TEXT,
  window_start_hour INTEGER NOT NULL DEFAULT 8,      -- local-hour send window (inclusive)
  window_end_hour   INTEGER NOT NULL DEFAULT 21,     -- local-hour send window (exclusive)
  status            TEXT NOT NULL DEFAULT 'draft',   -- draft | sending | paused | done
  paused_reason     TEXT,                            -- set when auto-paused by the circuit breaker
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  started_at        TEXT,
  completed_at      TEXT
);

-- The per-broadcast send queue, snapshotted from `contacts` at launch (minus
-- anyone already on the suppression list). The cron claims rows atomically,
-- sends within the recipient's local window, and marks them sent. A row can be
-- retried up to a few times on transient send failures before it's marked
-- failed. UNIQUE(broadcast_id, email) makes the snapshot idempotent so a
-- re-launch can top up new contacts without duplicating anyone.
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id INTEGER NOT NULL,
  email        TEXT NOT NULL,                        -- lowercased
  name         TEXT,
  timezone     TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',      -- pending | sending | sent | suppressed | failed
  attempts     INTEGER NOT NULL DEFAULT 0,
  resend_id    TEXT,
  error        TEXT,
  claimed_at   TEXT,
  sent_at      TEXT,
  UNIQUE (broadcast_id, email)
);

CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_bc_recip_drain ON broadcast_recipients(broadcast_id, status);
