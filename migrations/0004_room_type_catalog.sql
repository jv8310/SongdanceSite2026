-- Switch the Ritual of Belonging tier catalog from the v6 five-tier model to
-- the v7 four-room-type model:
--   Private En-suite      €995   capacity 4 (2 host pre-allocations + 2 sellable)
--   Private Shared-bath   €795   capacity 6 (1 pre-allocation + 5 sellable)
--   Shared Bedroom        €695   capacity 14
--   Common Space          €595   capacity 9
--
-- We UPDATE existing tier rows in place so the pre-allocated host/cook
-- registrations (which reference tier_id by FK) stay valid. The dropped
-- "Dormitory" tier-5 is folded into Common Space and deactivated so the
-- form no longer offers it.

UPDATE tiers
SET slug = 'private-ensuite',
    name = 'Private En-suite',
    description = 'Your own room with private bathroom — the most private option.',
    price_cents = 99500,
    capacity = 4,
    sort_order = 1
WHERE slug = 'tier-1'
  AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');

UPDATE tiers
SET slug = 'private-shared-bath',
    name = 'Private Shared-bath',
    description = 'Your own room, with bathroom on the same floor or within the unit.',
    price_cents = 79500,
    capacity = 6,
    sort_order = 2
WHERE slug = 'tier-2'
  AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');

UPDATE tiers
SET slug = 'shared-bedroom',
    name = 'Shared Bedroom',
    description = 'A bed in a real bedroom, shared with 1–2 others.',
    price_cents = 69500,
    capacity = 14,
    sort_order = 3
WHERE slug = 'tier-3'
  AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');

UPDATE tiers
SET slug = 'common-space',
    name = 'Common Space',
    description = 'A bed in a beautiful open space — mezzanine, gallery or attic.',
    price_cents = 59500,
    capacity = 9,
    sort_order = 4
WHERE slug = 'tier-4'
  AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');

-- Old "Dormitory" tier folds into Common Space — deactivate so the form
-- and admin both stop offering it. The row stays for historical reference.
UPDATE tiers
SET active = 0
WHERE slug = 'tier-5'
  AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');
