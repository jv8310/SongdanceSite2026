-- Close Private Shared-bath for new bookings; open the Theaterkamer add-on.
--
-- Multi-mode PSB rooms (2.2 / 2.4 / 2.5 / 2.6) lose their solo_tier_id so
-- they can only be sold as Shared Bedroom from now on. Any room that
-- already carries an active PSB booking is left alone — the existing
-- customer keeps their private room. tier_id (the room's primary tier
-- used by admin views) is repointed to Shared Bedroom for the converted
-- rooms so reports show them under their new home.
--
-- The solo-only PSB room (2.3) has no Shared Bedroom mode, so it is
-- simply marked inactive when unbooked.
--
-- Room 5.3 — Poorthuis Theaterkamer add-on flips from inactive to
-- available, adding 4 beds to the Common Space pool.

UPDATE inventory_units
   SET solo_tier_id = NULL,
       tier_id = (
         SELECT id FROM tiers
          WHERE slug = 'shared-bedroom'
            AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')
       )
 WHERE name IN (
         'Room 2.2 — Poorthuis 2nd floor',
         'Room 2.4 — Balkonverblijf ground floor',
         'Room 2.5 — Balkonverblijf ground floor (extra spacious)',
         'Room 2.6 — Balkonverblijf ground floor'
       )
   AND id NOT IN (
         SELECT inventory_unit_id
           FROM registrations
          WHERE inventory_unit_id IS NOT NULL
            AND status IN ('paid','pending')
            AND (status = 'paid'
                 OR hold_expires_at IS NULL
                 OR hold_expires_at > datetime('now'))
       );

UPDATE inventory_units
   SET status = 'inactive'
 WHERE name = 'Room 2.3 — Poorthuis 2nd floor (solo, double bed)'
   AND status = 'available'
   AND id NOT IN (
         SELECT inventory_unit_id
           FROM registrations
          WHERE inventory_unit_id IS NOT NULL
            AND status IN ('paid','pending')
            AND (status = 'paid'
                 OR hold_expires_at IS NULL
                 OR hold_expires_at > datetime('now'))
       );

UPDATE inventory_units
   SET status = 'available',
       name = 'Room 5.3 — Poorthuis Theaterkamer'
 WHERE name = 'Room 5.3 — Poorthuis Theaterkamer add-on [inactive]';

-- Reflect the new ceilings in the tier admin column.
UPDATE tiers
   SET capacity = 0
 WHERE slug = 'private-shared-bath'
   AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');

UPDATE tiers
   SET capacity = 13
 WHERE slug = 'common-space'
   AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');
