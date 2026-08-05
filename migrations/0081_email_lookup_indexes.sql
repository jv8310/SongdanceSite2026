-- Case-insensitive email lookups: give them an index to sit on.
--
-- Email is the join key across this whole system (the lifecycle cron, the
-- ownership checks, the bump/album entitlement reads, the People page), and
-- almost every one of those lookups is written case-insensitively:
--
--     WHERE lower(email) = lower(?)
--
-- That is correct, and it is also unindexable against the plain-column indexes
-- we have (idx_contact_tags_email, idx_wreg_email, idx_course_registrations_email
-- are all on `email`, not on `lower(email)`). SQLite cannot prove the two are
-- interchangeable, so it stops using the index and falls back to a FULL TABLE
-- SCAN — every call, on the largest tables in the database.
--
-- That is what put D1 "Rows Read" into the billions per day. The 5-minute cron's
-- post-workshop sweep runs five of these lookups per attendee (hasBought12w,
-- hasBoughtCert, dripTagsForEmail, paidProductSlugs), and `dripTagsForEmail`
-- scans contact_tags — the 55k-contact marketing list, several tags per
-- contact. A hundred attendees inside a live downsell window × a few hundred
-- thousand rows scanned each × 288 ticks a day is tens of billions of rows.
--
-- SQLite supports indexes on deterministic expressions, and `lower()` is one, so
-- the fix needs no query changes at all: index the expression the queries
-- actually ask for and the planner picks it up. Behaviour is identical — this is
-- purely a lookup path. (Deliberately an expression index rather than stripping
-- the lower() calls: registration emails are stored as the buyer typed them, so
-- a raw `email = ?` comparison would silently start missing rows.)
--
-- Paired with the cron fix in src/lib/workshops/cron.ts, which asks the cheap
-- "already sent?" question BEFORE these lookups instead of after.

-- The marketing list's normalized tags — read once per attendee per tick by
-- dripTagsForEmail (workshops/cron.ts). The biggest of these tables, and the
-- single largest contributor to the row-read bill.
CREATE INDEX IF NOT EXISTS idx_contact_tags_email_lower
  ON contact_tags(lower(email));

-- Course purchases by email: hasCoursePurchase / paidProductSlugs in the cron,
-- the abandoned-checkout guard, and the album entitlement check
-- (music/product.ts).
CREATE INDEX IF NOT EXISTS idx_course_registrations_email_lower
  ON course_registrations(lower(email));

-- Workshop registrations by email — the join side of the three-way ownership
-- queries (workshop_purchases ⋈ workshop_registrations ⋈ workshop_products) in
-- the cron, plus workshops/db.ts, workshops/bump.ts (workshopBumpTagsForEmail,
-- which gates music-album access), mantra-pack.ts and orders/notification.ts.
CREATE INDEX IF NOT EXISTS idx_wreg_email_lower
  ON workshop_registrations(lower(email));

-- Every tracked send to one address (emailSendsForAddress, the People detail
-- page). email_sends grows by one row per email sent — the fastest-growing
-- table here once broadcasts run — and had no index on the recipient at all.
CREATE INDEX IF NOT EXISTS idx_email_sends_to_email_lower
  ON email_sends(lower(to_email));
