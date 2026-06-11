-- Replace Torenverblijf with the Orangerie.
--
-- Remove the three Torenverblijf rooms (guarded so a booked room is never
-- dropped) and add four Orangerie rooms:
--   • Budget room for 1   (Budget Room)
--   • Twin room           (Shared Room)
--   • Budget room for 2   (Budget Room)
--   • Living room canopy  (Private Shared-bath single OR Private Double couple)
--
-- Inserts use multi-row VALUES (not a compound SELECT) to stay under D1's
-- compound-SELECT term cap.

-- 1) Remove the Torenverblijf rooms (only if nothing references them).
DELETE FROM inventory_units
 WHERE building = 'Torenverblijf'
   AND tier_id IN (SELECT id FROM tiers WHERE product_id = (SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.inventory_unit_id = inventory_units.id);

-- 2) Add the Orangerie rooms.
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id, couple_tier_id, role, building) VALUES
  ((SELECT id FROM tiers WHERE slug='common-space'        AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room O1 — Budget bed', 1, 'One budget bed.', 'available', 601, NULL, (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, 'Orangerie'),
  ((SELECT id FROM tiers WHERE slug='shared-bedroom'      AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room O2 — Twin', 2, 'Two single beds (twin).', 'available', 602, NULL, (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, 'Orangerie'),
  ((SELECT id FROM tiers WHERE slug='common-space'        AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room O3 — Budget room for two', 2, 'Two budget beds.', 'available', 603, NULL, (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, 'Orangerie'),
  ((SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room O4 — Living room canopy bed', 2, 'Living-room canopy bed; shared bathroom. Sold for one (Private Shared-bath) or two (Private Double).', 'available', 604, (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, (SELECT id FROM tiers WHERE slug='private-double' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, 'Orangerie');

-- 3) Tidy the admin-display tier capacities to the new room counts.
UPDATE tiers SET capacity = 10 WHERE slug='shared-bedroom'      AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026');
UPDATE tiers SET capacity = 11 WHERE slug='common-space'        AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026');
UPDATE tiers SET capacity = 4  WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026');
UPDATE tiers SET capacity = 2  WHERE slug='private-double'      AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026');
