-- Backfill: mirror every PAST order's Drip tags onto the local People/contacts
-- list (the `contacts` + `contact_tags` tables), so a tag applied to a buyer at
-- purchase time is searchable on the broadcast compose page, targetable in an
-- audience, and shown on the People detail page — not living only in Drip.
--
-- The gap this closes: the order paid-handlers push tags to Drip
-- (upsertSubscriber), but the contacts list was a one-off CSV import from a Drip
-- export — frozen at import time. Every order since only updated Drip, so its
-- tags (e.g. a workshop's source_tag) never appeared locally. Going forward the
-- live handlers now mirror on every order (src/lib/contacts/mirror.ts); this
-- brings the HISTORY across.
--
-- Why a queue + cron drain (not pure SQL): the exact tag set per order is
-- nuanced TypeScript — workshop source_tag / audience lenses / bump product tag;
-- course product→tag maps incl. the journeys' Dutch-edition swaps + order bumps;
-- retreat product tag. The drain (src/lib/contacts/tag-backfill.ts) recomputes
-- each order's tags with the SAME builders the live handlers use, so backfilled
-- and live tags can never drift. Idempotent: the contact upsert only fills
-- missing fields (COALESCE) and tags are INSERT OR IGNORE on the (email, tag)
-- primary key, so a row re-run — or a row also touched by the live path — adds
-- nothing new and can't double-count.
--
-- Unlike the Drip-order backfill (0057), this writes ONLY to our own D1 (no
-- external API, no automations), so it is NOT gated behind an env switch: it
-- drains automatically on the existing 5-minute cron and self-stops the moment
-- the queue is empty. This migration runs once, so the seed captures exactly the
-- purchases that exist at apply time; everything after flows through the live
-- mirror.

-- One row per past paid purchase, drained into contacts/contact_tags.
CREATE TABLE IF NOT EXISTS contact_tag_backfill (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_type  TEXT NOT NULL,                       -- 'retreat' | 'course' | 'workshop'
  source_id   INTEGER NOT NULL,                    -- row id in the source table
  email       TEXT NOT NULL,                       -- informational; the drain re-reads the source row
  status      TEXT NOT NULL DEFAULT 'pending',     -- pending | sending | done | failed
  attempts    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  claimed_at  TEXT,
  done_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(order_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_contact_tag_backfill_status
  ON contact_tag_backfill(status);

-- Seed: the same "did this ever transact" definitions the Drip-order backfill
-- (0057) uses, so both backfills cover exactly the same set of purchases.

-- Retreats that ever paid (paid_at set, including later-refunded rows — they did
-- transact and were tagged).
INSERT OR IGNORE INTO contact_tag_backfill (order_type, source_id, email)
  SELECT 'retreat', id, lower(email)
    FROM registrations
   WHERE paid_at IS NOT NULL;

-- Course registrations that ever collected money (paid_at set, not a
-- pending/expired session). Includes free comps (amount 0) — they were tagged.
INSERT OR IGNORE INTO contact_tag_backfill (order_type, source_id, email)
  SELECT 'course', id, lower(email)
    FROM course_registrations
   WHERE paid_at IS NOT NULL
     AND status NOT IN ('pending', 'expired');

-- Workshop registrations that completed (paid or coupon-free) — the paths that
-- run runWorkshopPaidSideEffects and therefore tag in Drip.
INSERT OR IGNORE INTO contact_tag_backfill (order_type, source_id, email)
  SELECT 'workshop', id, lower(email)
    FROM workshop_registrations
   WHERE payment_status IN ('paid', 'coupon');
