-- Fix the Ritual of Belonging grid card "from" price (table `calendar_events`).
--
-- 0030 set the card to "From €536", citing the lowest tier in the 0002 seed
-- (Tier 5 — Dormitory). But 0004 had already restructured the pricing to the
-- four-room model and DEACTIVATED that €536 dormitory tier (folded into Common
-- Space), so €536 no longer corresponds to any bookable option. The lowest
-- active tier is now Common Space at €595 (0004: price_cents = 59500).
--
-- Update the card to "From €595" to match the real data. Idempotent UPDATE by
-- id, safe to re-run like the migrations before it. The landing page is left
-- untouched.
UPDATE calendar_events
   SET price = 'From €595', updated_at = datetime('now')
 WHERE id = 'ritual-of-belonging-2026-11';
