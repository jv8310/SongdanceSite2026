-- Workshop registration & management engine.
--
-- A reusable multi-workshop engine: workshops, products, price points, order
-- bumps, tags and Zoom links are all configurable data. The Somatic Vocal
-- Healing (SVH) workshop is one seeded instance, not hard-coded logic.
--
-- NB: every table is prefixed `workshop_` so it coexists with the existing
-- retreat/course `products` / `registrations` / `tiers` tables (which have a
-- different shape). Webhook idempotency reuses the existing `events`
-- audit-log table (see 0001_init) via logEvent()/eventExists().
--
-- Money is stored as integer minor units (cents) + a 3-letter currency.
-- All datetimes are UTC ISO-8601 strings ("…Z"); the display timezone lives
-- on the workshop.

-- PRODUCTS (workshop ticket, bump, courses). Reusable catalogue.
CREATE TABLE IF NOT EXISTS workshop_products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,              -- "svh-ticket", "asj-bump", "12w-course", "cert-course"
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('ticket','bump','course')),
  tax_code    TEXT NOT NULL DEFAULT 'eservice',  -- Quaderno tax_code / Stripe product tax_class
  active      INTEGER NOT NULL DEFAULT 1
);

-- PRICE POINTS per currency (fixed, not FX-derived).
CREATE TABLE IF NOT EXISTS workshop_product_prices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES workshop_products(id) ON DELETE CASCADE,
  currency     TEXT NOT NULL,                    -- "EUR","USD","GBP",…
  amount_minor INTEGER NOT NULL,                 -- e.g. 600 = €6.00
  UNIQUE(product_id, currency)
);

-- WORKSHOPS — the "events". One row per scheduled session.
CREATE TABLE IF NOT EXISTS workshops (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,            -- used in /w/[slug]
  title           TEXT NOT NULL,
  teacher         TEXT,                            -- optional; used to pick a Zoom link
  starts_at_utc   TEXT NOT NULL,                   -- "2026-06-15T18:00:00Z"
  ends_at_utc     TEXT,                            -- defaults to starts_at + 1h if null
  display_tz      TEXT NOT NULL DEFAULT 'Europe/Brussels',
  zoom_url        TEXT,                            -- explicit link; else resolved by teacher
  main_product_id INTEGER REFERENCES workshop_products(id),
  bump_product_id INTEGER REFERENCES workshop_products(id),
  free_coupon     TEXT,                            -- code that grants free access
  source_tag      TEXT,                            -- Drip tag applied on success (e.g. "svh_workshop_live")
  google_event_id TEXT UNIQUE,                     -- set when imported from Google Calendar
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled')),
  is_replay       INTEGER NOT NULL DEFAULT 0,      -- 1 = on-demand/replay (no live time)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_workshops_status ON workshops(status);
CREATE INDEX IF NOT EXISTS idx_workshops_starts ON workshops(starts_at_utc);

-- REGISTRATIONS (one per person per workshop).
CREATE TABLE IF NOT EXISTS workshop_registrations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  workshop_id        INTEGER NOT NULL REFERENCES workshops(id),
  name               TEXT,
  email              TEXT NOT NULL,                -- store lowercased; match case-insensitively
  phone              TEXT,
  country            TEXT,                         -- ISO-2 from cf.country (or selected)
  currency           TEXT,
  timezone           TEXT,                         -- IANA, from cf.timezone or selection
  locale             TEXT DEFAULT 'en',
  wants_bump         INTEGER NOT NULL DEFAULT 0,
  attendance_status  TEXT NOT NULL DEFAULT 'registered' CHECK (attendance_status IN ('registered','attended','no_show')),
  joined_at_utc      TEXT,                         -- set when they click "Join"
  payment_status     TEXT NOT NULL DEFAULT 'prepared' CHECK (payment_status IN ('prepared','paid','coupon','refunded','chargeback','failed')),
  source_tag         TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workshop_id, email)
);
CREATE INDEX IF NOT EXISTS idx_wreg_email ON workshop_registrations(email);
CREATE INDEX IF NOT EXISTS idx_wreg_workshop ON workshop_registrations(workshop_id);

-- PAYMENTS (Stripe charges). One per Stripe Checkout / PaymentIntent.
CREATE TABLE IF NOT EXISTS workshop_payments (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id          INTEGER NOT NULL REFERENCES workshop_registrations(id),
  provider                 TEXT NOT NULL DEFAULT 'stripe',
  stripe_session_id        TEXT,
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_charge_id         TEXT,
  balance_transaction_id   TEXT,
  status                   TEXT NOT NULL,          -- paid|refunded|chargeback|failed|pending
  method                   TEXT,                   -- card|ideal|paypal|…
  amount_minor             INTEGER NOT NULL,       -- charged total in `currency`
  currency                 TEXT NOT NULL,
  -- Settlement / EUR conversion (from the Stripe balance transaction):
  settlement_amount_minor  INTEGER,                -- net settled in payout currency
  settlement_currency      TEXT,                   -- usually "EUR"
  fx_rate                  REAL,                   -- balance_transaction.exchange_rate
  -- Tax (from Quaderno tax lookup or Stripe Tax):
  tax_rate                 REAL,                   -- 0.21 = 21%
  tax_country              TEXT,
  subtotal_minor           INTEGER,                -- net of tax, in `currency`
  tax_minor                INTEGER,
  -- Invoice created by the Stripe→Quaderno connector (read-back only):
  quaderno_invoice_id      TEXT,
  quaderno_invoice_number  TEXT,
  raw_event                TEXT,                   -- JSON of the Stripe object for audit
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wpay_reg ON workshop_payments(registration_id);

-- PURCHASES (line items). Uniformly captures ticket, bump, AND course sales.
CREATE TABLE IF NOT EXISTS workshop_purchases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER REFERENCES workshop_registrations(id),
  payment_id      INTEGER REFERENCES workshop_payments(id),
  product_id      INTEGER NOT NULL REFERENCES workshop_products(id),
  product_type    TEXT NOT NULL,                  -- ticket|bump|course (denormalized for stats)
  amount_minor    INTEGER NOT NULL,
  currency        TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wpurchase_type ON workshop_purchases(product_type);
CREATE INDEX IF NOT EXISTS idx_wpurchase_reg ON workshop_purchases(registration_id);

-- NOTIFICATIONS sent (idempotent; replaces per-offset boolean flags).
CREATE TABLE IF NOT EXISTS workshop_sent_notifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER NOT NULL REFERENCES workshop_registrations(id),
  type            TEXT NOT NULL,                  -- reminder_7d|reminder_2d|reminder_1d|reminder_6h|reminder_1h|reminder_15m|at_time|post_attended|post_no_show|confirmation|verification
  sent_at_utc     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(registration_id, type)
);

