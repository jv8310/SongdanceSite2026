-- Dolphin & Sound Retreat — "Voices of the Deep", 1–8 November 2026,
-- aboard the Nooraya in the Red Sea, Egypt. Hosted by Jacob.
--
-- This seeds the registration product/tier behind the dedicated landing
-- page at /retreats/dolphin-and-sound (full Stripe checkout via
-- /api/registrations/dolphin-checkout), and refreshes the /events grid
-- row that 0020 seeded with placeholder ("details to be confirmed") data.
--
-- The retreat sells a single option — a twin cabin with private bathroom,
-- "all-in" at €1995, max 17 places. There is no château-style room model
-- here: availability is a simple count against the tier capacity, so we do
-- NOT create inventory_units (registrations carry inventory_unit_id = NULL).
--
-- INSERT OR IGNORE / UPDATE keep this migration safe to re-run.

INSERT OR IGNORE INTO products (slug, type, name, description, currency, vat_rate, starts_at, ends_at, drip_tag)
VALUES (
  'dolphin-and-sound-2026',
  'retreat',
  'Dolphin & Sound Retreat',
  'Seven days with wild dolphins and your own voice, aboard the Nooraya in Egypt''s Red Sea. 1–8 November 2026, hosted by Jacob.',
  'EUR',
  0.0,
  '2026-11-01',
  '2026-11-08',
  'ev_2026-11_Dolphin'
);

-- Single tier — twin cabin with private bathroom, all-inclusive · €1995.
-- Capacity 17 (the boat takes a maximum of 17 participants).
INSERT OR IGNORE INTO tiers (product_id, slug, name, description, price_cents, capacity, sort_order)
VALUES (
  (SELECT id FROM products WHERE slug = 'dolphin-and-sound-2026'),
  'twin-cabin',
  'Twin cabin, all-inclusive',
  'A twin cabin with its own bathroom aboard the Nooraya. All-in: airport shuttle, full board, dolphin swims with guides, snorkelling, and the daily sessions with Jacob.',
  199500,
  17,
  1
);

-- Refresh the /events catalogue row (seeded as a placeholder in 0020) so the
-- grid, homepage strip and RetreatBand reflect the real, open retreat.
UPDATE calendar_events
   SET title      = 'Dolphin & Sound Retreat',
       start_date = '2026-11-01',
       end_date   = '2026-11-08',
       location   = 'Sataya Reef · Red Sea, Egypt',
       capacity   = 17,
       price      = '€1995',
       status     = 'open',
       summary    = 'Seven days with wild dolphins and your own voice, aboard the Nooraya in Egypt''s Red Sea.',
       href       = '/retreats/dolphin-and-sound',
       updated_at = datetime('now')
 WHERE id = 'dolphin-and-sound-2026-11';
