-- The sale sequence now starts today (Monday 13 July), so the Sunday 12 July
-- heads-up (seeded by 0065) is no longer needed. Remove that one draft; the
-- 13 / 14 / 15-AM / 15-PM emails stand (one per day + two on the last day).
-- Both statements are guarded on status='draft' so a launched/sent broadcast is
-- never touched, and both are idempotent.

DELETE FROM broadcasts
WHERE name = 'Sale · 12 Jul — heads-up (3 days left): the whole sale in one practical note'
  AND status = 'draft';

-- The final email is now 4-of-4, not 5-of-5 (internal label only).
UPDATE broadcasts
SET name = 'Sale · 15 Jul PM — final hours, closes at midnight (email 4 of 4)'
WHERE name = 'Sale · 15 Jul PM — final hours, closes at midnight (email 5 of 5)'
  AND status = 'draft';
