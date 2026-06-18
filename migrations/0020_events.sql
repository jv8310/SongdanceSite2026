-- Events catalogue — the single source of truth for the /events grid,
-- the homepage "Upcoming" strip, and the RetreatBand.
--
-- NB: the table is named `calendar_events`, NOT `events` — `events` is
-- already taken by the audit/webhook log from 0001_init (different schema).
--
-- This table feeds the GRID ONLY. Each event still has its own dedicated
-- landing page (linked via `href`); the rich page content is not stored
-- here. The team edits these rows from /admin/events without a code
-- deploy, and can upload a card image (stored in R2, referenced by
-- `image_key`, served from /media/<image_key>).

CREATE TABLE IF NOT EXISTS calendar_events (
  id           TEXT PRIMARY KEY,                 -- URL-safe slug, e.g. 'klankopstellingen-gent-2026-06'
  title        TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'online',   -- 'retreat' | 'online' | 'course'
  language     TEXT NOT NULL DEFAULT 'en',       -- 'en' | 'de' | 'nl'
  facilitators TEXT,                             -- JSON array, e.g. '["Jacob","Lesanne"]'
  start_date   TEXT,                             -- ISO date 'YYYY-MM-DD' (null = ongoing / start anytime)
  end_date     TEXT,                             -- ISO date; omit for single-day / online
  location     TEXT,
  capacity     INTEGER,
  price        TEXT,                             -- free text so '9€', '€99', 'from €X' all work
  status       TEXT NOT NULL DEFAULT 'open',     -- 'open' | 'waitlist' | 'closed'
  summary      TEXT,                             -- one-line card summary
  href         TEXT,                             -- link to the dedicated landing page
  image_key    TEXT,                             -- R2 object key for the card image
  published    INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,       -- manual tiebreaker; primary sort is start_date
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_published ON calendar_events(published);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_category ON calendar_events(category);

-- Seed rows from the content brief (§3). Dates/prices the brief marked
-- [CONFIRM] are left null so they render as "to be confirmed" rather than
-- inventing numbers. INSERT OR IGNORE keeps re-runs safe.
INSERT OR IGNORE INTO calendar_events
  (id, title, category, language, facilitators, start_date, end_date, location, capacity, price, status, summary, href)
VALUES
  ('klankopstellingen-gent-2026-06', 'Klankopstellingen Retreat', 'retreat', 'nl',
   '["Jacob"]', '2026-06-20', '2026-06-22', 'Oude Abdij van Drongen, Gent', 12, NULL, 'open',
   'Three days of sound constellation work in Dutch, near Ghent. Twelve people, no more.',
   '/retreats/klankopstellingen-gent'),

  ('ritual-of-belonging-2026-11', 'Ritual of Belonging', 'retreat', 'en',
   '["Jacob","Lesanne"]', '2026-11-13', '2026-11-16', 'Château Cortils, Belgium', 12, NULL, 'open',
   'A retreat into belonging, in a quiet château. Meals by Muriel.',
   '/ritual-of-belonging'),

  ('dolphin-and-sound-2026-11', 'Dolphin & Sound Retreat', 'retreat', 'en',
   '["Jacob"]', '2026-11-01', NULL, NULL, NULL, NULL, 'waitlist',
   'Sound and open water. Details to be confirmed.',
   '/retreats/dolphin-and-sound'),

  ('vocal-healing-session', 'Vocal Healing Session', 'online', 'en',
   '["Jacob"]', NULL, NULL, 'Online (Zoom)', NULL, '9€', 'open',
   'One hour, live, online. You don''t watch — you sound. The simplest way to feel what this is.',
   '/session'),

  ('professional-masterclass', 'Professional Masterclass', 'online', 'en',
   '["Jacob"]', NULL, NULL, 'Online', NULL, '118€', 'open',
   'How sound works in a room, and in your work. For therapists, coaches, facilitators, leaders.',
   '/masterclass'),

  ('svh-12-week', 'Somatic Vocal Healing — 12-Week Course', 'course', 'en',
   '["Jacob"]', NULL, NULL, 'Online', NULL, NULL, 'open',
   'Twelve weeks to learn the practice properly, in your own time, with live Q&A.',
   '/courses/12-week'),

  ('grief-course', 'The Grief Course', 'course', 'en',
   '["Daniela Hess","Jacob"]', NULL, NULL, 'Online · start anytime', NULL, '€99', 'open',
   'Because no one taught you how to grieve. A way to be with grief, consciously and kindly.',
   '/courses/grief'),

  ('forgiveness-course', 'The Forgiveness Course', 'course', 'en',
   '["Daniela Hess","Jacob"]', '2026-07-01', NULL, 'Online', NULL, NULL, 'waitlist',
   'The work of forgiveness — in layers, for your own freedom. Launching July 2026.',
   '/courses/forgiveness');
