-- Rename the Ritual of Belonging product so the Stripe Checkout line
-- item (and the Quaderno invoice generated from it) reads
-- "Ritual of Belonging Retreat, Nov 2026 — Common Space" rather than
-- the wordier internal "Ritual of Belonging — Winter Retreat".
-- The slug stays unchanged so all existing references still work.

UPDATE products
   SET name = 'Ritual of Belonging Retreat, Nov 2026'
 WHERE slug = 'ritual-of-belonging-2026';
