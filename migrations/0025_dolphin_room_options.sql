-- Dolphin & Sound Retreat — three cabin options + per-cabin inventory.
--
-- The retreat originally sold a single "twin cabin" option as a flat count
-- against tier capacity (see 0024). It now offers three cabin types, each at
-- its own price:
--
--   • Twin cabin – lower deck with porthole      €1995 per person
--   • Twin cabin – upper deck with sea views      €2495 per person
--   • Cabin with double bed – lower deck           €3990 for two people
--
-- A returning guest is given a lower-deck twin to himself as a gesture; that
-- is handled in the seed migration by reserving one twin cabin, so no separate
-- "single" tier is needed.
--
-- Each physical cabin becomes an inventory_unit so the existing smart room
-- model drives availability (solo-locking, auto-assignment, the admin rooms
-- view) instead of a flat count. Twin cabins are sold bed-by-bed
-- (shared_tier_id); the double cabin is sold as a whole unit (solo_tier_id) —
-- one booking locks the cabin.
--
-- INSERT … WHERE NOT EXISTS keeps the unit inserts safe to re-run.

-- ─── Tiers ───────────────────────────────────────────────────────────────

-- 1) Lower-deck twin: reuse the original tier so its id (and any existing
--    rows that reference it) are preserved.
UPDATE tiers
   SET slug        = 'twin-lower',
       name        = 'Twin cabin – lower deck with porthole',
       description = 'A twin cabin (two single beds) on the lower deck, with a porthole and private bathroom. Price is per person, all-in.',
       price_cents = 199500,
       capacity    = 10,
       sort_order  = 1,
       active      = 1
 WHERE product_id = (SELECT id FROM products WHERE slug = 'dolphin-and-sound-2026')
   AND slug = 'twin-cabin';

-- 2) Upper-deck twin.
INSERT OR IGNORE INTO tiers (product_id, slug, name, description, price_cents, capacity, sort_order)
VALUES (
  (SELECT id FROM products WHERE slug = 'dolphin-and-sound-2026'),
  'twin-upper',
  'Twin cabin – upper deck with sea views',
  'A twin cabin (two single beds) on the upper deck, with sea views and private bathroom. Price is per person, all-in.',
  249500,
  4,
  2
);

-- 3) Double cabin — sold as a whole cabin for two people sharing.
INSERT OR IGNORE INTO tiers (product_id, slug, name, description, price_cents, capacity, sort_order)
VALUES (
  (SELECT id FROM products WHERE slug = 'dolphin-and-sound-2026'),
  'double-lower',
  'Cabin with double bed – lower deck with porthole',
  'A private cabin with one double bed on the lower deck, with a porthole and private bathroom. Price is for two people sharing, all-in.',
  399000,
  4,
  3
);

-- ─── Cabins (inventory_units) ─────────────────────────────────────────────
-- Twin cabins: capacity 2, sold bed-by-bed (shared_tier_id set, no solo).
-- Double/single cabins: sold as a whole unit (solo_tier_id set, no shared);
-- one booking locks every bed in the cabin.

