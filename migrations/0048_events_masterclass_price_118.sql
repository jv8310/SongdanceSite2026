-- Masterclass event card price — bring the /events grid + homepage "Upcoming"
-- strip in line with the €118 list price set in 0047_masterclass_price_118.sql.
--
-- The calendar_events row (seeded in 0020_events.sql) still carried the old
-- '29€' free-text label, so the card showed a stale price while the checkout,
-- the OfferingsGrid, the nav, and the marketing labels all read €118. These
-- cards render the price as static text (no currency localization), so the EUR
-- figure stands for every market.
UPDATE calendar_events SET price = '118€', updated_at = datetime('now')
  WHERE id = 'professional-masterclass';
