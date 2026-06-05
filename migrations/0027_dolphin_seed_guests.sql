-- Seed the Dolphin & Sound Retreat with the guests already registered before
-- the three-cabin model went live (imported from the pre-launch registrations
-- sheet). Twin pairs are separate registrations sharing one cabin (as on the
-- château retreat). Amounts + balances reflect what each person actually paid:
-- a 50% deposit leaves the other 50% as balance_due_cents.
--
-- Special cases:
--   • Alberto — returning guest, given a lower-deck twin (Cabin L4) to himself
--     as a gesture. The cabin is reserved so the second bed is never sold.
--   • Jeremy — co-facilitator, given a double cabin (Cabin D2) alone,
--     non-paying. Cabin reserved.
--   • Jacob — host, upper-deck twin (Cabin U3, already reserved), non-paying.
--
-- Idempotent: each insert is guarded by NOT EXISTS on (product, email); the
-- two cabin reservations are plain UPDATEs.

-- ─── Reserve the sole-occupancy cabins ────────────────────────────────────
UPDATE inventory_units
   SET status = 'reserved',
       notes  = 'RESERVED — Alberto (returning guest): sole occupancy of a lower-deck twin as a gesture. Not sold.'
 WHERE name = 'Cabin L4 — twin, lower deck (porthole)';

UPDATE inventory_units
   SET status = 'reserved',
       notes  = 'RESERVED — Jeremy (co-facilitator): sole occupancy of a double cabin. Non-paying; not sold.'
 WHERE name = 'Cabin D2 — double, lower deck (porthole)';

-- ─── Paying registrations ─────────────────────────────────────────────────

-- Cabin L1 — Manu (twin, lower deck). Dieter (his hoped-for cabin-mate) is
-- left out for now: it's unclear whether he'll come alone, as a pair, or not
-- at all. The second bed in L1 is therefore left open.
INSERT INTO registrations
  (product_id, tier_id, inventory_unit_id, name, first_name, last_name, email, country,
   roommate_pref, status, amount_cents, balance_due_cents, currency,
   consent_framework, consent_terms, consent_at, created_at, paid_at, notes)
SELECT p.id, t.id, iu.id, 'Manu', 'Manu', NULL, 'manuomshanti@gmail.com', NULL,
       'Hoped to share with Dieter (unconfirmed — may come alone, as a pair, or not at all)', 'paid', 99750, 99750, 'EUR',
       1, 1, datetime('now'), datetime('now'), datetime('now'),
       'Imported from pre-launch registrations sheet. 50% deposit paid; balance €997.50 due before 1 September 2026.'
  FROM products p
  JOIN tiers t ON t.product_id = p.id AND t.slug = 'twin-lower'
  JOIN inventory_units iu ON iu.name = 'Cabin L1 — twin, lower deck (porthole)'
 WHERE p.slug = 'dolphin-and-sound-2026'
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = p.id AND r.email = 'manuomshanti@gmail.com');

-- Cabin L2 — Anne-Mie & Katrien (twin, lower deck).
INSERT INTO registrations
  (product_id, tier_id, inventory_unit_id, name, first_name, last_name, email, country,
   roommate_pref, status, amount_cents, balance_due_cents, currency,
   consent_framework, consent_terms, consent_at, created_at, paid_at, notes)
SELECT p.id, t.id, iu.id, 'Anne-Mie Verheyen', 'Anne-Mie', 'Verheyen', 'anne-marie_verheyen@hotmail.com', 'BE',
       'Sharing with Katrien', 'paid', 199500, 0, 'EUR',
       1, 1, '2026-01-06 16:09:42', '2026-01-06 16:09:42', '2026-01-06 16:09:42',
       'Imported from pre-launch registrations sheet (order 39311834). Paid in full.'
  FROM products p
  JOIN tiers t ON t.product_id = p.id AND t.slug = 'twin-lower'
  JOIN inventory_units iu ON iu.name = 'Cabin L2 — twin, lower deck (porthole)'
 WHERE p.slug = 'dolphin-and-sound-2026'
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = p.id AND r.email = 'anne-marie_verheyen@hotmail.com');

INSERT INTO registrations
  (product_id, tier_id, inventory_unit_id, name, first_name, last_name, email, country,
   roommate_pref, status, amount_cents, balance_due_cents, currency,
   consent_framework, consent_terms, consent_at, created_at, paid_at, notes)
