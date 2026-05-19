-- Seed: Ritual of Belonging retreat, 27-29 November 2026 at Château Cortils.
-- Source of truth for prices/rooms: Retreat_Rooms_Registrations.md.

INSERT INTO products (slug, type, name, description, currency, vat_rate, starts_at, ends_at, drip_tag)
VALUES (
  'ritual-of-belonging-2026',
  'retreat',
  'Ritual of Belonging — Winter Retreat',
  'Three-day winter retreat with Lesanne and Jacob at Château Cortils, Belgium.',
  'EUR',
  0.21,
  '2026-11-27',
  '2026-11-29',
  'ev_2026-11_Ritual'
);

-- Tier 1 — Private room + en-suite bathroom · €833
INSERT INTO tiers (product_id, slug, name, description, price_cents, capacity, sort_order)
VALUES (
  (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026'),
  'tier-1',
  'Tier 1 — Private room, en-suite bathroom',
  'Most private. Private 2- or 3-person bedroom in the Poorthuis or Torenverblijf with its own bathroom.',
  83300,
  5,
  1
);

-- Tier 2 — Private/double room, shared bathroom · €714
INSERT INTO tiers (product_id, slug, name, description, price_cents, capacity, sort_order)
VALUES (
  (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026'),
  'tier-2',
  'Tier 2 — Private or double room, shared bathroom',
  'Your own bedroom (2-3 people), bathroom shared on the same floor or within the unit.',
  71400,
  11,
  2
);

-- Tier 3 — Shared common room (2 pers.) · €625
INSERT INTO tiers (product_id, slug, name, description, price_cents, capacity, sort_order)
VALUES (
  (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026'),
  'tier-3',
  'Tier 3 — Shared common room (Ridderzaal hemelbed)',
  'Four-poster bed for two in the open Knight''s Hall of the Balkonverblijf.',
  62500,
  2,
  3
);

-- Tier 4 — Shared bedroom (3-4 pers.) · €595
INSERT INTO tiers (product_id, slug, name, description, price_cents, capacity, sort_order)
VALUES (
  (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026'),
  'tier-4',
  'Tier 4 — Shared bedroom (3-4 people)',
  'Tower mezzanine (4 boxsprings) or Theaterkamer (2 single beds).',
  59500,
  6,
  4
);

-- Tier 5 — Dormitory / mattress on floor · €536
INSERT INTO tiers (product_id, slug, name, description, price_cents, capacity, sort_order)
VALUES (
  (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026'),
  'tier-5',
  'Tier 5 — Dormitory / mattress on floor',
  'Mattresses on the attic floor of the Poorthuis, or a single bed on the open vide.',
  53600,
  7,
  5
);

-- Inventory units (specific rooms / beds). Assignment is manual via /admin.

-- Tier 1
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order) VALUES
  ((SELECT id FROM tiers WHERE slug='tier-1' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 1.1 — Poorthuis 1st floor, 2-pers. en-suite', 2,
   'RESERVED for Jacob + Lesanne (hosts)', 'reserved', 1),
  ((SELECT id FROM tiers WHERE slug='tier-1' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 1.2 — Poorthuis 1st floor, 3-pers. en-suite', 3, NULL, 'available', 2),
  ((SELECT id FROM tiers WHERE slug='tier-1' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 1.3 — Torenverblijf ground floor, 2-pers.', 2, NULL, 'available', 3);

-- Tier 2
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order) VALUES
  ((SELECT id FROM tiers WHERE slug='tier-2' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 2.1 — Poorthuis mezzanine, 2-pers.', 2, NULL, 'available', 1),
  ((SELECT id FROM tiers WHERE slug='tier-2' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 2.2 — Poorthuis 2nd floor, 2-pers. (singles)', 2, NULL, 'available', 2),
  ((SELECT id FROM tiers WHERE slug='tier-2' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 2.3 — Poorthuis 2nd floor, 2-pers. (double bed)', 2, NULL, 'available', 3),
  ((SELECT id FROM tiers WHERE slug='tier-2' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 2.4 — Balkonverblijf ground floor, 2-pers.', 2, 'RESERVED for Muriel (cook)', 'reserved', 4),
  ((SELECT id FROM tiers WHERE slug='tier-2' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 2.5 — Balkonverblijf ground floor, 3-pers.', 3, NULL, 'available', 5),
  ((SELECT id FROM tiers WHERE slug='tier-2' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 2.6 — Balkonverblijf ground floor, 2-pers. (with child bed)', 2, NULL, 'available', 6);

-- Tier 3
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order) VALUES
  ((SELECT id FROM tiers WHERE slug='tier-3' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 3.1 — Balkonverblijf Ridderzaal hemelbed', 2, NULL, 'available', 1),
  ((SELECT id FROM tiers WHERE slug='tier-3' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 3.2 — Balkonverblijf eat-in kitchen', 1, 'RESERVED for cook help (50% off)', 'reserved', 2);

-- Tier 4
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order) VALUES
  ((SELECT id FROM tiers WHERE slug='tier-4' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 4.1 — Torenverblijf mezzanine, 4-pers.', 4, NULL, 'available', 1),
  ((SELECT id FROM tiers WHERE slug='tier-4' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 4.2 — Theaterkamer ground floor, 2-pers.', 2, NULL, 'available', 2);

-- Tier 5
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order) VALUES
  ((SELECT id FROM tiers WHERE slug='tier-5' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 5.1 — Poorthuis attic, 4-pers. dorm', 4, NULL, 'available', 1),
  ((SELECT id FROM tiers WHERE slug='tier-5' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 5.2 — Poorthuis vide, 1-pers.', 1, NULL, 'available', 2),
  ((SELECT id FROM tiers WHERE slug='tier-5' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 5.3 — Theaterkamer mezzanine, 2-pers.', 2, NULL, 'available', 3),
  ((SELECT id FROM tiers WHERE slug='tier-5' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Room 5.4 — Poorthuis Theaterkamer, 4-pers. (overflow)', 4, 'Optional add-on, costs extra to activate', 'inactive', 4),
  ((SELECT id FROM tiers WHERE slug='tier-5' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
   'Paviljoen — fire keeper bed', 1, 'RESERVED for fire keeper (Tier 5 rate, private bed)', 'reserved', 5);

-- Pre-allocated registrations (hosts + cook), so capacity counts are accurate.
INSERT INTO registrations (product_id, tier_id, inventory_unit_id, name, email, status, amount_cents, currency, notes)
VALUES (
  (SELECT id FROM products WHERE slug='ritual-of-belonging-2026'),
  (SELECT id FROM tiers WHERE slug='tier-1' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  (SELECT id FROM inventory_units WHERE name LIKE 'Room 1.1%' LIMIT 1),
  'Jacob (host)', 'jacob@songdance.co', 'paid', 0, 'EUR', 'Pre-allocated — non-paying host'
);

INSERT INTO registrations (product_id, tier_id, inventory_unit_id, name, email, status, amount_cents, currency, notes)
VALUES (
  (SELECT id FROM products WHERE slug='ritual-of-belonging-2026'),
  (SELECT id FROM tiers WHERE slug='tier-1' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  (SELECT id FROM inventory_units WHERE name LIKE 'Room 1.1%' LIMIT 1),
  'Lesanne (host)', 'lesanne@songdance.co', 'paid', 0, 'EUR', 'Pre-allocated — non-paying host'
);

INSERT INTO registrations (product_id, tier_id, inventory_unit_id, name, email, status, amount_cents, currency, notes)
VALUES (
  (SELECT id FROM products WHERE slug='ritual-of-belonging-2026'),
  (SELECT id FROM tiers WHERE slug='tier-2' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  (SELECT id FROM inventory_units WHERE name LIKE 'Room 2.4%' LIMIT 1),
  'Muriel (cook)', 'muriel@songdance.co', 'paid', 0, 'EUR', 'Pre-allocated — €1500 fee, non-paying as guest'
);
