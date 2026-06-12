-- Unguessable per-registration access token for the user-facing links
-- (success / join / ics / replay). Replaces the sequential row `id` (`rid`),
-- which was enumerable in URLs: anyone could increment it to view another
-- registrant's countdown page or, inside the live join window, claim their
-- attendance and reveal the Zoom details. The token is a random 128-bit hex
-- string — there is nothing to guess.
--
-- Backfill every existing row so no live registration is left without a token;
-- new rows get one from the app on insert. The UNIQUE index both enforces
-- distinctness and gives the lookup-by-token an index to ride on.
ALTER TABLE workshop_registrations ADD COLUMN access_token TEXT;

UPDATE workshop_registrations
   SET access_token = lower(hex(randomblob(16)))
 WHERE access_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wreg_access_token
  ON workshop_registrations(access_token);
