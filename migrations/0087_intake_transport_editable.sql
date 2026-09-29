-- Travel questions editable from the admin, drafted by Claude.
--
-- A retreat's transport section used to live only in code
-- (src/lib/intake/transport/<slug>.ts), so changing a question meant a code
-- change and a deploy. Now the admin can describe what to ask in plain words on
-- /admin/retreats/<slug> → Intake; the Claude API drafts the section, it is
-- validated against the same rules as the code-defined ones, and it lands here:
--
--   transport_draft_json — the latest draft, NOT shown to guests. Previewable
--                          by an admin at /intake?…&only=transport&preview=draft.
--   transport_json       — the published section. When set it wins over the
--                          code-defined one; clearing it falls back to the code.
--   transport_draft_summary — Claude's own note on what the draft changed and
--                          what to check before publishing.
--   transport_brief      — the instruction that produced the draft, kept so the
--                          next change can build on it.
--   transport_updated_at — when the published section last changed.
--
-- Purely additive: code from before this migration never reads these columns.

ALTER TABLE intake_retreats ADD COLUMN transport_json TEXT;
ALTER TABLE intake_retreats ADD COLUMN transport_draft_json TEXT;
ALTER TABLE intake_retreats ADD COLUMN transport_draft_summary TEXT;
ALTER TABLE intake_retreats ADD COLUMN transport_brief TEXT;
ALTER TABLE intake_retreats ADD COLUMN transport_updated_at TEXT;
