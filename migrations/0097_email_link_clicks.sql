-- Clicks per link: every link click Resend reports on a BROADCAST
-- (email.clicked → data.click), one row per event. The broadcast page groups
-- them per link (src/components/admin/BroadcastLinkClicks.astro); the segment
-- builder's "clicked a link containing …" reads them.
--
-- Only broadcasts (email_sends.email_type GLOB 'broadcast_*') are recorded:
-- transactional mail carries live credentials in its links. URLs are normalised
-- before they are stored (src/lib/email/link-clicks.ts): only an allowlist of
-- query parameters survives (utm_*, discount, adiscount, installment, months,
-- extend, friend, rc, ref), so the reader's address, the unsubscribe token and
-- every other per-reader parameter never land here. The IP address Resend sends
-- is never stored.
CREATE TABLE IF NOT EXISTS email_link_clicks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT UNIQUE,                      -- Svix message id: a retried delivery inserts nothing
  resend_id   TEXT NOT NULL,                    -- email_sends.resend_id (the join key)
  email_type  TEXT,                             -- copied from email_sends ('broadcast_<id>')
  to_email    TEXT,                             -- lowercased, copied from email_sends
  url         TEXT NOT NULL,                    -- normalised destination
  link_kind   TEXT NOT NULL DEFAULT 'content',  -- content | unsubscribe | preferences
  clicked_at  TEXT NOT NULL,                    -- ISO-8601 UTC (data.click.timestamp)
  user_agent  TEXT,                             -- first 300 chars
  likely_bot  INTEGER NOT NULL DEFAULT 0,
  bot_reason  TEXT,                             -- fast | scanner-ua | no-ua
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_link_clicks_resend   ON email_link_clicks(resend_id);
CREATE INDEX IF NOT EXISTS idx_link_clicks_type_url ON email_link_clicks(email_type, url);
CREATE INDEX IF NOT EXISTS idx_link_clicks_to       ON email_link_clicks(to_email);
