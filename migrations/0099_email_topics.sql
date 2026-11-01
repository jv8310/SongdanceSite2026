-- Email topics (the three Drip topics), opt-out model: no row = subscribed.
-- A broadcast may name one topic; its audience then leaves out everyone who
-- left that topic, and its footer says which topic it came under
-- (src/lib/email/topics.ts, /email-preferences). email_suppressions stays the
-- global "send nothing" switch. Topics govern broadcasts only: workshop
-- lifecycle mail and course sequences follow email_suppressions alone, and
-- transactional mail ignores both. Opt-outs are not mirrored to Drip.
CREATE TABLE IF NOT EXISTS email_topics (
  key         TEXT PRIMARY KEY,               -- 'svh' | 'events' | 'partners'
  name        TEXT NOT NULL,
  description TEXT,                           -- shown on the preferences page
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO email_topics (key, name, description, sort_order) VALUES
  ('svh',      'Somatic Vocal Healing',       'The practice: sounding, the body, and what we keep learning about both.', 1),
  ('events',   'Retreat, Workshops & Events', 'Live dates: workshops, masterclasses, retreats and gatherings, as they open.', 2),
  ('partners', 'Partner Offerings',           'Now and then, work from people we know and trust.', 3);

CREATE TABLE IF NOT EXISTS email_topic_optouts (
  email      TEXT NOT NULL,                   -- lowercased
  topic      TEXT NOT NULL,                   -- email_topics.key
  source     TEXT,                            -- preferences | one_click | admin:<email> | app:<actor>
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email, topic)
);
CREATE INDEX IF NOT EXISTS idx_topic_optouts_topic ON email_topic_optouts(topic);

ALTER TABLE broadcasts ADD COLUMN topic TEXT;  -- email_topics.key, NULL = no topic
