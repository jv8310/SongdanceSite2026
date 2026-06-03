-- SVH Masterclass — the "pro" tier surfaced on the English workshop landing
-- page (/workshop) when door 3 (professional) is active.
--
-- The masterclass is just another `workshops` row whose main product is the
-- €29 `svh-masterclass` ticket. The landing-page calendar classifies an entry
-- as a masterclass by its main product slug; everything else (ticket → Stripe
-- → Quaderno) reuses the existing engine, so no new payment code is needed.

-- Masterclass ticket product (type 'ticket' — the CHECK only allows
-- ticket/bump/course; a masterclass is a ticketed live event).
INSERT OR IGNORE INTO workshop_products (slug, name, type, tax_code) VALUES
  ('svh-masterclass', 'Somatic Vocal Healing Masterclass', 'ticket', 'eservice');

-- Price points. One INSERT per currency (D1 caps terms in a compound SELECT).
-- €29 base, matching the existing /masterclass page.
INSERT OR IGNORE INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-masterclass'), 'EUR', 2900);
INSERT OR IGNORE INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-masterclass'), 'USD', 2900);
INSERT OR IGNORE INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-masterclass'), 'CAD', 3900);
INSERT OR IGNORE INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-masterclass'), 'GBP', 2500);
INSERT OR IGNORE INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-masterclass'), 'CHF', 2900);
INSERT OR IGNORE INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-masterclass'), 'NOK', 29900);
INSERT OR IGNORE INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-masterclass'), 'SEK', 29900);
INSERT OR IGNORE INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-masterclass'), 'DKK', 19900);
INSERT OR IGNORE INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-masterclass'), 'AUD', 3900);
INSERT OR IGNORE INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-masterclass'), 'NZD', 4900);

-- One example masterclass so pro state has something once published. Draft by
-- default — publish from /admin/workshops when the date and Zoom link are set.
-- 90 minutes, no order bump.
INSERT OR IGNORE INTO workshops
  (slug, title, teacher, starts_at_utc, ends_at_utc, display_tz, main_product_id, bump_product_id,
   source_tag, status, is_replay)
SELECT
  'svh-masterclass',
  'Somatic Vocal Healing Masterclass',
  'Jacob',
  '2026-06-22T18:00:00Z',
  '2026-06-22T19:30:00Z',
  'Europe/Brussels',
  (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass'),
  NULL,
  'svh_masterclass_live',
  'draft',
  0;
