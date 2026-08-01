-- The 12-week counter — "which week am I in?" as a real field on a person.
--
-- Until now the week a student was in lived only in Drip, as the `prod_SVH_week`
-- custom field driven by an automation there. Nothing on the site knew it: the
-- certification page read the field (variant.ts) but could never set it beyond a
-- one-off flip, the admin person page couldn't show it, and /access couldn't act
-- on it. This table makes the site the owner of that fact.
--
-- One row per email — the counter is a property of the person, not of an order:
--   • state 'twelve_week'  — the clock is running. The week is DERIVED from
--     started_at (week 1 = days 0-6, week 12 = days 77-83, day 84+ = ended), so
--     it is always true without anything having to tick it forward.
--   • state 'certification' — the person moved onto the certification course
--     (bought the path and chose "Activate now", or activated early from
--     /access). The field then reads "Ongoing Certification" and stops counting.
--
-- `drip_value` / `drip_synced_at` record what we last pushed to Drip's
-- `prod_SVH_week`, so the hourly sweep (src/lib/courses/week-sync.ts) only
-- writes when the value actually changes — one push per person per week, not
-- one per tick.

CREATE TABLE IF NOT EXISTS course_week_progress (
  email                   TEXT PRIMARY KEY,
  -- The moment the 12-week course started for this person (their payment).
  -- UTC, 'YYYY-MM-DD HH:MM:SS'.
  started_at              TEXT NOT NULL,
  state                   TEXT NOT NULL DEFAULT 'twelve_week'
                            CHECK (state IN ('twelve_week','certification')),
  -- When they moved onto the certification course (state = 'certification').
  cert_activated_at       TEXT,
  -- How that happened: 'purchase' (bought the path, chose Activate now) or
  -- 'access-page' (activated early themselves) or 'admin'.
  cert_activated_source   TEXT,
  -- The order that started the clock — for tracing a row back to its purchase.
  course_registration_id  INTEGER,
  product_slug            TEXT,
  -- Last value written to Drip's prod_SVH_week, and when.
  drip_value              TEXT,
  drip_synced_at          TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The sweep scans by sync recency; the admin person page reads by email (PK).
CREATE INDEX IF NOT EXISTS idx_course_week_progress_sync
  ON course_week_progress (state, drip_synced_at);

-- ── Backfill from the orders we already have ────────────────────────────────
--
-- Every paid registration that carries the 12-week course starts a clock from
-- its payment date; the EARLIEST such order per email wins (a later cert-path
-- purchase must not restart someone who is already walking the foundation).
INSERT OR IGNORE INTO course_week_progress
  (email, started_at, state, course_registration_id, product_slug,
   drip_value, drip_synced_at)
SELECT
  LOWER(TRIM(cr.email)),
  COALESCE(cr.paid_at, cr.created_at),
  'twelve_week',
  cr.id,
  cr.product_slug,
  -- Mark the backfilled rows as already-synced at their CURRENT value, so the
  -- sweep never retro-writes a value into Drip for history (which could fire a
  -- Drip automation for hundreds of past buyers). They start pushing only when
  -- the week genuinely turns over from here on — which for anyone past the 12
  -- weeks is never.
  CASE
    WHEN julianday('now') >= julianday(COALESCE(cr.paid_at, cr.created_at)) + 84
      THEN 'Ended since ' || DATE(COALESCE(cr.paid_at, cr.created_at), '+84 days')
    ELSE CAST(
      CAST((julianday('now') - julianday(COALESCE(cr.paid_at, cr.created_at))) / 7 AS INTEGER) + 1
      AS TEXT)
  END,
  datetime('now')
FROM course_registrations cr
WHERE cr.status = 'paid'
  AND cr.product_slug IN ('svh-12week','cc-bundle')
  AND COALESCE(cr.paid_at, cr.created_at) IS NOT NULL
  AND cr.id = (
    SELECT MIN(c2.id) FROM course_registrations c2
     WHERE LOWER(TRIM(c2.email)) = LOWER(TRIM(cr.email))
       AND c2.status = 'paid'
       AND c2.product_slug IN ('svh-12week','cc-bundle')
  );

-- Anyone who bought the certification and took it immediately ("Activate now",
-- or a cert-only order where the choice was never offered) reads as ongoing
-- certification instead of a week number — including the path buyers the
-- statement above just inserted, hence the UPDATE rather than a second INSERT.
UPDATE course_week_progress
   SET state = 'certification',
       cert_activated_at = COALESCE(cert_activated_at, (
         SELECT COALESCE(cr.paid_at, cr.created_at) FROM course_registrations cr
          WHERE LOWER(TRIM(cr.email)) = course_week_progress.email
            AND cr.status = 'paid'
            AND cr.product_slug IN ('cc-cert','cc-bundle')
            AND COALESCE(cr.activate_choice, 'now') <> 'wait'
          ORDER BY cr.id LIMIT 1)),
       cert_activated_source = COALESCE(cert_activated_source, 'purchase'),
       drip_value = 'Ongoing Certification',
       drip_synced_at = datetime('now'),
       updated_at = datetime('now')
 WHERE EXISTS (
   SELECT 1 FROM course_registrations cr
    WHERE LOWER(TRIM(cr.email)) = course_week_progress.email
      AND cr.status = 'paid'
      AND cr.product_slug IN ('cc-cert','cc-bundle')
      AND COALESCE(cr.activate_choice, 'now') <> 'wait'
 );

INSERT OR IGNORE INTO course_week_progress
  (email, started_at, state, cert_activated_at, cert_activated_source,
   course_registration_id, product_slug, drip_value, drip_synced_at)
SELECT
  LOWER(TRIM(cr.email)),
  COALESCE(cr.paid_at, cr.created_at),
  'certification',
  COALESCE(cr.paid_at, cr.created_at),
  'purchase',
  cr.id,
  cr.product_slug,
  'Ongoing Certification',
  datetime('now')
FROM course_registrations cr
WHERE cr.status = 'paid'
  AND cr.product_slug = 'cc-cert'
  AND COALESCE(cr.activate_choice, 'now') <> 'wait'
  AND COALESCE(cr.paid_at, cr.created_at) IS NOT NULL;
