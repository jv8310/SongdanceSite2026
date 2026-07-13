-- Backfill: give every PAST site buyer a single `in-drip` marker tag on the
-- local People/contacts list, so a broadcast can exclude them and never
-- double-send to people Drip already mails.
--
-- The problem this solves (owner, July 2026): the contacts list was a one-off CSV
-- import from a Drip export, and those people were then REMOVED from Drip — so
-- mailing them from the new broadcast system is safe. But everyone who buys on
-- the site is pushed to Drip by the paid-handlers (upsertSubscriber + recordOrder)
-- AND mirrored into contacts (src/lib/contacts/mirror.ts). So buyers sit in BOTH
-- lists: mail them from both systems and they get the email twice.
--
-- The existing product tags (prod_svh_12w, product:<slug>, svh_audience_*, …)
-- can't be used to tell "in Drip now" apart, precisely because the CSV came FROM
-- Drip: a contact can already carry prod_svh_12w from an old purchase even though
-- they've since been removed from Drip. So we introduce ONE dedicated tag,
-- `in-drip` (IN_DRIP_TAG in src/lib/contacts/mirror.ts), written ONLY by the
-- purchase mirror — a value a pure CSV row can never carry. Put it in a
-- broadcast's "exclude tags" and buyers drop out (Drip keeps mailing them); the
-- CSV cohort, which lacks it, still gets the new-system send. Nobody twice.
--
-- Going forward the live mirror stamps `in-drip` on every purchase; this brings
-- the HISTORY across. Buyer definitions are identical to the contact-tag backfill
-- (0068) and the Drip-order backfill (0057), so `in-drip` marks exactly the set
-- of purchases that were ever pushed to Drip.
--
-- Local-only (writes just contact_tags + the denormalized contacts.tags display
-- column) — no external API, no Drip automation — and idempotent (INSERT OR
-- IGNORE on the (email, tag) primary key), so re-applying is a no-op. Gated to
-- emails that already exist in `contacts`: a buyer not yet in the list can't be in
-- a broadcast anyway, and gets `in-drip` the moment the live mirror (or a still-
-- draining 0068 row, which also stamps it now) creates their contact row.

-- Retreats that ever paid (paid_at set, including later-refunded rows — they did
-- transact and were pushed to Drip).
INSERT OR IGNORE INTO contact_tags (email, tag)
  SELECT DISTINCT lower(email), 'in-drip'
    FROM registrations
   WHERE paid_at IS NOT NULL
     AND lower(email) IN (SELECT email FROM contacts);

-- Course registrations that ever collected money (paid_at set, not a
-- pending/expired session). Includes free comps (amount 0) — they were pushed too.
INSERT OR IGNORE INTO contact_tags (email, tag)
  SELECT DISTINCT lower(email), 'in-drip'
    FROM course_registrations
   WHERE paid_at IS NOT NULL
     AND status NOT IN ('pending', 'expired')
     AND lower(email) IN (SELECT email FROM contacts);

-- Workshop registrations that completed (paid or coupon-free) — the paths that
-- run the paid side-effects and therefore push to Drip.
INSERT OR IGNORE INTO contact_tags (email, tag)
  SELECT DISTINCT lower(email), 'in-drip'
    FROM workshop_registrations
   WHERE payment_status IN ('paid', 'coupon')
     AND lower(email) IN (SELECT email FROM contacts);

-- Resync the denormalized display `tags` column for every contact that now
-- carries `in-drip`, so the People detail view + contact row match the normalized
-- contact_tags table (which is what compose/targeting actually read). Same
-- group_concat(tag, ', ') over ORDER BY tag the live mirror uses, so the string
-- format stays identical.
UPDATE contacts
   SET tags = (
         SELECT group_concat(tag, ', ')
           FROM (SELECT tag FROM contact_tags WHERE email = contacts.email ORDER BY tag)
       ),
       updated_at = datetime('now')
 WHERE email IN (SELECT email FROM contact_tags WHERE tag = 'in-drip');