SELECT p.id, t.id, iu.id, 'Katrien Moens', 'Katrien', 'Moens', 'katrien.moens8@telenet.be', 'BE',
       'Sharing with Anne-Mie', 'paid', 99750, 99750, 'EUR',
       1, 1, '2026-02-12 13:48:44', '2026-02-12 13:48:44', '2026-02-12 13:48:44',
       'Imported from pre-launch registrations sheet (order 40105924). 50% deposit paid; balance €997.50 due before 1 September 2026.'
  FROM products p
  JOIN tiers t ON t.product_id = p.id AND t.slug = 'twin-lower'
  JOIN inventory_units iu ON iu.name = 'Cabin L2 — twin, lower deck (porthole)'
 WHERE p.slug = 'dolphin-and-sound-2026'
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = p.id AND r.email = 'katrien.moens8@telenet.be');

-- Cabin L3 — Zsanett & Vilma (twin, lower deck).
INSERT INTO registrations
  (product_id, tier_id, inventory_unit_id, name, first_name, last_name, email, country,
   roommate_pref, status, amount_cents, balance_due_cents, currency,
   consent_framework, consent_terms, consent_at, created_at, paid_at, notes)
SELECT p.id, t.id, iu.id, 'Zsanett Viktoria Fizli', 'Zsanett', 'Viktoria Fizli', 'zsanettfizli.evolve@gmail.com', 'NL',
       'Sharing with Vilma', 'paid', 99750, 99750, 'EUR',
       1, 1, '2026-03-05 21:20:44', '2026-03-05 21:20:44', '2026-03-05 21:20:44',
       'Imported from pre-launch registrations sheet (order 40479048). 50% deposit paid; balance €997.50 due before 1 September 2026.'
  FROM products p
  JOIN tiers t ON t.product_id = p.id AND t.slug = 'twin-lower'
  JOIN inventory_units iu ON iu.name = 'Cabin L3 — twin, lower deck (porthole)'
 WHERE p.slug = 'dolphin-and-sound-2026'
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = p.id AND r.email = 'zsanettfizli.evolve@gmail.com');

INSERT INTO registrations
  (product_id, tier_id, inventory_unit_id, name, first_name, last_name, email, country,
   roommate_pref, status, amount_cents, balance_due_cents, currency,
   consent_framework, consent_terms, consent_at, created_at, paid_at, notes)
SELECT p.id, t.id, iu.id, 'Vilma Kliucinskiene', 'Vilma', 'Kliucinskiene', 'vilmma69@gmail.com', 'IE',
       'Sharing with Zsanett', 'paid', 199500, 0, 'EUR',
       1, 1, '2026-06-03 21:13:38', '2026-06-03 21:13:38', '2026-06-03 21:13:38',
       'Imported from pre-launch registrations sheet (order 41878106). Paid in full.'
  FROM products p
  JOIN tiers t ON t.product_id = p.id AND t.slug = 'twin-lower'
  JOIN inventory_units iu ON iu.name = 'Cabin L3 — twin, lower deck (porthole)'
 WHERE p.slug = 'dolphin-and-sound-2026'
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = p.id AND r.email = 'vilmma69@gmail.com');

-- Cabin L4 — Alberto, sole occupancy (reserved above).
INSERT INTO registrations
  (product_id, tier_id, inventory_unit_id, name, first_name, last_name, email, country,
   roommate_pref, status, amount_cents, balance_due_cents, currency,
   consent_framework, consent_terms, consent_at, created_at, paid_at, notes)
SELECT p.id, t.id, iu.id, 'Alberto', 'Alberto', NULL, 'info@yogasoma.be', NULL,
       NULL, 'paid', 99750, 99750, 'EUR',
       1, 1, datetime('now'), datetime('now'), datetime('now'),
       'Imported from pre-launch registrations sheet. Returning guest — given a lower-deck twin to himself as a gesture. 50% deposit paid; balance €997.50 due before 1 September 2026.'
  FROM products p
  JOIN tiers t ON t.product_id = p.id AND t.slug = 'twin-lower'
  JOIN inventory_units iu ON iu.name = 'Cabin L4 — twin, lower deck (porthole)'
 WHERE p.slug = 'dolphin-and-sound-2026'
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = p.id AND r.email = 'info@yogasoma.be');

-- Cabin U1 — Alexandra & Maura (twin, upper deck).
INSERT INTO registrations
  (product_id, tier_id, inventory_unit_id, name, first_name, last_name, email, country,
   roommate_pref, status, amount_cents, balance_due_cents, currency,
   consent_framework, consent_terms, consent_at, created_at, paid_at, notes)
SELECT p.id, t.id, iu.id, 'Alexandra Neumann', 'Alexandra', 'Neumann', 'alexandra.neumann@oebb.at', 'AT',
       'Sharing with Maura', 'paid', 249500, 0, 'EUR',
       1, 1, '2026-01-02 11:45:42', '2026-01-02 11:45:42', '2026-01-02 11:45:42',
       'Imported from pre-launch registrations sheet (order 39224101). Paid in full.'
  FROM products p
  JOIN tiers t ON t.product_id = p.id AND t.slug = 'twin-upper'
  JOIN inventory_units iu ON iu.name = 'Cabin U1 — twin, upper deck (sea views)'
 WHERE p.slug = 'dolphin-and-sound-2026'
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = p.id AND r.email = 'alexandra.neumann@oebb.at');

