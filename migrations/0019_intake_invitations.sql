-- Invitation flow for intake retreats.
--
-- People who've already booked + paid for a retreat get a sequence of
-- emails (invitation → reminder → final reminder) pointing them at the
-- intake. Each invitee has a unique URL token that prefills first_name
-- and email and skips those steps on the form. Once they submit (matched
-- by token or by retreat+email), `submitted_at` is filled in and the
-- admin UI hides the send buttons for that row.

ALTER TABLE intake_retreats
  ADD COLUMN invite_locale TEXT NOT NULL DEFAULT 'nl';

CREATE TABLE intake_invitations (
  id                   TEXT PRIMARY KEY,             -- crypto.randomUUID()
  token                TEXT NOT NULL UNIQUE,         -- URL-safe random, lookup key
  retreat_slug         TEXT NOT NULL,                -- matches intake_retreats.slug
  first_name           TEXT,
  email                TEXT NOT NULL,
  invitation_sent_at   TEXT,
  reminder_sent_at     TEXT,
  final_sent_at        TEXT,
  submitted_at         TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (retreat_slug, email)
);

CREATE INDEX idx_intake_invitations_retreat  ON intake_invitations(retreat_slug);
CREATE INDEX idx_intake_invitations_email    ON intake_invitations(email);
CREATE INDEX idx_intake_invitations_token    ON intake_invitations(token);
