-- Rename two room-tier display names to match the public registration form.
-- Slugs stay the same so API code, checkout validation and inventory
-- references keep working untouched.
--
--   shared-bedroom : "Shared Bedroom" → "Twin Bedroom"
--   common-space   : "Common Space"   → "Shared Room"

UPDATE tiers
   SET name = 'Twin Bedroom'
 WHERE slug = 'shared-bedroom'
   AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');

UPDATE tiers
   SET name = 'Shared Room'
 WHERE slug = 'common-space'
   AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');
