-- Fix the Ritual of Belonging grid card dates (table `calendar_events`).
--
-- The /events grid card was seeded in 0020 with 2026-11-13 → 2026-11-16, but
-- that never matched the retreat itself. The retreat product (0002 seed) and the
-- landing page (/ritual-of-belonging — RBHero "27–29 November 2026", RBPractical
-- "Arrival on Friday, 27 November 2026" / departure "Sunday, 29 November 2026")
-- both hold the true dates: Fri 27 → Sun 29 November 2026. So the events page
-- showed the wrong date while the landing page was right.
--
-- Align the grid card to the real dates. Idempotent UPDATE by id, safe to re-run
-- like the event-grid migrations before it. The landing page is left untouched.
UPDATE calendar_events
   SET start_date = '2026-11-27',
       end_date   = '2026-11-29',
       updated_at = datetime('now')
 WHERE id = 'ritual-of-belonging-2026-11';
