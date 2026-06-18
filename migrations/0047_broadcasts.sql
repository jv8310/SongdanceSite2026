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

-- One marketing broadcast. The author's copy lives in `body` (paragraphs, with
-- light inline HTML allowed since it's admin-authored); it's wrapped in the
-- shared email shell at send time. `{{first_name}}` in subject/heading/body is
-- substituted per recipient. status: draft → sending → (paused) → done.
CREATE TABLE IF NOT EXISTS broadcasts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,                       -- internal label
  subject       TEXT NOT NULL,
  preheader     TEXT,                                -- inbox preview line (defaults to subject)
  heading       TEXT NOT NULL,                       -- the big line at the top of the card
  body          TEXT NOT NULL,                       -- author's copy
  hero_image    TEXT,                                -- absolute image URL (optional)
  cta_label     TEXT,
  cta_href      TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',       -- draft | sending | paused | done
  paused_reason TEXT,                                -- set when auto-paused by the circuit breaker
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  started_at    TEXT,
  completed_at  TEXT
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
