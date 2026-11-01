-- Segment builder. A broadcast with audience_rules set is targeted by those
-- rules (src/lib/broadcasts/segment-rules.ts) and its include/exclude/field
-- columns are ignored (they are kept, so switching back to tags restores them);
-- NULL keeps the old behaviour. resend_of marks a "resend to non-openers" draft
-- with the broadcast it follows.
--
-- broadcast_segments holds the rule sets saved by name from the builder
-- ("Save as segment…"), to load into another broadcast later.
CREATE TABLE IF NOT EXISTS broadcast_segments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  rules      TEXT NOT NULL,                   -- SegmentRules JSON
  created_by TEXT,                            -- admin email
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE broadcasts ADD COLUMN audience_rules TEXT;
ALTER TABLE broadcasts ADD COLUMN resend_of INTEGER;
