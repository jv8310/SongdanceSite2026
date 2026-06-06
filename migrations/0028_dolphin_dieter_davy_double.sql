-- Dieter & Davy take the double cabin; Jeremy switches to a single.
--
-- Background: in the seed (migration 0027) Jeremy (co-facilitator) was holding
-- double cabin D2 on his own, non-paying. Dieter & Davy have now booked as a
-- couple, so they get the double cabin and Jeremy moves into a sole-occupancy
-- lower-deck twin instead (a "single", mirroring Alberto's L4 gesture).
--
--   • Cabin L5 (twin, lower deck) → Jeremy, sole occupancy, reserved, non-paying.
--   • Cabin D2 (double, lower deck) → Dieter & Davy. Payment will follow later,
--     so the registration is 'pending' with no hold expiry: it holds the cabin
--     indefinitely until settled. One booking for two people = €3990.
--
-- Idempotent: the Dieter & Davy insert is guarded by NOT EXISTS; the cabin
-- move + reservations are plain UPDATEs.

-- ─── Jeremy switches out of the double (D2) into a sole-occupancy twin (L5) ──

-- Reserve L5 so its second bed is never sold (same treatment as Alberto's L4).
UPDATE inventory_units
   SET status = 'reserved',
       notes  = 'RESERVED — Jeremy (co-facilitator): sole occupancy of a lower-deck twin. Non-paying; not sold. Switched here from double cabin D2 so Dieter & Davy could take the double.'
 WHERE name = 'Cabin L5 — twin, lower deck (porthole)';

-- Point Jeremy's registration at the twin-lower tier + Cabin L5.
UPDATE registrations
   SET tier_id = (SELECT t.id
                    FROM tiers t
                    JOIN products p ON p.id = t.product_id
                   WHERE p.slug = 'dolphin-and-sound-2026' AND t.slug = 'twin-lower'),
       inventory_unit_id = (SELECT id FROM inventory_units
                             WHERE name = 'Cabin L5 — twin, lower deck (porthole)'),
       notes = 'Co-facilitator — sole occupancy of a lower-deck twin (Cabin L5). Non-paying. Switched from double cabin D2 so Dieter & Davy could book the double. NO EMAIL on file — placeholder used; please add the real address if needed.'
 WHERE product_id = (SELECT id FROM products WHERE slug = 'dolphin-and-sound-2026')
   AND name = 'Jeremy (co-facilitator)';

-- ─── Free the double cabin (D2) and give it to Dieter & Davy ────────────────

-- Back to 'available': the cabin is now governed by Dieter & Davy's booking
-- (a single booking on the whole-unit double tier locks every bed in it).
UPDATE inventory_units
   SET status = 'available',
       notes  = 'Private cabin, one double bed for two people sharing; lower deck, porthole, private bathroom.'
 WHERE name = 'Cabin D2 — double, lower deck (porthole)';

-- Dieter & Davy — double cabin for two. Payment to follow later, so the row is
-- left 'pending' with no hold_expires_at, which holds the cabin until settled.
-- €3990 for two people sharing.
INSERT INTO registrations
  (product_id, tier_id, inventory_unit_id, name, first_name, last_name, email, country,
   roommate_pref, status, amount_cents, balance_due_cents, currency,
   consent_framework, consent_terms, consent_at, created_at, notes)
SELECT p.id, t.id, iu.id, 'Dieter & Davy', 'Dieter', NULL, 'dieter-davy@placeholder.invalid', NULL,
       'Davy (partner — sharing the double cabin)', 'pending', 399000, 0, 'EUR',
       1, 1, datetime('now'), datetime('now'),
       'Booked the double cabin (D2) as a couple. Payment to follow later — left pending with no hold expiry so the cabin is held until settled. NO EMAIL on file — placeholder used; please add the real address.'
  FROM products p
  JOIN tiers t ON t.product_id = p.id AND t.slug = 'double-lower'
  JOIN inventory_units iu ON iu.name = 'Cabin D2 — double, lower deck (porthole)'
 WHERE p.slug = 'dolphin-and-sound-2026'
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = p.id AND r.name = 'Dieter & Davy');