-- AD SPEND (Meta CSV import) for ROAS.
CREATE TABLE IF NOT EXISTS workshop_ad_spend (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  spend_date       TEXT NOT NULL,                 -- "2026-06-01" (UTC date)
  channel          TEXT NOT NULL DEFAULT 'meta',
  campaign         TEXT NOT NULL DEFAULT '',      -- '' when the CSV has no campaign column
  amount_minor     INTEGER NOT NULL,
  currency         TEXT NOT NULL,
  amount_eur_minor INTEGER,                        -- converted on import
  UNIQUE(spend_date, channel, campaign)
);

-- APP CONFIG (Zoom links per teacher, misc).
CREATE TABLE IF NOT EXISTS workshop_config (
  key   TEXT PRIMARY KEY,                          -- "zoom_url_default", "zoom_url_<teacher>"
  value TEXT NOT NULL
);

-- VERIFICATION CODES (email verification).
CREATE TABLE IF NOT EXISTS workshop_verification_codes (
  email       TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

-- ───────────────────────────────────────────────────────────────────────
-- Seed: Somatic Vocal Healing (SVH) catalogue + one example workshop.
-- Prices are the per-unit seed values from the build spec (ticket / bump).
-- ───────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO workshop_products (slug, name, type, tax_code) VALUES
  ('svh-ticket',  'Somatic Vocal Healing Workshop', 'ticket', 'eservice'),
  ('asj-bump',    'A Sound Journey (recording)',    'bump',   'eservice'),
  ('12w-course',  'Somatic Vocal Healing — 12-Week Course', 'course', 'eservice'),
  ('cert-course', 'SVH Certification Course',        'course', 'eservice');

-- Ticket price points.
INSERT OR IGNORE INTO workshop_product_prices (product_id, currency, amount_minor)
SELECT id, c.cur, c.amt FROM workshop_products,
  (SELECT 'EUR' AS cur, 600 AS amt UNION ALL SELECT 'USD',600 UNION ALL SELECT 'CAD',900
   UNION ALL SELECT 'GBP',500 UNION ALL SELECT 'CHF',600 UNION ALL SELECT 'NOK',6900
   UNION ALL SELECT 'SEK',6900 UNION ALL SELECT 'DKK',4500 UNION ALL SELECT 'AUD',900
   UNION ALL SELECT 'NZD',1100) c
WHERE workshop_products.slug = 'svh-ticket';

-- Bump price points.
INSERT OR IGNORE INTO workshop_product_prices (product_id, currency, amount_minor)
SELECT id, c.cur, c.amt FROM workshop_products,
  (SELECT 'EUR' AS cur, 1900 AS amt UNION ALL SELECT 'USD',1900 UNION ALL SELECT 'CAD',2800
   UNION ALL SELECT 'GBP',1600 UNION ALL SELECT 'CHF',1800 UNION ALL SELECT 'NOK',19900
   UNION ALL SELECT 'SEK',19900 UNION ALL SELECT 'DKK',13900 UNION ALL SELECT 'AUD',2800
   UNION ALL SELECT 'NZD',3200) c
WHERE workshop_products.slug = 'asj-bump';

-- Default Zoom link placeholder — edit in /admin/workshops or via wrangler.
INSERT OR IGNORE INTO workshop_config (key, value) VALUES
  ('zoom_url_default', 'https://us02web.zoom.us/j/00000000000');

-- One example workshop so /w/svh works out of the box. Draft by default —
-- publish it from /admin/workshops once the date and Zoom link are right.
INSERT OR IGNORE INTO workshops
  (slug, title, teacher, starts_at_utc, ends_at_utc, display_tz, main_product_id, bump_product_id,
   source_tag, status, is_replay)
SELECT
  'svh',
  'Somatic Vocal Healing Workshop',
  'Jacob',
  '2026-06-15T18:00:00Z',
  '2026-06-15T19:00:00Z',
  'Europe/Brussels',
  (SELECT id FROM workshop_products WHERE slug = 'svh-ticket'),
  (SELECT id FROM workshop_products WHERE slug = 'asj-bump'),
  'svh_workshop_live',
  'draft',
  0;
