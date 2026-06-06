-- Dolphin & Sound Retreat — add the sixth lower-deck twin cabin (L6).
--
-- The boat actually has SIX lower-deck twin cabins; the original room model
-- (migration 0025) only seeded five (L1–L5). This adds Cabin L6 — a twin
-- (two single beds) sold bed-by-bed like its siblings — and bumps the
-- twin-lower tier capacity from 10 to 12 (6 cabins × 2 beds) to match.
--
-- Idempotent: the unit insert is guarded by NOT EXISTS; the capacity bump is
-- a plain UPDATE.

UPDATE tiers
   SET capacity = 12
 WHERE product_id = (SELECT id FROM products WHERE slug = 'dolphin-and-sound-2026')
   AND slug = 'twin-lower';

INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
SELECT t.id, 'Cabin L6 — twin, lower deck (porthole)', 2, 'Twin cabin, two single beds; lower deck, porthole, private bathroom.', 'available', 106, NULL, t.id
  FROM tiers t
 WHERE t.product_id = (SELECT id FROM products WHERE slug='dolphin-and-sound-2026') AND t.slug='twin-lower'
   AND NOT EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.name='Cabin L6 — twin, lower deck (porthole)');
