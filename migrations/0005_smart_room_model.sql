-- Smart room model.
--
-- Each room (inventory_unit) can be sold under one or two tiers:
--   solo_tier_id   = the tier when sold as a solo room (locks all beds)
--   shared_tier_id = the tier when sold bed-by-bed
-- Multi-mode rooms (e.g. Room 1.2 — Private En-suite OR Shared Bedroom) set
-- both. Solo-only rooms (Room 2.3) set only solo_tier_id. Shared-only rooms
-- (canopy bed, Common Space rooms) set only shared_tier_id.
--
-- A room's current "mode" is derived from its bookings: 0 bookings → open;
-- 1+ booking with tier=solo_tier_id → solo-locked; 1+ with tier=shared_tier_id
-- → shared-locked. This is used by the API to compute live per-tier remaining
-- counts that respect cross-tier coupling (a Private En-suite booking on
-- Room 1.2 removes its 3 beds from Shared Bedroom availability).
--
-- This migration also reseeds inventory_units to the v7 catalog.

ALTER TABLE inventory_units ADD COLUMN solo_tier_id   INTEGER REFERENCES tiers(id);
ALTER TABLE inventory_units ADD COLUMN shared_tier_id INTEGER REFERENCES tiers(id);

-- Detach the pre-allocated host/cook registrations before we drop their
-- old room rows so FK references don't dangle.
UPDATE registrations
   SET inventory_unit_id = NULL
 WHERE product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');

-- Clear the v6 5-tier room seed.
DELETE FROM inventory_units
 WHERE tier_id IN (
   SELECT id FROM tiers
    WHERE product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')
 );

-- v7 room catalog. tier_id stays populated (= the room's "primary" tier,
-- used by the existing admin views); solo_tier_id and shared_tier_id drive
-- the new availability + auto-assign logic.

-- ─── Reserved: Room 1.1 — hosts (Jacob & Lesanne) ───
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='private-ensuite' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 1.1 — Poorthuis 1st floor (hosts)',
  2,
  'RESERVED for Jacob & Lesanne (hosts) — non-paying. En-suite with bathtub.',
  'reserved',
  101,
  (SELECT id FROM tiers WHERE slug='private-ensuite' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  NULL
);

