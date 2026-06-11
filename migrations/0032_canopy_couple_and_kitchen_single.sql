-- Offer the Balkonverblijf canopy bed as a couple room too, and add the
-- Balkonverblijf kitchen as a second single room with shared bathroom.
--
-- The smart room model gives each room one "whole-room" (solo) price slot
-- via solo_tier_id. A couple booking is also a whole-room booking, so this
-- adds a parallel couple_tier_id slot: a room may now carry BOTH a single
-- solo price and a couple price. The two are mutually exclusive — whichever
-- books first locks the room (mode='solo'), so the other option drops to
-- "fully booked" automatically. Only the canopy bed uses it for now.

ALTER TABLE inventory_units ADD COLUMN couple_tier_id INTEGER REFERENCES tiers(id);

-- New "Private Double (couple)" tier — one booking for two people sharing,
-- EUR 1390, same shared-bathroom comfort as the single Private Shared-bath.
INSERT OR IGNORE INTO tiers (product_id, slug, name, description, price_cents, capacity, sort_order)
VALUES (
  (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026'),
  'private-double',
  'Private Double (couple)',
  'A private room with shared bathroom, booked for two people sharing. One booking covers the couple.',
  139000,
  2,
  2
);

-- Canopy bed (Room 3.1): now sells as a single (Private Shared-bath, EUR 795)
-- OR as a couple (Private Double, EUR 1390). Capacity 2 reflects the couple;
-- solo_tier_id (Private Shared-bath, set in 0031) is left untouched.
UPDATE inventory_units
   SET capacity = 2,
       couple_tier_id = (
         SELECT id FROM tiers
          WHERE slug = 'private-double'
            AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')
       ),
       notes = 'Four-poster canopy bed; shared bathroom. Sold for one (Private Shared-bath) or two (Private Double).'
 WHERE name = 'Room 3.1 — Balkonverblijf canopy bed';

-- New room: Balkonverblijf kitchen — a single room with shared bathroom,
-- sold solo under Private Shared-bath. Guarded so the insert is re-runnable.
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id, couple_tier_id)
SELECT t.id,
       'Room 3.2 — Balkonverblijf kitchen',
       1,
       'Single room in the Balkonverblijf eat-in kitchen; shared bathroom.',
       'available',
       302,
       t.id,
       NULL,
       NULL
  FROM tiers t
 WHERE t.slug = 'private-shared-bath'
   AND t.product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')
   AND NOT EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.name = 'Room 3.2 — Balkonverblijf kitchen');

-- Admin-display capacity: Private Shared-bath now has two single rooms
-- (canopy + kitchen). Runtime availability is computed from rooms, so this
-- column only feeds the admin reports.
UPDATE tiers
   SET capacity = 2
 WHERE slug = 'private-shared-bath'
   AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');
