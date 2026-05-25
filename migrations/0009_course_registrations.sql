-- Lightweight registrations table for digital courses (SVH Certification, etc.).
-- Intentionally separate from the `registrations` table so the retreat flow
-- stays untouched: no rooms, no tiers, no VAT/company fields, no inventory.
--
-- Tag/activation logic lives in src/lib/courses/paid-handler.ts. The Stripe
-- webhook routes by metadata.course_registration_id (course) vs
-- metadata.registration_id (retreat).

CREATE TABLE course_registrations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  email                 TEXT NOT NULL,
  first_name            TEXT,
  last_name             TEXT,
  country               TEXT,
  phone                 TEXT,
  phone_country         TEXT,
  product_slug          TEXT NOT NULL,            -- 'cc-cert' | 'cc-bundle'
  activate_choice       TEXT,                     -- 'now' | 'wait' | NULL
  source_variant        TEXT,                     -- 'B1' | 'B2' | 'A' | 'D' | 'E' | 'direct'
  amount_cents          INTEGER NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'EUR',
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','paid','cancelled','refunded','expired')),
  stripe_session_id     TEXT UNIQUE,
  stripe_payment_intent TEXT UNIQUE,
  consent_terms         INTEGER NOT NULL DEFAULT 0,
  consent_at            TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at               TEXT
);

CREATE INDEX idx_course_registrations_email   ON course_registrations(email);
CREATE INDEX idx_course_registrations_status  ON course_registrations(status);
CREATE INDEX idx_course_registrations_session ON course_registrations(stripe_session_id);
