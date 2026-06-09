-- Events grid updates (admin request).
--
--   1. Hide the Forgiveness course from the /events grid for now. Its landing
--      page (/courses/forgiveness) stays live — we only unpublish the grid
--      card, so it can be switched back on later from /admin/events.
--   2. Ritual of Belonging — give the grid card its picture and a "from" price.
--      Its lowest room tier is €536 (see 0002_seed_ritual_of_belonging.sql),
--      so the card reads "From €536".
--   3. Link the two retreat cards to their registration products so the grid
--      can show a live "X% booked" figure, derived from the same availability
--      model the booking pages and /admin use.
--
-- `product_slug` links a grid card to a registration product in `products`.
-- NULL means "no live bookings" (courses, online events, undated retreats) and
-- the card simply shows no booked figure. Run-once migration (wrangler tracks
-- applied migrations), matching how `ongoing` was added in 0021.
ALTER TABLE calendar_events ADD COLUMN product_slug TEXT;

-- 1. Forgiveness course — off the grid, landing page untouched.
UPDATE calendar_events
   SET published = 0, updated_at = datetime('now')
 WHERE id = 'forgiveness-course';

-- 2 + 3. Ritual of Belonging — picture, "from" price, and product link.
UPDATE calendar_events
   SET image_key    = 'library/ritual-winter-forest.webp',
       price        = 'From €536',
       product_slug = 'ritual-of-belonging-2026',
       updated_at   = datetime('now')
 WHERE id = 'ritual-of-belonging-2026-11';

-- 3. Dolphin & Sound — product link so the card shows "X% booked" too.
UPDATE calendar_events
   SET product_slug = 'dolphin-and-sound-2026',
       updated_at   = datetime('now')
 WHERE id = 'dolphin-and-sound-2026-11';
