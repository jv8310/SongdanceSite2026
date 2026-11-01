-- Newsletter signups from the site's own form (the footer's "Stay in touch",
-- NewsletterFooter.astro → /api/newsletter → src/lib/contacts/newsletter.ts).
--
-- The signup used to be stamped into contacts.custom, but that JSON belongs to
-- the CSV import: a re-import (a list-cleaning file, a Drip export) replaces
-- the whole blob, and the signup — and with it the person's place on
-- /admin/people — vanished. So it gets its own row here, one per address,
-- which nothing but the signup writes. The contact and its `newsletter` tag
-- still live on contacts / contact_tags, which feed broadcasts.

CREATE TABLE IF NOT EXISTS newsletter_signups (
  email              TEXT PRIMARY KEY,                    -- lowercased
  first_signed_up_at TEXT NOT NULL DEFAULT (datetime('now')),
  signed_up_at       TEXT NOT NULL DEFAULT (datetime('now')), -- latest signup
  page               TEXT,                                -- path the form sat on (latest)
  source             TEXT,                                -- 'footer', 'forgiveness-course', …
  signups            INTEGER NOT NULL DEFAULT 1           -- times the form was sent
);

CREATE INDEX IF NOT EXISTS idx_newsletter_signups_at ON newsletter_signups(signed_up_at);
