-- Dolphin & Sound Retreat — two data fixes that go with the "free until paid"
-- room policy (checkout no longer assigns a cabin to a pending/unpaid booking;
-- the cabin is placed only when payment lands — see dolphin-checkout.ts +
-- assignRoomOnPaid).
--
--   Part A — Double cabins are couples: show 2 people each.
--     D1 (Joy Pe + husband) and D2 (Dieter + Davy) are each ONE €3990 booking
--     for two people sharing, so the rooms view showed "Booked 1 / 2". Every
--     other couple on this retreat (the twin cabins) is modelled as two
--     registration rows sharing a cabin; the two double cabins were the only
--     ones left as a single row. Add the second occupant so each double cabin
--     reads 2 people (the money stays on the primary booking; the partner is a
--     €0 co-occupant). Placeholder email/name where we don't have the partner's
--     details — same convention the seed already uses.
--
--   Part B — Free cabins currently held by unpaid pending bookings.
--     Before this change the checkout auto-assigned a cabin to every pending
--     row, so unpaid holds (abandoned or mid-checkout) sat "in" a cabin. Clear
--     the cabin on those rows so the places read as open — matching the new
--     policy for rows that already exist. Scoped to checkout-created holds
--     (hold_expires_at IS NOT NULL); the intentionally-held couple bookings
--     (Dieter/Davy, seeded with NO hold expiry) are left untouched. If any of
--     these later pay, the paid path re-places them via assignRoomOnPaid.
--
-- Idempotent: the partner inserts are guarded by NOT EXISTS on their
-- placeholder email; the rename + the cabin-clear are plain UPDATEs that no-op
-- on a re-run.

-- ─── Part A · D1 — Joy Pe + husband ────────────────────────────────────────
INSERT INTO registrations
  (product_id, tier_id, inventory_unit_id, name, first_name, last_name, email, country,
   roommate_pref, status, amount_cents, balance_due_cents, currency,
   consent_framework, consent_terms, consent_at, created_at, paid_at, notes)
SELECT p.id, t.id, iu.id, 'Joy Pe — partner', NULL, NULL, 'joy-pe-partner@placeholder.invalid', 'GB',
       'Joy Pe — sharing the double cabin (D1)', 'paid', 0, 0, 'EUR',
       1, 1, datetime('now'), datetime('now'), datetime('now'),
       'Second occupant of double cabin D1 (Joy Pe + husband) — one €3990 booking for two, held on Joy''s row. Added so the cabin shows both people; €0 (covered by Joy''s booking). NO name/email on file — placeholder used, please add the husband''s details.'
  FROM products p
  JOIN tiers t ON t.product_id = p.id AND t.slug = 'double-lower'
  JOIN inventory_units iu ON iu.name = 'Cabin D1 — double, lower deck (porthole)'
 WHERE p.slug = 'dolphin-and-sound-2026'
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = p.id AND r.email = 'joy-pe-partner@placeholder.invalid');

-- ─── Part A · D2 — Dieter + Davy ───────────────────────────────────────────
-- The couple was seeded as a single "Dieter & Davy" row (€3990, pending, no
-- hold). Rename it to Dieter and add Davy as the second occupant.
UPDATE registrations
   SET name = 'Dieter Vandeputte',
       first_name = 'Dieter',
       last_name = 'Vandeputte',
       roommate_pref = 'Davy (husband — sharing the double cabin D2)',
       notes = 'Booked double cabin D2 as a couple (Dieter + Davy) — one €3990 booking for two, held on this row. Left pending (payment to follow) with no hold expiry so the cabin is held until settled. Confirm via admin "Mark paid + Drip".'
 WHERE product_id = (SELECT id FROM products WHERE slug = 'dolphin-and-sound-2026')
   AND name = 'Dieter & Davy';

INSERT INTO registrations
  (product_id, tier_id, inventory_unit_id, name, first_name, last_name, email, country,
   roommate_pref, status, amount_cents, balance_due_cents, currency,
   consent_framework, consent_terms, consent_at, created_at, notes)
SELECT p.id, t.id, iu.id, 'Davy', 'Davy', NULL, 'davy-partner@placeholder.invalid', NULL,
       'Dieter (husband — sharing the double cabin D2)', 'pending', 0, 0, 'EUR',
       1, 1, datetime('now'), datetime('now'),
       'Second occupant of double cabin D2 (Dieter + Davy) — one €3990 booking for two, held on Dieter''s row. Added so the cabin shows both people. Pending with no hold expiry (held until the couple settles). NO email on file — placeholder used.'
  FROM products p
  JOIN tiers t ON t.product_id = p.id AND t.slug = 'double-lower'
  JOIN inventory_units iu ON iu.name = 'Cabin D2 — double, lower deck (porthole)'
 WHERE p.slug = 'dolphin-and-sound-2026'
   AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = p.id AND r.email = 'davy-partner@placeholder.invalid');

-- ─── Part B · free cabins held by unpaid checkout pendings ──────────────────
UPDATE registrations
   SET inventory_unit_id = NULL
 WHERE product_id = (SELECT id FROM products WHERE slug = 'dolphin-and-sound-2026')
   AND status = 'pending'
   AND inventory_unit_id IS NOT NULL
   AND hold_expires_at IS NOT NULL;
