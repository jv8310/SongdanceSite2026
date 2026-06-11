-- Room layout pass 2 — the plan confirmed in chat.
--
--  • Toren: Room 1.3 stops being a Private En-suite and becomes a Shared Room
--    twin; the 4-bed mezzanine (4.1) splits into one Shared twin (4.1) and one
--    Budget twin (new 4.4). → three Toren rooms of two single beds, one budget.
--  • Attic: the attic becomes a Shared Room (two beds). The kitchen-help bed
--    moves OUT of the Theaterkamer into a new "Attic mezzanine" (Room 5.2 is
--    repurposed): one budget bed, still the reserved 30%-off kitchen-help seat.
--  • Theaterkamer is now the single 4-bed room (5.3) only.
--  • Rooms not in the new plan are removed — but only when nothing references
--    them, so a room that has any booking is left in place rather than dropped.

-- helper note: tier id lookups inline below.

-- ── Toren: Room 1.3 → Shared Room twin (no longer en-suite) ──
UPDATE inventory_units
   SET tier_id        = (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
       solo_tier_id   = NULL,
       shared_tier_id = (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
       capacity = 2,
       notes = 'Two single beds.',
       building = 'Toren'
 WHERE name = 'Room 1.3 — Torenverblijf ground floor';

-- ── Toren: 4.1 mezzanine → one Shared twin; add 4.4 → one Budget twin ──
UPDATE inventory_units
   SET tier_id        = (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
       shared_tier_id = (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
       capacity = 2,
       notes = 'Two single beds.',
       building = 'Toren'
 WHERE name = 'Room 4.1 — Torenverblijf mezzanine';

INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id, couple_tier_id, role, building)
SELECT t.id, 'Room 4.4 — Torenverblijf mezzanine', 2, 'Two single beds.', 'available', 404, NULL, t.id, NULL, NULL, 'Toren'
  FROM tiers t
 WHERE t.slug='common-space' AND t.product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')
   AND NOT EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.name='Room 4.4 — Torenverblijf mezzanine');

-- ── Attic → Shared Room twin ──
UPDATE inventory_units
   SET tier_id        = (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
       shared_tier_id = (SELECT id FROM tiers WHERE slug='shared-bedroom' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026')),
       capacity = 2,
       notes = 'Two single beds.',
       building = 'Poorthuis'
 WHERE name = 'Room 5.1 — Attic';

-- ── Attic mezzanine: relocate the kitchen-help bed out of the Theaterkamer ──
-- (keeps role='cook_help' + reserved status, so the 30%-off opt-in still works)
UPDATE inventory_units
   SET name = 'Room 5.2 — Attic mezzanine',
       capacity = 1,
       notes = 'Single bed; reserved for kitchen help (30% off their room).',
       building = 'Poorthuis'
 WHERE name = 'Room 5.2 — Theaterkamer mezzanine (cook help)';

-- ── Remove rooms not in the new plan (only if nothing references them) ──
DELETE FROM inventory_units
 WHERE name IN (
   'Room 2.1 — Poorthuis mezzanine (cook)',
   'Room 2.2 — Poorthuis 2nd floor',
   'Room 2.3 — Poorthuis 2nd floor (solo, double bed)',
   'Room 2.7 — Poorthuis Living Room (sofa-bed)',
   'Room 3.2 — Balkonverblijf kitchen',
   'Room 4.2 — Theaterkamer ground floor'
 )
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.inventory_unit_id = inventory_units.id);

-- Private Shared-bath now has a single sellable room (the Ridderzaal canopy,
-- also sold as the couple Private Double); reflect that in the admin column.
UPDATE tiers SET capacity = 1
 WHERE slug='private-shared-bath' AND product_id=(SELECT id FROM products WHERE slug='ritual-of-belonging-2026');
