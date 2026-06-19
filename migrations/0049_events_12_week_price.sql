-- 12-Week Course event card price (table `calendar_events`).
--
-- The svh-12-week grid card was seeded (0020) and republished (0043) with a
-- NULL price, so it showed no figure on /events and the homepage "Upcoming"
-- strip — even though the course sells for €650 everywhere else (the /courses
-- grid, the nav, marketing-prices.ts → twelve-week.ts). Set the card price so
-- it matches, and so the launch-promo strike (online events + courses) can show
-- "€650 → €325" while the promo runs.
--
-- These cards render the price as static EUR text (no currency localization),
-- so the EUR figure stands for every market — matching the masterclass card
-- (0048). Idempotent UPDATE by id; safe to re-run like the migrations before it.
UPDATE calendar_events SET price = '€650', updated_at = datetime('now')
  WHERE id = 'svh-12-week';
