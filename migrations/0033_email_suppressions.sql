-- Unsubscribe / suppression list for lifecycle marketing emails.
--
-- Any address in this table stops receiving the marketing-flavoured workshop
-- emails (abandoned checkout, post-workshop course promotion, downsell).
-- Transactional service email — verification codes, registration
-- confirmations, session reminders — is NOT affected: people keep getting
-- what they paid for.
--
-- Rows are written by /unsubscribe (the confirm page) and /api/unsubscribe
-- (the RFC 8058 one-click POST target referenced from the List-Unsubscribe
-- header). Emails are stored lowercased.

CREATE TABLE IF NOT EXISTS email_suppressions (
  email      TEXT PRIMARY KEY,                       -- lowercased
  reason     TEXT NOT NULL DEFAULT 'unsubscribe',
  source     TEXT,                                   -- 'link' | 'one_click' | 'admin'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
