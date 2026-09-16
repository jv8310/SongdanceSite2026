-- Drop the €1 admin payment-flow tier (migration 0008) and its "Admin test
-- bed" inventory unit.
--
-- It existed to exercise the whole Stripe → webhook → Drip / Quaderno path
-- without a real €595 charge. That test is done and won't be run again, so the
-- fixture goes rather than being carried as a phantom room: the bed was wired
-- as a whole-room (solo) tier, so computeTierAvailability counted it as one
-- place and the retreat's Capacity table advertised "1 available" beside the
-- rooms that are actually for sale.
--
-- Both deletes are guarded on `registrations`, because registrations.tier_id
-- and .inventory_unit_id are plain REFERENCES with no ON DELETE: a row still
-- pointing here would either fail the delete outright (D1 enforces foreign
-- keys) or — if it didn't — vanish from /admin/orders and the retreat admin,
-- which both INNER JOIN tiers. A €1 test booking still on file is worth more
-- than a tidy table.
--
-- So the deactivation comes FIRST, and it is what actually takes the fixture
-- out of every readout whether or not the deletes fire: getTiersForProduct
-- filters on active = 1, and an inactive room is skipped by the room walk that
-- computes the retreat's real ceiling. Either way nothing on the site offers,
-- counts or sells it again.

UPDATE inventory_units
   SET status = 'inactive'
 WHERE tier_id IN (
   SELECT id FROM tiers
    WHERE slug = 'admin-test-1eur'
      AND product_id = (
        SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026'
      )
 );

UPDATE tiers
   SET active = 0
 WHERE slug = 'admin-test-1eur'
   AND product_id = (
     SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026'
   );

-- The bed, unless someone is sleeping in it on paper.
DELETE FROM inventory_units
 WHERE tier_id IN (
   SELECT id FROM tiers
    WHERE slug = 'admin-test-1eur'
      AND product_id = (
        SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026'
      )
 )
   AND NOT EXISTS (
     SELECT 1 FROM registrations r
      WHERE r.inventory_unit_id = inventory_units.id
   );

-- Then the tier itself — only once nothing references it, and only once its
-- bed is gone (inventory_units.tier_id cascades, so deleting the tier while a
-- registration still sits in that bed would break the registration's own FK).
DELETE FROM tiers
 WHERE slug = 'admin-test-1eur'
   AND product_id = (
     SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026'
   )
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.tier_id = tiers.id)
   AND NOT EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.tier_id = tiers.id);
