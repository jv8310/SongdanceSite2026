-- Flag every retreat's hosts as HOST, so the intake never invites them.
--
-- The retreat page's Intake section (migration 0085) lists every paid,
-- non-host booking as a guest to screen. Migration 0039 flagged the hosts of
-- the château only (Ritual of Belonging); the boat's non-paying staff rows,
-- seeded in 0027, were never flagged — so Jacob (host) and Jeremy
-- (co-facilitator) read as paying guests on Dolphin & Sound: listed for an
-- intake, and counted in the capacity table's paying total.
--
-- Hosts per retreat, as the owner named them (September 2026):
--   Dolphin & Sound      — Jacob, Jeremy
--   Ritual of Belonging  — Jacob, Lesanne, Muriel (cook)
--
-- Matched by the seeded name OR the seeded address, so a row whose name or
-- (placeholder) address was edited since still matches. The château's rows are
-- re-asserted in case 0039's name match missed one. The flag only changes who
-- counts as a paying guest; rooms, cabins and payments are untouched.
-- Idempotent.

UPDATE registrations
   SET host = 1
 WHERE host = 0
   AND product_id = (SELECT id FROM products WHERE slug = 'dolphin-and-sound-2026')
   AND (name IN ('Jacob (host)', 'Jeremy (co-facilitator)')
        OR lower(email) IN ('jacob@songdance.co', 'jeremy@placeholder.invalid'));

UPDATE registrations
   SET host = 1
 WHERE host = 0
   AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')
   AND (name IN ('Jacob (host)', 'Lesanne (host)', 'Muriel (cook)')
        OR lower(email) IN ('jacob@songdance.co', 'lesanne@songdance.co', 'muriel@songdance.co'));
