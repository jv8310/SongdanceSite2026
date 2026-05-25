-- Activate the two overflow add-on rooms so admin can hand-assign people
-- into them. Both were originally seeded with status='inactive'.
--
--   Room 2.7 — Poorthuis Living Room sofa-bed. Stays tagged under
--   Private Shared-bath; PSB is hardcoded as closed on the public
--   registration form, so this room is admin-assignable only.
--
--   Room 5.3 — Poorthuis Theaterkamer. Migration 0010 already
--   activated this; the statement below is idempotent so it's a
--   no-op on databases where 0010 has run.

UPDATE inventory_units
   SET status = 'available',
       name = 'Room 2.7 — Poorthuis Living Room (sofa-bed)'
 WHERE name = 'Room 2.7 — Poorthuis Living Room (sofa-bed) [inactive]'
   AND status = 'inactive';

UPDATE inventory_units
   SET status = 'available',
       name = 'Room 5.3 — Poorthuis Theaterkamer'
 WHERE name = 'Room 5.3 — Poorthuis Theaterkamer add-on [inactive]'
   AND status = 'inactive';
