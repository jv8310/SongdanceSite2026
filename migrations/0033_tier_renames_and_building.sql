-- Room-tier renames + an explicit building column for the admin overview.
--
-- Tier display names (slugs stay the same so all API/checkout code keeps
-- working):
--   shared-bedroom : "Twin Bedroom" → "Shared Room"   (the spacious 2-bed rooms)
--   common-space   : "Shared Room"  → "Budget Room"    (the smaller shared rooms)
-- "(ensuite)" is spelled out on the Private En-suite tier and on the notes of
-- the rooms that actually have a private bathroom in the unit.
--
-- inventory_units.building groups the admin rooms overview by house
-- (Poorthuis / Balkon / Toren / Paviljoen) and lets it sort by building even
-- after rooms are renamed away from their "Room X.Y — <house> …" labels.

UPDATE tiers
   SET name = 'Shared Room',
       description = 'You share a spacious room with one other participant.'
 WHERE slug = 'shared-bedroom'
   AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');

UPDATE tiers
   SET name = 'Budget Room',
       description = 'You share a smaller room with up to three others.'
 WHERE slug = 'common-space'
   AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');

UPDATE tiers
   SET description = 'Your own room with a private bathroom in the room (ensuite) — the most private option.'
 WHERE slug = 'private-ensuite'
   AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');

-- Explicit building per room.
ALTER TABLE inventory_units ADD COLUMN building TEXT;

UPDATE inventory_units SET building = 'Balkon'    WHERE name LIKE '%Balkonverblijf%';
UPDATE inventory_units SET building = 'Toren'     WHERE name LIKE '%Torenverblijf%';
UPDATE inventory_units SET building = 'Paviljoen' WHERE name LIKE 'Paviljoen%';
UPDATE inventory_units
   SET building = 'Poorthuis'
 WHERE building IS NULL
   AND (name LIKE '%Poorthuis%' OR name LIKE '%Theaterkamer%');

-- Spell out "(ensuite)" on the room notes that have a private bathroom in
-- the unit (the Private En-suite rooms), so the admin overview reads clearly.
UPDATE inventory_units
   SET notes = notes || ' (ensuite)'
 WHERE building IS NOT NULL
   AND solo_tier_id = (
         SELECT id FROM tiers
          WHERE slug = 'private-ensuite'
            AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')
       )
   AND notes NOT LIKE '%(ensuite)%';
