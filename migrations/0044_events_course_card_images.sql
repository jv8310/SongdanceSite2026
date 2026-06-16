-- Events grid update (admin request, June 2026). Acts on the GRID rows only
-- (table `calendar_events`); the dedicated landing pages are left untouched.
--
-- Swap the two course-card images re-published in 0043 for ones the owner
-- picked:
--   1. 12-Week Course — use the landing-page hero (a woman sounding, warm
--      lantern light), matching the /courses/12-week page.
--   2. Certification Course — a group circle in the round yurt.
--
-- Idempotent UPDATE by id, safe to re-run like the event-grid migrations
-- before it.

UPDATE calendar_events
   SET image_key = 'library/svhgpt-01-hero-in-one-breath.webp', updated_at = datetime('now')
 WHERE id = 'svh-12-week';

UPDATE calendar_events
   SET image_key = 'library/svh-retreat-group-indoor.webp', updated_at = datetime('now')
 WHERE id = 'certification-course';