-- ─── Multi-mode (Private En-suite OR Shared Bedroom) ───
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='private-ensuite' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 1.2 — Poorthuis 1st floor en-suite',
  3,
  '2 boxsprings + alcove bed (twijfelaar). En-suite with bathtub.',
  'available',
  102,
  (SELECT id FROM tiers WHERE slug='private-ensuite' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  (SELECT id FROM tiers WHERE slug='shared-bedroom'  AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
);
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='private-ensuite' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 1.3 — Torenverblijf ground floor',
  2,
  '2 boxsprings; private bath within the unit, small kitchen.',
  'available',
  103,
  (SELECT id FROM tiers WHERE slug='private-ensuite' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  (SELECT id FROM tiers WHERE slug='shared-bedroom'  AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
);

-- ─── Reserved: Room 2.1 — Muriel (cook) ───
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 2.1 — Poorthuis mezzanine (cook)',
  2,
  'RESERVED for Muriel (cook) — non-paying. Second bed held (space too small for two).',
  'reserved',
  201,
  (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  NULL
);

-- ─── Multi-mode (Private Shared-bath OR Shared Bedroom) ───
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 2.2 — Poorthuis 2nd floor',
  2,
  '2 boxsprings; bathroom one flight up.',
  'available',
  202,
  (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  (SELECT id FROM tiers WHERE slug='shared-bedroom'      AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
);

-- ─── Solo-only Private Shared-bath: Room 2.3 ───
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 2.3 — Poorthuis 2nd floor (solo, double bed)',
  1,
  'One double bed for a single person; bathroom one flight up.',
  'available',
  203,
  (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  NULL
);

INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 2.4 — Balkonverblijf ground floor',
  2,
  '2 boxsprings; bathroom and separate toilet within the unit.',
  'available',
  204,
  (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  (SELECT id FROM tiers WHERE slug='shared-bedroom'      AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
);
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 2.5 — Balkonverblijf ground floor (extra spacious)',
  2,
  '1 double bed + 1 boxspring; bathroom and separate toilet within the unit.',
  'available',
  205,
  (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  (SELECT id FROM tiers WHERE slug='shared-bedroom'      AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
);
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 2.6 — Balkonverblijf ground floor',
  2,
  '2 boxsprings; bathroom shared within the unit.',
  'available',
  206,
  (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  (SELECT id FROM tiers WHERE slug='shared-bedroom'      AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
);

-- ─── Inactive: Room 2.7 — Living Room sofa-bed (add-on) ───
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 2.7 — Poorthuis Living Room (sofa-bed) [inactive]',
  1,
  'Optional add-on. Activate only if extra capacity needed.',
  'inactive',
  207,
  (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  NULL
);

-- ─── Shared-only Shared Bedroom: Room 3.1 (canopy bed) ───
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 3.1 — Balkonverblijf canopy bed',
  1,
  'Four-poster bed for one in the open Knight''s Hall (common space).',
  'available',
  301,
  NULL,
  (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
);

-- ─── Common Space rooms ───
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 4.1 — Torenverblijf mezzanine',
  4,
  '4 boxsprings in 2 pairs; bathroom on tower ground floor.',
  'available',
  401,
  NULL,
  (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
);
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 4.2 — Theaterkamer ground floor',
  2,
  '2 single beds in a quiet alcove.',
  'available',
  402,
  NULL,
  (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
);
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 4.3 — Poorthuis open gallery',
  1,
  'Single bed on the open vide on the 3rd floor.',
  'available',
  403,
  NULL,
  (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
);
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 5.1 — Poorthuis attic mattresses',
  2,
  '2 mattresses on the attic floor; double-shower bathroom.',
  'available',
  501,
  NULL,
  (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
);

-- ─── Reserved Common Space rooms ───
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 5.2 — Theaterkamer mezzanine (cook help)',
  1,
  'RESERVED for cook help — Common Space rate (50%% off).',
  'reserved',
  502,
  NULL,
  (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
);
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Paviljoen — fire keeper bed',
  1,
  'RESERVED for fire keeper — Common Space rate.',
  'reserved',
  601,
  NULL,
  (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
);

-- ─── Inactive: Room 5.3 (Theaterkamer add-on) ───
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  'Room 5.3 — Poorthuis Theaterkamer add-on [inactive]',
  4,
  '4 boxsprings via the Poorthuis vide; €50/night extra venue fee. Activate only if all else is full.',
  'inactive',
  503,
  NULL,
  (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
);

-- Re-link the pre-allocated host/cook registrations to the new room rows.
UPDATE registrations
   SET inventory_unit_id = (SELECT id FROM inventory_units WHERE name LIKE 'Room 1.1%' LIMIT 1)
 WHERE name = 'Jacob (host)';
UPDATE registrations
   SET inventory_unit_id = (SELECT id FROM inventory_units WHERE name LIKE 'Room 1.1%' LIMIT 1)
 WHERE name = 'Lesanne (host)';
UPDATE registrations
   SET inventory_unit_id = (SELECT id FROM inventory_units WHERE name LIKE 'Room 2.1%' LIMIT 1)
 WHERE name = 'Muriel (cook)';

-- Update tier.capacity to reflect actual sellable seats (the runtime
-- availability logic now computes from rooms, but admin reports still
-- display this column).
UPDATE tiers SET capacity = 2  WHERE slug='private-ensuite'     AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026');
UPDATE tiers SET capacity = 5  WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026');
UPDATE tiers SET capacity = 14 WHERE slug='shared-bedroom'      AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026');
UPDATE tiers SET capacity = 9  WHERE slug='common-space'        AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026');
