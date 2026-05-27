-- Idempotent bootstrap for wrangler's d1_migrations tracking table.
--
-- Migrations 0001-0015 were applied to the production `songdance` D1 by
-- hand (via the Cloudflare dashboard console) before the
-- `.github/workflows/d1-migrate.yml` workflow existed. Wrangler doesn't
-- know about those, so without this bootstrap a fresh
-- `wrangler d1 migrations apply` would attempt to re-run them and fail
-- on "table already exists" errors.
--
-- This file is safe to run repeatedly:
--   • CREATE TABLE IF NOT EXISTS — no-op if wrangler already made it.
--   • INSERT OR IGNORE — relies on the UNIQUE constraint on `name`,
--     so re-runs add nothing.
--
-- Only the historical hand-applied migrations are listed here. 0016 and
-- every later migration is intentionally absent so `wrangler d1
-- migrations apply` picks them up the normal way.
--
-- The table schema must match what wrangler creates internally; keep
-- the columns and defaults aligned with the wrangler source.

CREATE TABLE IF NOT EXISTS d1_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ('0001_init.sql'),
  ('0002_seed_ritual_of_belonging.sql'),
  ('0003_extend_registrations.sql'),
  ('0004_room_type_catalog.sql'),
  ('0005_smart_room_model.sql'),
  ('0006_special_roles.sql'),
  ('0007_product_rename.sql'),
  ('0008_admin_test_tier.sql'),
  ('0009_course_registrations.sql'),
  ('0010_close_psb_open_theaterkamer.sql'),
  ('0011_activate_extra_rooms.sql'),
  ('0012_course_payment_plans.sql'),
  ('0012_room_2_1_solo_cook.sql'),
  ('0013_room_forced_mode.sql'),
  ('0014_course_company_vat.sql'),
  ('0015_rename_tiers_twin_and_shared.sql');
