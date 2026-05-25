-- Admin-zone tidy-up for Ritual of Belonging room inventory.
--
--   Room 2.7 — Poorthuis Living Room sofa-bed: stay activated.
--   Room 5.3 — Poorthuis Theaterkamer add-on: stay activated.
--     Both UPDATEs below are idempotent — no-ops on databases where
--     0010/0011 already ran. Repeating them guarantees the desired
--     state on any environment that hasn't yet received those
--     migrations.
--
--   Room 2.1 — Poorthuis mezzanine (cook): drop capacity 2 → 1. The
--     room is reserved for Muriel (cook) alone; the second bed is held
--     because the space is too small for two. Muriel is already
--     pre-assigned, so with capacity=1 the admin per-room overview now
--     reads 0 available (capacity 1 − beds_sold 1) instead of 1.

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

UPDATE inventory_units
   SET capacity = 1
 WHERE name = 'Room 2.1 — Poorthuis mezzanine (cook)'
   AND status = 'reserved';