-- Lower-deck twins (×5).
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
SELECT t.id, 'Cabin L1 — twin, lower deck (porthole)', 2, 'Twin cabin, two single beds; lower deck, porthole, private bathroom.', 'available', 101, NULL, t.id
  FROM tiers t
 WHERE t.product_id = (SELECT id FROM products WHERE slug='dolphin-and-sound-2026') AND t.slug='twin-lower'
   AND NOT EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.name='Cabin L1 — twin, lower deck (porthole)');
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
SELECT t.id, 'Cabin L2 — twin, lower deck (porthole)', 2, 'Twin cabin, two single beds; lower deck, porthole, private bathroom.', 'available', 102, NULL, t.id
  FROM tiers t
 WHERE t.product_id = (SELECT id FROM products WHERE slug='dolphin-and-sound-2026') AND t.slug='twin-lower'
   AND NOT EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.name='Cabin L2 — twin, lower deck (porthole)');
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
SELECT t.id, 'Cabin L3 — twin, lower deck (porthole)', 2, 'Twin cabin, two single beds; lower deck, porthole, private bathroom.', 'available', 103, NULL, t.id
  FROM tiers t
 WHERE t.product_id = (SELECT id FROM products WHERE slug='dolphin-and-sound-2026') AND t.slug='twin-lower'
   AND NOT EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.name='Cabin L3 — twin, lower deck (porthole)');
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
SELECT t.id, 'Cabin L4 — twin, lower deck (porthole)', 2, 'Twin cabin, two single beds; lower deck, porthole, private bathroom.', 'available', 104, NULL, t.id
  FROM tiers t
 WHERE t.product_id = (SELECT id FROM products WHERE slug='dolphin-and-sound-2026') AND t.slug='twin-lower'
   AND NOT EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.name='Cabin L4 — twin, lower deck (porthole)');
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
SELECT t.id, 'Cabin L5 — twin, lower deck (porthole)', 2, 'Twin cabin, two single beds; lower deck, porthole, private bathroom.', 'available', 105, NULL, t.id
  FROM tiers t
 WHERE t.product_id = (SELECT id FROM products WHERE slug='dolphin-and-sound-2026') AND t.slug='twin-lower'
   AND NOT EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.name='Cabin L5 — twin, lower deck (porthole)');

-- Upper-deck twins (×3) — U3 is reserved for Jacob (host), sole occupancy.
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
SELECT t.id, 'Cabin U1 — twin, upper deck (sea views)', 2, 'Twin cabin, two single beds; upper deck, sea views, private bathroom.', 'available', 201, NULL, t.id
  FROM tiers t
 WHERE t.product_id = (SELECT id FROM products WHERE slug='dolphin-and-sound-2026') AND t.slug='twin-upper'
   AND NOT EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.name='Cabin U1 — twin, upper deck (sea views)');
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
SELECT t.id, 'Cabin U2 — twin, upper deck (sea views)', 2, 'Twin cabin, two single beds; upper deck, sea views, private bathroom.', 'available', 202, NULL, t.id
  FROM tiers t
 WHERE t.product_id = (SELECT id FROM products WHERE slug='dolphin-and-sound-2026') AND t.slug='twin-upper'
   AND NOT EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.name='Cabin U2 — twin, upper deck (sea views)');
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
SELECT t.id, 'Cabin U3 — twin, upper deck (host)', 2, 'RESERVED for Jacob (host) — sole occupancy, upper-deck twin. Non-paying; not sold.', 'reserved', 203, NULL, t.id
  FROM tiers t
 WHERE t.product_id = (SELECT id FROM products WHERE slug='dolphin-and-sound-2026') AND t.slug='twin-upper'
   AND NOT EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.name='Cabin U3 — twin, upper deck (host)');

-- Double cabins (×2) — sold as a whole unit for a couple (solo_tier_id).
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
SELECT t.id, 'Cabin D1 — double, lower deck (porthole)', 2, 'Private cabin, one double bed for two people sharing; lower deck, porthole, private bathroom.', 'available', 301, t.id, NULL
  FROM tiers t
 WHERE t.product_id = (SELECT id FROM products WHERE slug='dolphin-and-sound-2026') AND t.slug='double-lower'
   AND NOT EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.name='Cabin D1 — double, lower deck (porthole)');
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
SELECT t.id, 'Cabin D2 — double, lower deck (porthole)', 2, 'Private cabin, one double bed for two people sharing; lower deck, porthole, private bathroom.', 'available', 302, t.id, NULL
  FROM tiers t
 WHERE t.product_id = (SELECT id FROM products WHERE slug='dolphin-and-sound-2026') AND t.slug='double-lower'
   AND NOT EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.name='Cabin D2 — double, lower deck (porthole)');
