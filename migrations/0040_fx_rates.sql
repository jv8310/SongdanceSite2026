-- FX rates → EUR for the order overview's net column. Non-EUR charges are
-- converted to EUR for display. Seeded here with ballpark rates and refreshed
-- daily by the hourly cron (src/worker-entrypoint.ts) from the ECB via
-- frankfurter.app. See src/lib/admin/fx.ts.
CREATE TABLE IF NOT EXISTS fx_rates (
  currency    TEXT PRIMARY KEY,
  rate_to_eur REAL NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO fx_rates (currency, rate_to_eur) VALUES
  ('EUR', 1.0),
  ('USD', 0.92),
  ('GBP', 1.17),
  ('CAD', 0.68),
  ('CHF', 1.05),
  ('NOK', 0.086),
  ('SEK', 0.088),
  ('DKK', 0.134),
  ('AUD', 0.60),
  ('NZD', 0.56);
