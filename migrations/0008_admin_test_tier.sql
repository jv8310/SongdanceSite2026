-- Admin-only payment-flow test tier (€1).
--
-- The registration form hides this option unless `?admin=true` is in the
-- page URL, so regular visitors never see it. It exists so the admin can
-- exercise the full Stripe → webhook → Drip / Quaderno path end-to-end
-- without a real €595+ charge.

INSERT INTO tiers (product_id, slug, name, description, price_cents, capacity, sort_order, active)
VALUES (
  (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026'),
  'admin-test-1eur',
  'Admin test — €1',
  'Internal payment-flow test only — visible when ?admin=true is in the URL.',
  100,
  999,
  99,
  1
);

-- Matching inventory bed so pickRoomForTier can auto-assign a room
-- when the admin tier is chosen. Capacity is set very high so repeated
-- test bookings don't ever exhaust it.
INSERT INTO inventory_units (tier_id, name, capacity, notes, status, sort_order, solo_tier_id, shared_tier_id)
VALUES (
  (SELECT id FROM tiers WHERE slug = 'admin-test-1eur'
     AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')),
  'Admin test bed',
  999,
  'Internal test inventory — assigned only to admin-test-1eur bookings.',
  'available',
  999,
  (SELECT id FROM tiers WHERE slug = 'admin-test-1eur'
     AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026')),
  NULL
);
