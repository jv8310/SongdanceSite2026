-- Events grid updates (admin review, June 2026). Acts on the GRID rows only
-- (table `calendar_events`); every dedicated landing page is left untouched.
--
--   1. Dolphin & Sound — show a "from" price. 0024 seeded a flat "€1995" back
--      when the retreat sold a single cabin; 0025 added pricier cabins
--      (€2495 upper-deck twin, €3990 double) but the card price was never
--      updated. Lowest cabin is still €1995, so the card now reads
--      "From €1995" — matching how Ritual of Belonging shows its "from" price.
--   2. The Grief Course — off the grid for now. Its landing page
--      (/courses/grief) stays live; we only unpublish the grid card, exactly
--      as Forgiveness was handled in 0030. Switch back on from /admin/events.
--   3. The SVH Certification Course — add a grid card linking to
--      /certification-course. It sells at a personal, per-person price
--      ("a personal price, not a public one" — see CCRegisterTeaser), so the
--      card deliberately carries NO price and no product link (no "% booked").
--   4. Even grid — give the four remaining image-less cards a picture, so the
--      grid reads evenly instead of mixing photo cards with text-only ones
--      (only Ritual + Dolphin had a picture). On-brand SVH photos from the R2
--      media library (served from /media/<key>).
--
-- All statements are idempotent (UPDATE by id / INSERT OR IGNORE), so this is
-- safe to re-run, like the migrations before it.

-- 1. Dolphin & Sound — "From €1995".
UPDATE calendar_events
   SET price = 'From €1995', updated_at = datetime('now')
 WHERE id = 'dolphin-and-sound-2026-11';

-- 2. Grief Course — off the grid, landing page untouched.
UPDATE calendar_events
   SET published = 0, updated_at = datetime('now')
 WHERE id = 'grief-course';

-- 4. Pictures for the previously image-less cards (even grid).
UPDATE calendar_events SET image_key = 'library/svh-retreat-sounding-yellow.webp', updated_at = datetime('now') WHERE id = 'klankopstellingen-gent-2026-06';
UPDATE calendar_events SET image_key = 'library/svh-retreat-sounding-blue.webp',   updated_at = datetime('now') WHERE id = 'vocal-healing-session';
UPDATE calendar_events SET image_key = 'library/jacob-sounding.webp',              updated_at = datetime('now') WHERE id = 'professional-masterclass';
UPDATE calendar_events SET image_key = 'library/svh-retreat-sounding-teal.webp',   updated_at = datetime('now') WHERE id = 'svh-12-week';

-- 3. SVH Certification Course — new grid card. No public price (personal price),
--    no product link, marked ongoing (the cohort is already underway).
INSERT OR IGNORE INTO calendar_events
  (id, title, category, language, facilitators, start_date, end_date, location,
   capacity, price, status, summary, href, image_key, ongoing, published, sort_order)
VALUES
  ('certification-course', 'Somatic Vocal Healing — Certification Course', 'course', 'en',
   '["Jacob"]', NULL, NULL, 'Online · live cohort', NULL, NULL, 'open',
   'Become a certified Somatic Vocal Healing practitioner — or simply go all the way in with your own voice.',
   '/certification-course', 'library/svh-retreat-circle-yurt-wide.webp', 1, 1, 0);
