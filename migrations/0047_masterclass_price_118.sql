-- Masterclass price increase — list price raised from ~€29 to €118 across all
-- currencies. With the launch promo (50% off, src/lib/promo.ts) active, the
-- buyer pays €59; the list/charge here is double that so the discounted figure
-- is the promo price. This is the authoritative charged amount (checkout reads
-- workshop_product_prices); the display labels in
-- src/lib/workshops/marketing-prices.ts are updated to match.
--
-- Scaled proportionally from the original points in
-- migrations/0022_workshop_masterclass.sql so cross-currency parity holds and
-- each 50%-off promo lands on a clean number.
-- One UPDATE per currency (D1 caps terms in a compound statement).

UPDATE workshop_product_prices SET amount_minor = 11800
  WHERE currency = 'EUR' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 11800
  WHERE currency = 'USD' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 9800
  WHERE currency = 'GBP' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 11800
  WHERE currency = 'CHF' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 15800
  WHERE currency = 'CAD' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 15800
  WHERE currency = 'AUD' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 19800
  WHERE currency = 'NZD' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 119800
  WHERE currency = 'NOK' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 119800
  WHERE currency = 'SEK' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 79800
  WHERE currency = 'DKK' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
