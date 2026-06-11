-- Room layout pass 3 — reseed the Ritual of Belonging rooms to match the full
-- overview Jacob gave (Poorthuis / Theaterkamer / Balkonverblijf /
-- Torenverblijf / Paviljoen). This replaces the whole room set, so it follows
-- the same safe pattern as 0005: detach every registration from its room
-- first (so deletes never dangle or FK-fail), rebuild the inventory, then
-- re-link the known pre-allocated people.
--
-- NOTE: any real guest bookings are detached from their (now-replaced) room
-- and will need re-assigning in /admin — unavoidable when the whole room map
-- changes. Hosts, the cook (Muriel) and the new transfer guest (Zabine) are
-- re-linked below.
--
-- The room inserts are written as per-building multi-row VALUES (not one big
-- UNION ALL SELECT) because D1 caps the number of terms in a compound SELECT
-- ("too many terms in compound SELECT").

-- 1) Detach all RB registrations from their rooms.
UPDATE registrations
   SET inventory_unit_id = NULL
 WHERE product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');

-- 2) Drop the old RB rooms (keep the €1 admin-test bed).
DELETE FROM inventory_units
 WHERE tier_id IN (
   SELECT id FROM tiers
    WHERE product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')
      AND slug <> 'admin-test-1eur'
 );

-- 3) Rebuild the catalog. Tier slugs:
--    private-ensuite (Private En-suite), private-shared-bath (Private room,
--    shared bath), private-double (couple), shared-bedroom (Twin / Shared
--    Room), common-space (Budget Room).

