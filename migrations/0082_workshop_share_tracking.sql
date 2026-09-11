-- "Share this workshop with a friend" — measure what it actually does.
--
-- The countdown page (/workshop/success) offers every paid registrant a
-- half-price link to pass on. Until now that link carried nothing that
-- identified the sharer, so the whole funnel was invisible: we could not say
-- how many people shared, how many friends opened a link, or whether a single
-- registration ever came back from one.
--
-- The link now carries ?ref=<id>.<sig> (an HMAC-signed sharer id — see
-- src/lib/workshops/share.ts; signed so nobody can credit a referral to a
-- stranger) plus ?rc=<channel>, and the four steps of the funnel are recorded
-- here as one row per step:
--
--   view   the share panel was rendered for that registrant (once, ever —
--          the partial unique index below makes a reload a no-op)
--   share  they pressed a share button (copy / whatsapp / facebook /
--          telegram / email / native) — every press, so both the total and
--          the number of distinct sharers are countable
--   visit  a friend opened a shared link (first landing per browser; a
--          reload carries the cookie and is not recounted, and link-preview
--          crawlers are filtered by user agent)
--
-- The fourth step — the friend registering — is attributed on the
-- registration itself, so it joins straight to payment status and revenue.

CREATE TABLE IF NOT EXISTS workshop_share_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT NOT NULL CHECK (kind IN ('view','share','visit')),
  channel         TEXT,                                             -- share/visit: copy|whatsapp|facebook|telegram|email|native|link
  registration_id INTEGER REFERENCES workshop_registrations(id) ON DELETE CASCADE,  -- the SHARER, always
  workshop_id     INTEGER REFERENCES workshops(id),                 -- the session they were sharing
  path            TEXT,                                             -- visit: where the link landed
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_share_events_kind_created
  ON workshop_share_events(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_share_events_registration
  ON workshop_share_events(registration_id);

-- One 'view' per registrant, ever: the countdown page is reloaded constantly
-- (it is where people wait for the join button), so INSERT OR IGNORE against
-- this index is what keeps "people shown the share panel" a headcount.
CREATE UNIQUE INDEX IF NOT EXISTS idx_share_events_view_once
  ON workshop_share_events(registration_id) WHERE kind = 'view';

-- The conversion end of the funnel: which registration came from whose link,
-- and through which channel. Set once, at checkout, from the sd_ref cookie.
ALTER TABLE workshop_registrations ADD COLUMN referred_by_id INTEGER;
ALTER TABLE workshop_registrations ADD COLUMN referral_channel TEXT;

CREATE INDEX IF NOT EXISTS idx_wreg_referred_by
  ON workshop_registrations(referred_by_id) WHERE referred_by_id IS NOT NULL;
