-- Intakes, joined to the retreats they screen for — plus the transport section.
--
-- Until now the intake catalogue (intake_retreats) and the retreat products
-- lived side by side with nothing joining them, so inviting a retreat's guests
-- to their intake meant copying their emails from one admin page and pasting
-- them into another. `product_id` is that join: /admin/retreats/<slug> reads
-- the intake linked to its product and invites the booked guests directly.
--
-- The transport section (src/lib/intake/transport.ts) adds retreat-specific
-- travel questions to the intake. Its answers get their own table, one row per
-- person and retreat, because they are asked twice over: inside the full
-- intake, and on their own (/intake?…&only=transport) for a guest who already
-- sent the intake before the questions existed, or whose flight changed. The
-- latest answer wins. That table is what gets mirrored to the retreat's Google
-- Sheet (src/lib/intake/transport-sheet.ts) through an Apps Script web app:
-- `sheet_url` is its /exec URL, `sheet_secret` the shared secret the script
-- checks, and the two stamps say when the last push landed or why it didn't.
--
-- Purely additive: code from before this migration never reads these columns.

ALTER TABLE intake_retreats ADD COLUMN product_id INTEGER;
ALTER TABLE intake_retreats ADD COLUMN sheet_url TEXT;
ALTER TABLE intake_retreats ADD COLUMN sheet_secret TEXT;
ALTER TABLE intake_retreats ADD COLUMN sheet_synced_at TEXT;
ALTER TABLE intake_retreats ADD COLUMN sheet_error TEXT;

CREATE INDEX idx_intake_retreats_product ON intake_retreats(product_id);

-- The full name, when the invitee came from a booking (the greeting still uses
-- first_name), so the form is prefilled with the whole name rather than just
-- the first word. And when the travel-questions-only email last went out.
ALTER TABLE intake_invitations ADD COLUMN full_name TEXT;
ALTER TABLE intake_invitations ADD COLUMN transport_sent_at TEXT;

CREATE TABLE intake_transport_answers (
  id            TEXT PRIMARY KEY,             -- crypto.randomUUID()
  event_code    TEXT NOT NULL,                -- intake_retreats.slug
  email         TEXT NOT NULL,                -- lowercased
  full_name     TEXT,
  phone         TEXT,
  locale        TEXT NOT NULL DEFAULT 'en',
  answers_json  TEXT NOT NULL,                -- { <question key>: value }, sanitised
  source        TEXT NOT NULL,                -- 'intake' | 'transport' — the form that wrote it last
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_code, email)
);

CREATE INDEX idx_intake_transport_event ON intake_transport_answers(event_code);
