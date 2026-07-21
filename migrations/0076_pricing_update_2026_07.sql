-- Pricing structure update (July 2026), owner's call. Repriced products +
-- the new workshop order bump. Charged amounts live in the DB (this file); the
-- static marketing labels in src/lib/workshops/marketing-prices.ts are updated
-- to match by hand, and the course prices (12-week / cert / journeys / grief)
-- live in their own src/lib/courses/*.ts modules (edited alongside this).
--
--   - Workshop ticket (svh-ticket):    €9  → €22   (70-minute session)
--   - Masterclass (svh-masterclass):   €118 → €44  (100-minute session)
--   - NEW workshop order bump: "Empowering You mantra pack" (mantra-empower-bump)
--     at €9 — replaces the €19 Authentic Singing Journey add-on as the
--     workshop/masterclass bump (ASJ moves to a €99 course bump; see bumps.ts).
--
-- Per-currency points scaled from the previous points and rounded to clean
-- headline numbers, mirroring migrations 0023 / 0047. One statement per
-- currency (D1 caps the number of terms in a compound SELECT / multi-row VALUES).

-- ── Workshop ticket → €22 ──────────────────────────────────────────────────
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'EUR', 2200)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'USD', 2200)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'GBP', 1900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'CHF', 2200)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'CAD', 3200)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'AUD', 3700)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'NZD', 3900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'NOK', 23900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'SEK', 23900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='svh-ticket'), 'DKK', 16900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;

-- ── Masterclass → €44 ──────────────────────────────────────────────────────
UPDATE workshop_product_prices SET amount_minor = 4400
  WHERE currency = 'EUR' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 4400
  WHERE currency = 'USD' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 3800
  WHERE currency = 'GBP' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 4400
  WHERE currency = 'CHF' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 5900
  WHERE currency = 'CAD' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 5900
  WHERE currency = 'AUD' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 7400
  WHERE currency = 'NZD' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 44900
  WHERE currency = 'NOK' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 44900
  WHERE currency = 'SEK' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');
UPDATE workshop_product_prices SET amount_minor = 29800
  WHERE currency = 'DKK' AND product_id = (SELECT id FROM workshop_products WHERE slug = 'svh-masterclass');

-- ── NEW workshop order bump: "Empowering You mantra pack" (€9) ──────────────
-- drip_tag prod_MantraEmpower is applied on a paid workshop registration when
-- the buyer takes the bump (workshopDripTags); the matching Drip automation +
-- product delivery must be set up owner-side.
INSERT OR IGNORE INTO workshop_products (slug, name, type, tax_code, drip_tag) VALUES
  ('mantra-empower-bump', 'Empowering You mantra pack', 'bump', 'eservice', 'prod_MantraEmpower');

INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='mantra-empower-bump'), 'EUR', 900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='mantra-empower-bump'), 'USD', 900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='mantra-empower-bump'), 'GBP', 800)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='mantra-empower-bump'), 'CHF', 900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='mantra-empower-bump'), 'CAD', 1300)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='mantra-empower-bump'), 'AUD', 1500)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='mantra-empower-bump'), 'NZD', 1600)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='mantra-empower-bump'), 'NOK', 9900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='mantra-empower-bump'), 'SEK', 9900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;
INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
  VALUES ((SELECT id FROM workshop_products WHERE slug='mantra-empower-bump'), 'DKK', 6900)
  ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor;

-- Repoint every upcoming workshop that still carries the old ASJ bump onto the
-- new mantra pack (past dates are left as-is — historical). New calendar-synced
-- workshops already pick up the new bump via SYNC_MAPPINGS in calendar-sync.ts.
UPDATE workshops
   SET bump_product_id = (SELECT id FROM workshop_products WHERE slug = 'mantra-empower-bump'),
       updated_at = datetime('now')
 WHERE bump_product_id = (SELECT id FROM workshop_products WHERE slug = 'asj-bump')
   AND deleted = 0
   AND starts_at_utc >= datetime('now');

-- ── /events grid cards — keep the static price labels honest ────────────────
UPDATE calendar_events SET price = '22€', updated_at = datetime('now')
  WHERE id = 'vocal-healing-session';
UPDATE calendar_events SET price = '44€', updated_at = datetime('now')
  WHERE id = 'professional-masterclass';
