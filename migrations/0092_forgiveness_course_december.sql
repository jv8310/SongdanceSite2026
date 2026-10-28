-- The Forgiveness Course opens for registration (October 2026): four live
-- sessions on Zoom, Sun 6, Wed 9, Sun 13 and Wed 16 December 2026, 19:00–21:00
-- Brussels time, from Jacob's Google Calendar. The page and the checkout are in
-- code (src/lib/courses/forgiveness.ts); this puts the /events grid card back
-- (hidden since 0030, undated since 0045) with its dates, price and picture, so
-- it shows on /events and in the homepage "Upcoming" strip.
--
-- Idempotent UPDATE by id, like the grid migrations before it.

UPDATE calendar_events
   SET start_date = '2026-12-06',
       end_date   = '2026-12-16',
       location   = 'Online (Zoom)',
       price      = '€147',
       status     = 'open',
       summary    = 'Four live evenings with Daniela Hess & Jacob. Forgiveness in layers, with sound as the way in. Lifetime access to the replays.',
       image_key  = 'library/forgiveness-sunflowers-sunset.webp',
       published  = 1,
       updated_at = datetime('now')
 WHERE id = 'forgiveness-course';
