-- Admin-managed retreats for the intake form.
--
-- This is a thin catalogue (slug + display name) so the team can add
-- new retreats from /admin/intakes/retreats without a code deploy.
-- The hardcoded EVENTS map in src/lib/intake/events.ts stays as a
-- fallback (so the older intake links keep working); when both exist,
-- the DB row wins for display and validation.

CREATE TABLE intake_retreats (
  slug        TEXT PRIMARY KEY,           -- URL slug, e.g. 'klankopstellingen2026'
  name        TEXT NOT NULL,              -- display name (same in NL/EN)
  flavour     TEXT,                       -- optional context line for Claude
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_intake_retreats_active ON intake_retreats(active);