-- ── Poorthuis ──
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id, couple_tier_id, role, building) VALUES
  ((SELECT id FROM tiers WHERE slug='private-ensuite'     AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room P1 — Ground floor en-suite', 2, 'Private room with the bathroom in the room (ensuite).', 'available', 101, (SELECT id FROM tiers WHERE slug='private-ensuite' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, NULL, 'Poorthuis'),
  ((SELECT id FROM tiers WHERE slug='private-ensuite'     AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room P2 — 1st floor en-suite (hosts)', 2, 'RESERVED for Jacob & Lesanne (hosts). Bathroom in the room (ensuite).', 'reserved', 102, (SELECT id FROM tiers WHERE slug='private-ensuite' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, NULL, 'Poorthuis'),
  ((SELECT id FROM tiers WHERE slug='private-ensuite'     AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room P3 — 1st floor en-suite', 2, 'Private room with the bathroom in the room (ensuite).', 'available', 103, (SELECT id FROM tiers WHERE slug='private-ensuite' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, NULL, 'Poorthuis'),
  ((SELECT id FROM tiers WHERE slug='common-space'        AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room P4 — 2nd floor budget bed', 1, 'One budget bed.', 'available', 104, NULL, (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, 'Poorthuis'),
  ((SELECT id FROM tiers WHERE slug='shared-bedroom'      AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room P5 — 3rd floor twin', 2, 'Two single beds (twin).', 'available', 105, NULL, (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, 'Poorthuis'),
  ((SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room P6 — 3rd floor private room', 1, 'Private room; bathroom on the same floor.', 'available', 106, (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, NULL, 'Poorthuis'),
  ((SELECT id FROM tiers WHERE slug='common-space'        AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room P7 — Attic (3 budget beds)', 3, 'Three budget beds; one is the kitchen-help bed (30% off opt-in).', 'available', 107, NULL, (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, 'cook_help', 'Poorthuis');

-- ── Theaterkamer ──
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id, couple_tier_id, role, building) VALUES
  ((SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room K1 — Budget room for four', 4, 'Budget room for four.', 'available', 201, NULL, (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, 'Theaterkamer');

-- ── Balkonverblijf ──
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id, couple_tier_id, role, building) VALUES
  ((SELECT id FROM tiers WHERE slug='shared-bedroom'      AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room B1 — Twin', 2, 'Two single beds (twin).', 'available', 301, NULL, (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, 'Balkonverblijf'),
  ((SELECT id FROM tiers WHERE slug='shared-bedroom'      AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room B2 — Twin', 2, 'Two single beds (twin).', 'available', 302, NULL, (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, 'Balkonverblijf'),
  ((SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room B3 — Private room', 1, 'Private room; shared bathroom.', 'available', 303, (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, NULL, 'Balkonverblijf'),
  ((SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room B4 — Ridderzaal (canopy)', 2, 'Four-poster canopy bed in the Ridderzaal; shared bathroom. Sold for one (Private Shared-bath) or two (Private Double).', 'available', 304, (SELECT id FROM tiers WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, (SELECT id FROM tiers WHERE slug='private-double' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, 'Balkonverblijf'),
  ((SELECT id FROM tiers WHERE slug='shared-bedroom'      AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room B5 — Twin', 2, 'Two single beds (twin).', 'available', 305, NULL, (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, 'Balkonverblijf');

-- ── Torenverblijf ──
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id, couple_tier_id, role, building) VALUES
  ((SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room R1 — Twin', 2, 'Two single beds (twin).', 'available', 401, NULL, (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, 'Torenverblijf'),
  ((SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room R2 — Twin', 2, 'Two single beds (twin).', 'available', 402, NULL, (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, 'Torenverblijf'),
  ((SELECT id FROM tiers WHERE slug='common-space'   AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Room R3 — Budget bed', 1, 'One budget bed.', 'available', 403, NULL, (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, NULL, 'Torenverblijf');

-- ── Paviljoen ──
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id, couple_tier_id, role, building) VALUES
  ((SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), 'Paviljoen — fire keeper bed', 1, 'RESERVED for fire keeper.', 'reserved', 501, NULL, (SELECT id FROM tiers WHERE slug='common-space' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')), NULL, 'fire_keeper', 'Paviljoen');

-- 4) Re-link the hosts to P2. Scope to this product — another retreat seeds a
--    registration also named 'Jacob (host)'.
UPDATE registrations
   SET inventory_unit_id = (SELECT id FROM inventory_units WHERE name LIKE 'Room P2 —%' LIMIT 1)
 WHERE name IN ('Jacob (host)', 'Lesanne (host)')
   AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');

-- 5) Muriel (cook) shares Balkon twin B1 with the transfer guest Zabine.
UPDATE registrations
   SET inventory_unit_id = (SELECT id FROM inventory_units WHERE name = 'Room B1 — Twin' LIMIT 1),
       tier_id = (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026'))
 WHERE name = 'Muriel (cook)'
   AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');

-- 6) Zabine — transferred in from another retreat (was ill). Pre-allocated,
--    non-paying placeholder; update her contact details / amount in /admin.
--    Guarded so a re-run never duplicates her.
INSERT INTO registrations (product_id, tier_id, inventory_unit_id, name, email, status, amount_cents, currency, notes)
SELECT
  (SELECT id FROM products WHERE slug='ritual-of-belonging-2026'),
  (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
  (SELECT id FROM inventory_units WHERE name = 'Room B1 — Twin' LIMIT 1),
  'Zabine', 'zabine@songdance.co', 'paid', 0, 'EUR',
  'Transferred from another retreat (was ill); placeholder — update contact + amount.'
WHERE NOT EXISTS (
  SELECT 1 FROM registrations
   WHERE name = 'Zabine'
     AND product_id = (SELECT id FROM products WHERE slug='ritual-of-belonging-2026')
);

-- 7) Tidy the admin-display tier capacities to the new room counts.
UPDATE tiers SET capacity = 3  WHERE slug='private-ensuite'     AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026');
UPDATE tiers SET capacity = 3  WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026');
UPDATE tiers SET capacity = 2  WHERE slug='private-double'      AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026');
UPDATE tiers SET capacity = 12 WHERE slug='shared-bedroom'      AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026');
UPDATE tiers SET capacity = 9  WHERE slug='common-space'        AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026');
