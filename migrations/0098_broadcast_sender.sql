-- Sender per broadcast (src/lib/broadcasts/sender.ts). NULL = the default
-- (env MARKETING_FROM / MARKETING_REPLY_TO, i.e. "Jacob from Songdance"
-- <info@m.songdance.co>, replies to support@songdance.co).
--
-- The address is always <from_local>@<the marketing domain>: the domain is not
-- stored, it is read from MARKETING_FROM at send time, so only the verified
-- marketing domain can ever be used. reply_to may be any address.
ALTER TABLE broadcasts ADD COLUMN from_name  TEXT;
ALTER TABLE broadcasts ADD COLUMN from_local TEXT;
ALTER TABLE broadcasts ADD COLUMN reply_to   TEXT;
