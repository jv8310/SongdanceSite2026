-- The Forgiveness Course card on the /events grid (and the homepage "Upcoming"
-- strip), for the four live sessions of 6–16 December 2026.
--
-- 0092 updated the card by its seeded id, but the live DB has no row with that
-- id any more (it was removed from /admin/events after 0030 hid it), so that
-- UPDATE matched nothing. Same shape as 0043: restore the card when no row
-- points at the course page, then set the dates on whichever row does (the
-- seeded id or one re-created by hand under another id). Idempotent; hide it
-- again from /admin/events at any time.

INSERT INTO calendar_events
  (id, title, category, language, facilitators, start_date, end_date, location,
   capacity, price, status, summary, href, image_key, ongoing, published, sort_order)
SELECT 'forgiveness-course', 'The Forgiveness Course', 'course', 'en',
       '["Daniela Hess","Jacob"]', '2026-12-06', '2026-12-16', 'Online (Zoom)',
       NULL, '€147', 'open',
       'Four live evenings with Daniela Hess & Jacob. Forgiveness in layers, with sound as the way in. Lifetime access to the replays.',
       '/courses/forgiveness', 'library/forgiveness-sunflowers-sunset.webp', 0, 1, 0
 WHERE NOT EXISTS (SELECT 1 FROM calendar_events WHERE href = '/courses/forgiveness')
   AND NOT EXISTS (SELECT 1 FROM calendar_events WHERE id = 'forgiveness-course');

UPDATE calendar_events
   SET start_date = '2026-12-06',
       end_date   = '2026-12-16',
       location   = 'Online (Zoom)',
       price      = '€147',
       status     = 'open',
       ongoing    = 0,
       summary    = 'Four live evenings with Daniela Hess & Jacob. Forgiveness in layers, with sound as the way in. Lifetime access to the replays.',
       image_key  = 'library/forgiveness-sunflowers-sunset.webp',
       published  = 1,
       updated_at = datetime('now')
 WHERE href = '/courses/forgiveness' OR id = 'forgiveness-course';
