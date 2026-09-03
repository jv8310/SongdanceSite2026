-- Which page a workshop/masterclass registration was made on.
--
-- Until now nothing recorded it: /workshop, /courses/masterclass and a direct
-- /w/<slug> link all POST the same /api/workshops/register, so "how many people
-- registered for a workshop through the masterclass page?" had no answer in the
-- data. It does from here on — the checkout stores the page it was started on
-- (normalized to a short key by src/lib/workshops/signup-page.ts).
--
-- Rows created before this column exists stay NULL: unknown, not zero.
ALTER TABLE workshop_registrations ADD COLUMN signup_page TEXT;
CREATE INDEX IF NOT EXISTS idx_wreg_signup_page ON workshop_registrations(signup_page);
