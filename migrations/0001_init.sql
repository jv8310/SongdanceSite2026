-- Initial schema for Songdance registrations + payments.
-- A "product" is a retreat, course, workshop, or digital good.
-- Tiers are pricing variants within a product (room types, course levels).
-- Inventory units are physical resources (specific rooms / beds) for retreats.

CREATE TABLE products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL CHECK (type IN ('retreat','course','workshop','digital')),
  name          TEXT NOT NULL,
  description   TEXT,
  currency      TEXT NOT NULL DEFAULT 'EUR',
  vat_rate      REAL NOT NULL DEFAULT 0.21,
  starts_at     TEXT,
  ends_at       TEXT,
  drip_tag      TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tiers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  price_cents   INTEGER NOT NULL,
  capacity      INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  UNIQUE (product_id, slug)
);

CREATE TABLE inventory_units (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tier_id       INTEGER NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  capacity      INTEGER NOT NULL DEFAULT 1,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available','reserved','inactive')),
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE registrations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id            INTEGER NOT NULL REFERENCES products(id),
  tier_id               INTEGER NOT NULL REFERENCES tiers(id),
  inventory_unit_id     INTEGER REFERENCES inventory_units(id),
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone                 TEXT,
  country               TEXT,
  roommate_pref         TEXT,
  dietary               TEXT,
  notes                 TEXT,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','paid','cancelled','refunded','waitlist','expired')),
  amount_cents          INTEGER NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'EUR',
  stripe_session_id     TEXT UNIQUE,
  stripe_payment_intent TEXT UNIQUE,
  quaderno_invoice_id   TEXT,
  hold_expires_at       TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at               TEXT,
  cancelled_at          TEXT
);

CREATE INDEX idx_registrations_product ON registrations(product_id);
CREATE INDEX idx_registrations_status  ON registrations(status);
CREATE INDEX idx_registrations_email   ON registrations(email);

-- Audit log: every meaningful state change + webhook receipt.
CREATE TABLE events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER REFERENCES registrations(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'system',
  external_id     TEXT,
  payload_json    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_events_external_id ON events(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_events_registration ON events(registration_id);
