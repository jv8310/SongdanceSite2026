-- Intake submissions for retreats.
--
-- Stores the full questionnaire payload + the Claude assessment as a
-- single row. The assessment classification is parsed out into its own
-- column so admin views can filter at a glance ("show all red flags").
--
-- This table is intentionally separate from `registrations` and
-- `course_registrations`: an intake is a pre-screening, not a paid
-- registration, and may be filled in days/weeks before the deelnemer
-- actually checks out.

CREATE TABLE intake_submissions (
  id              TEXT PRIMARY KEY,             -- crypto.randomUUID()
  event_code      TEXT NOT NULL,                -- e.g. 'klankopstellingen2026'
  locale          TEXT NOT NULL CHECK (locale IN ('nl','en')),
  email           TEXT NOT NULL,
  full_name       TEXT,
  payload_json    TEXT NOT NULL,                -- the full answer set
  assessment_md   TEXT,                         -- Claude's markdown output
  classification  TEXT,                         -- VEILIG | NEEDS A CALL | FURTHER INVESTIGATION NEEDED | RED FLAG | NULL on error
  assessment_error TEXT,                        -- non-null when the Claude call failed
  ip              TEXT,
  user_agent      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_intake_submissions_event ON intake_submissions(event_code);
CREATE INDEX idx_intake_submissions_email ON intake_submissions(email);
CREATE INDEX idx_intake_submissions_class ON intake_submissions(classification);
CREATE INDEX idx_intake_submissions_created ON intake_submissions(created_at);
