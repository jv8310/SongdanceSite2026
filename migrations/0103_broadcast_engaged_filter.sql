-- Broadcast audience: "only people who opened or clicked an email in the last
-- N days". NULL = no such filter. The two partial indexes let the audience
-- count and the launch snapshot find recent opens / clicks without reading
-- every row of email_sends (one row per email ever sent).

ALTER TABLE broadcasts ADD COLUMN audience_engaged_days INTEGER;

CREATE INDEX IF NOT EXISTS idx_email_sends_last_opened
  ON email_sends(last_opened_at) WHERE last_opened_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_sends_last_clicked
  ON email_sends(last_clicked_at) WHERE last_clicked_at IS NOT NULL;
