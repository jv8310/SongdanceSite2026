-- Certification submissions, kept on the site (November 2026).
--
-- Until now a student applied for certification through a Google Form, whose
-- answers landed in a Google Sheet; the review happened by email and "certified"
-- was set from a person's People page. The form is now the site's own page
-- (/certification/apply), every submission is a row here, and Jacob reviews
-- them on /admin/certification (src/lib/certification/).
--
-- status:
--   submitted — in, waiting for Jacob's review
--   response  — Jacob has answered without certifying; `response` holds his
--               words, the student may send the form again (a new row)
--   certified — certified on this submission (the certification itself, the
--               certificate and the feedback live in the member app)
--   archived  — set aside: a submission from the Google Sheet whose outcome
--               was never recorded, a duplicate, a test
--
-- The member app is told where a person's latest submission stands
-- (APP_ADMIN.certApplication), so its certification page says "waiting for
-- review" or shows the response. `app_sync_pending` marks a row whose news the
-- app has not confirmed yet; the hourly cron tries again.
--
-- Rows from the Google Sheet are imported on /admin/certification (paste or
-- CSV). `import_key` (the sheet's timestamp + address) keeps a second import
-- from doubling them.
CREATE TABLE IF NOT EXISTS cert_applications (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  email              TEXT NOT NULL,                       -- lowercased, trimmed
  first_name         TEXT,
  last_name          TEXT,
  classes_confirmed  INTEGER NOT NULL DEFAULT 0,          -- "I have joined all live classes or watched the replays"
  video_url          TEXT,                                -- as typed: a link, sometimes two, sometimes words
  video_uploaded     INTEGER NOT NULL DEFAULT 0,          -- said they sent the file through the upload link
  course_feedback    TEXT,                                -- "Is there any way I could improve this course?"
  testimonial        TEXT,                                -- "I've left a testimonial" / "I'd rather not" / their own words
  comments           TEXT,                                -- "Other comments or questions"
  source             TEXT NOT NULL DEFAULT 'site',        -- 'site' | 'google-form' | 'admin'
  import_key         TEXT,
  submitted_at       TEXT NOT NULL,                       -- ISO instant
  status             TEXT NOT NULL DEFAULT 'submitted',
  response           TEXT,                                -- Jacob's words to the student (the app's plain-text format)
  reviewed_at        TEXT,
  reviewed_by        TEXT,
  admin_note         TEXT,                                -- Jacob's own note, never shown to the student
  received_email_at  TEXT,                                -- "we have your submission"
  outcome_email_at   TEXT,                                -- "you are certified" / "Jacob has responded"
  app_sync_pending   INTEGER NOT NULL DEFAULT 0,
  app_sync_error     TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cert_applications_import ON cert_applications(import_key) WHERE import_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cert_applications_email ON cert_applications(email);
CREATE INDEX IF NOT EXISTS idx_cert_applications_status ON cert_applications(status, submitted_at);
