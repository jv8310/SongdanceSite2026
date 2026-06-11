-- Make the Twin (Shared Room) rooms multi-mode again, so the admin "Sell as"
-- pin selector returns and a twin can be converted into a single private room.
--
-- Each twin keeps shared_tier_id = shared-bedroom (sold bed-by-bed) and gains
-- solo_tier_id = private-shared-bath (sellable as one private room). They are
-- pinned forced_mode='shared' by default, so nothing changes on the public
-- form — they stay Twin/Shared rooms until an admin flips a specific one to
-- "Single only". (forced_mode is ignored once a bed is booked, so occupied
-- twins are unaffected.)

UPDATE inventory_units
   SET solo_tier_id = (
         SELECT id FROM tiers
          WHERE slug = 'private-shared-bath'
            AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')
       ),
       forced_mode = 'shared'
 WHERE solo_tier_id IS NULL
   AND shared_tier_id = (
         SELECT id FROM tiers
          WHERE slug = 'shared-bedroom'
            AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')
       )
   AND tier_id IN (
         SELECT id FROM tiers WHERE product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')
       );
