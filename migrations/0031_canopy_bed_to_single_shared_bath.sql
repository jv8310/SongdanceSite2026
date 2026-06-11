-- Reclassify Room 3.1 — Balkonverblijf canopy bed — from a shared-only
-- Twin Bedroom into a single room sold under Private Shared-bath.
--
-- The canopy (four-poster) bed was previously offered bed-by-bed in the
-- Twin Bedroom pool (shared_tier_id = shared-bedroom, no solo mode). It now
-- sells as a solo single room with a shared bathroom: solo_tier_id is set to
-- private-shared-bath, shared_tier_id is cleared, and the room's primary
-- tier_id is repointed to match. Capacity stays 1 (one bed, one person).
--
-- Tier admin-display capacities are nudged to follow the move: Private
-- Shared-bath gains the seat (0 -> 1), Twin Bedroom loses it (14 -> 13).
-- Runtime availability is computed from rooms, so these columns are only for
-- the admin reports.

UPDATE inventory_units
   SET tier_id = (
         SELECT id FROM tiers
          WHERE slug = 'private-shared-bath'
            AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')
       ),
       solo_tier_id = (
         SELECT id FROM tiers
          WHERE slug = 'private-shared-bath'
            AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')
       ),
       shared_tier_id = NULL,
       notes = 'Single room with a four-poster canopy bed; shared bathroom.'
 WHERE name = 'Room 3.1 — Balkonverblijf canopy bed';

UPDATE tiers
   SET capacity = 1
 WHERE slug = 'private-shared-bath'
   AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');

UPDATE tiers
   SET capacity = 13
 WHERE slug = 'shared-bedroom'
   AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');
