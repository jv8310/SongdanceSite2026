-- Workshop ticket (svh-ticket) repriced from €6 to €9, with fixed per-currency
-- price points (no FX). Upsert so this both updates existing rows and inserts
-- any currency that didn't have a dedicated row yet (e.g. AUD/NZD).
--
-- amount_minor is in minor units (900 = €9.00).

INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'EUR', 900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'USD', 900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'GBP', 800)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'CHF', 900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'CAD', 1300)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'AUD', 1500)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'NZD', 1600)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'NOK', 9900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'SEK', 9900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'DKK', 6900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
