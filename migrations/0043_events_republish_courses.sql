-- Events grid update (admin request, June 2026). Acts on the GRID rows only
-- (table `calendar_events`); every dedicated landing page is left untouched.
--
-- Re-add two course cards to the /events grid:
--   1. Somatic Vocal Healing — Certification Course (/courses/certification,
--      reached via the /certification-course redirect). Seeded + published in
--      0031, but unpublished since from /admin/events. No public price
--      (it sells at a personal, per-person price) and no product link.
--   2. Somatic Vocal Healing — 12-Week Course (/courses/12-week). Seeded +
--      published in 0020, but unpublished since from /admin/events.
--
-- The card rows already exist in the live DB (only their `published` flag was
-- flipped), so an UPDATE is all that's needed. The INSERT OR IGNORE statements
-- are a safety net in case a row was deleted rather than hidden — they restore
-- the exact card data from 0020/0031 (including the images added in 0031) and
-- never touch an existing row. All statements are idempotent, so this is safe
-- to re-run like the event-grid migrations before it.

-- 1. Certification Course — restore the row if missing, then publish it.
INSERT OR IGNORE INTO calendar_events
  (id, title, category, language, facilitators, start_date, end_date, location,
   capacity, price, status, summary, href, image_key, ongoing, published, sort_order)
VALUES
  ('certification-course', 'Somatic Vocal Healing — Certification Course', 'course', 'en',
   '["Jacob"]', NULL, NULL, 'Online · live cohort', NULL, NULL, 'open',
   'Become a certified Somatic Vocal Healing practitioner — or simply go all the way in with your own voice.',
   '/certification-course', 'library/svh-retreat-circle-yurt-wide.webp', 1, 1, 0);

UPDATE calendar_events
   SET published = 1, updated_at = datetime('now')
 WHERE id = 'certification-course';

-- 2. 12-Week Course — restore the row if missing, then publish it.
INSERT OR IGNORE INTO calendar_events
  (id, title, category, language, facilitators, start_date, end_date, location,
   capacity, price, status, summary, href, image_key, ongoing, published, sort_order)
VALUES
  ('svh-12-week', 'Somatic Vocal Healing — 12-Week Course', 'course', 'en',
   '["Jacob"]', NULL, NULL, 'Online', NULL, NULL, 'open',
   'Twelve weeks to learn the practice properly, in your own time, with live Q&A.',
   '/courses/12-week', 'library/svh-retreat-sounding-teal.webp', 0, 1, 0);

UPDATE calendar_events
   SET published = 1, updated_at = datetime('now')
 WHERE id = 'svh-12-week';
