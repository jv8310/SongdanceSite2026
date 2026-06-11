-- Room layout pass 1 — the unambiguous parts of the new building/room plan.
-- (Toren split, the "Attic mezzanine" budget bed, and the cook-help bed in
-- the Theaterkamer are intentionally left for a follow-up once confirmed.)
--
-- Names keep their "Room X.Y — …" code prefix so existing migrations and the
-- admin label parser keep working; only the descriptive half changes.

-- ── Poorthuis: Behind curtain (was the open gallery) — two single beds ──
-- Sold as Budget Room (common-space). Muriel moves in; one bed stays open.
UPDATE inventory_units
   SET name = 'Room 4.3 — Behind curtain',
       capacity = 2,
       notes = 'Two single beds behind a curtain.',
       building = 'Poorthuis'
 WHERE name = 'Room 4.3 — Poorthuis open gallery';

-- Move Muriel (cook) out of Room 2.1 into Behind curtain, leaving one open
-- bed there. Her tier follows the room (Budget Room) so the room derives a
-- clean shared mode. Room 2.1 is left reserved-but-empty (see chat notes).
UPDATE registrations
   SET inventory_unit_id = (
         SELECT id FROM inventory_units WHERE name = 'Room 4.3 — Behind curtain'
       ),
       tier_id = (
         SELECT id FROM tiers
          WHERE slug = 'common-space'
            AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')
       )
 WHERE name = 'Muriel (cook)';

-- ── Poorthuis: Theaterkamer — one room, four single beds ──
-- Keep the 4-bed Theaterkamer as the canonical room; retire the duplicate
-- "Theaterkamer ground floor" entry (only if it isn't booked).
UPDATE inventory_units
   SET name = 'Room 5.3 — Theaterkamer',
       capacity = 4,
       notes = 'Four single beds.',
       building = 'Poorthuis'
 WHERE name = 'Room 5.3 — Poorthuis Theaterkamer';

UPDATE inventory_units
   SET status = 'inactive'
 WHERE name = 'Room 4.2 — Theaterkamer ground floor'
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

-- ── Poorthuis: Attic — two single beds ──
UPDATE inventory_units
   SET name = 'Room 5.1 — Attic',
       capacity = 2,
       notes = 'Two single beds.',
       building = 'Poorthuis'
 WHERE name = 'Room 5.1 — Poorthuis attic mattresses';

-- ── Balkon: the three ground-floor twin rooms — two single beds each ──
UPDATE inventory_units SET notes = 'Two single beds.', building = 'Balkon'
 WHERE name = 'Room 2.4 — Balkonverblijf ground floor';
UPDATE inventory_units SET notes = 'Two single beds.', building = 'Balkon'
 WHERE name = 'Room 2.5 — Balkonverblijf ground floor (extra spacious)';
UPDATE inventory_units SET notes = 'Two single beds.', building = 'Balkon'
 WHERE name = 'Room 2.6 — Balkonverblijf ground floor';

-- ── Balkon: Ridderzaal — the canopy bed (single or couple, both offered) ──
UPDATE inventory_units
   SET name = 'Room 3.1 — Ridderzaal (canopy bed)',
       notes = 'Four-poster canopy bed in the Ridderzaal; shared bathroom. Sold for one (Private Shared-bath) or two (Private Double).',
       building = 'Balkon'
 WHERE name = 'Room 3.1 — Balkonverblijf canopy bed';
