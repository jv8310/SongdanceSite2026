-- Reads of the events log by kind: the live pass box on /admin/stats
-- (src/lib/courses/live-pass-stats.ts) reads the monthly's cancel / resume /
-- stop events on every page load, and the Stripe audit counts webhook events by
-- kind. Without an index each of those scans the whole log.
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
