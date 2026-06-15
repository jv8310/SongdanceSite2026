-- Distinguish a notification we actually EMAILED from one we only CLAIMED to
-- suppress a duplicate.
--
-- The reminder cadence (src/lib/workshops/cron.ts) sends only the single
-- tightest-due reminder per registrant, but it also *claims* every looser
-- bucket so a late registrant who crosses several at once doesn't get a burst
-- of back-dated reminders. Those claim-only rows live in the same table as
-- real sends, which made the admin People view over-count "emails received"
-- (e.g. a person who registered minutes before the session showed all seven
-- reminder rows though only one was emailed).
--
-- `emailed = 1` (the default, so every existing row is treated as sent) means
-- an email actually went out; the cron now writes `emailed = 0` for the
-- looser buckets it only reserves. The People view counts emailed = 1 only.
--
-- NB: historical claim-only rows can't be reclassified after the fact (a
-- suppressed claim and the real send share a timestamp), so they keep the
-- default 1. The count is exact for everything sent from here on.

ALTER TABLE workshop_sent_notifications
  ADD COLUMN emailed INTEGER NOT NULL DEFAULT 1;