INSERT INTO registrations
  (product_id, tier_id, inventory_unit_id, name, first_name, last_name, email, country,
   roommate_pref, status, amount_cents, balance_due_cents, currency,
   consent_framework, consent_terms, consent_at, created_at, paid_at, notes)
SELECT p.id, t.id, iu.id, 'Maura Conlon', 'Maura', 'Conlon', 'maurapiano@gmail.com', 'US',
       'Sharing with Alexandra', 'paid', 124750, 124750, 'EUR',
       1, 1, '2026-04-23 21:34:21', '2026-04-23 21:34:21', '2026-04-23 21:34:21',
       'Imported from pre-launch registrations sheet (order 41234740). 50% deposit paid; balance €1247.50 due before 1 September 2026.'
  FROM products p
  JOIN tiers t ON t.product_id = p.id AND t.slug = 'twin-upper'
  JOIN inventory_units iu ON iu.name = 'Cabin U1 — twin, upper deck (sea views)'
 WHERE p.slug = 'dolphin-and-sound-2026'
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = p.id AND r.email = 'maurapiano@gmail.com');

-- Cabin D1 — Joy & husband (double, lower deck; one booking for two people).
INSERT INTO registrations
  (product_id, tier_id, inventory_unit_id, name, first_name, last_name, email, country,
   roommate_pref, status, amount_cents, balance_due_cents, currency,
   consent_framework, consent_terms, consent_at, created_at, paid_at, notes)
SELECT p.id, t.id, iu.id, 'Joy Pe', 'Joy', 'Pe', 'joy.m.pe@gmail.com', 'GB',
       'Husband', 'paid', 199500, 199500, 'EUR',
       1, 1, '2026-01-07 17:44:51', '2026-01-07 17:44:51', '2026-01-07 17:44:51',
       'Imported from pre-launch registrations sheet (order 39334948). Double cabin for two (Joy + husband). 50% deposit paid; balance €1995 due before 1 September 2026.'
  FROM products p
  JOIN tiers t ON t.product_id = p.id AND t.slug = 'double-lower'
  JOIN inventory_units iu ON iu.name = 'Cabin D1 — double, lower deck (porthole)'
 WHERE p.slug = 'dolphin-and-sound-2026'
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = p.id AND r.email = 'joy.m.pe@gmail.com');

-- ─── Non-paying: host + co-facilitator ────────────────────────────────────

-- Jacob — host, upper-deck twin (Cabin U3, reserved). Non-paying.
INSERT INTO registrations
  (product_id, tier_id, inventory_unit_id, name, first_name, last_name, email, country,
   roommate_pref, status, amount_cents, balance_due_cents, currency,
   consent_framework, consent_terms, consent_at, created_at, paid_at, notes)
SELECT p.id, t.id, iu.id, 'Jacob (host)', 'Jacob', NULL, 'jacob@songdance.co', NULL,
       NULL, 'paid', 0, 0, 'EUR',
       1, 1, datetime('now'), datetime('now'), datetime('now'),
       'Host — sole occupancy of an upper-deck twin. Non-paying.'
  FROM products p
  JOIN tiers t ON t.product_id = p.id AND t.slug = 'twin-upper'
  JOIN inventory_units iu ON iu.name = 'Cabin U3 — twin, upper deck (host)'
 WHERE p.slug = 'dolphin-and-sound-2026'
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = p.id AND r.name = 'Jacob (host)');

-- Jeremy — co-facilitator, double cabin (Cabin D2, reserved). Non-paying.
-- No email on file; placeholder satisfies the NOT-NULL constraint.
INSERT INTO registrations
  (product_id, tier_id, inventory_unit_id, name, first_name, last_name, email, country,
   roommate_pref, status, amount_cents, balance_due_cents, currency,
   consent_framework, consent_terms, consent_at, created_at, paid_at, notes)
SELECT p.id, t.id, iu.id, 'Jeremy (co-facilitator)', 'Jeremy', NULL, 'jeremy@placeholder.invalid', NULL,
       NULL, 'paid', 0, 0, 'EUR',
       1, 1, datetime('now'), datetime('now'), datetime('now'),
       'Co-facilitator — sole occupancy of a double cabin. Non-paying. NO EMAIL on file — placeholder used; please add the real address if needed.'
  FROM products p
  JOIN tiers t ON t.product_id = p.id AND t.slug = 'double-lower'
  JOIN inventory_units iu ON iu.name = 'Cabin D2 — double, lower deck (porthole)'
 WHERE p.slug = 'dolphin-and-sound-2026'
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = p.id AND r.name = 'Jeremy (co-facilitator)');
