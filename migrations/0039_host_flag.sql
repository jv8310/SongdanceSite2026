-- Mark the two hosts and the cook as HOST rather than paying clients.
--
-- Implemented as a flag column rather than a new status value: widening the
-- registrations.status CHECK would mean rebuilding the whole (live, core)
-- table. They keep status='paid' so they still occupy their rooms and show in
-- guest lists, but the admin renders them as HOST and excludes them from the
-- paying-client count and the paying-capacity ceiling. Zabine (a real transfer
-- guest) is left as a normal paid client and is counted.

ALTER TABLE registrations ADD COLUMN host INTEGER NOT NULL DEFAULT 0;

UPDATE registrations
   SET host = 1
 WHERE product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')
   AND name IN ('Jacob (host)', 'Lesanne (host)', 'Muriel (cook)');
