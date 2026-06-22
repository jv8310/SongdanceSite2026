-- Two operational additions to `broadcasts`, both serving "I cleaned the list,
-- now let me actually resume" (see src/lib/broadcasts/cron.ts + the broadcast
-- detail page):
--
--   breaker_baseline_at — the moment the owner last (re)launched or resumed a
--     broadcast. The cron's circuit breaker now evaluates complaint/bounce rates
--     only over sends made SINCE this instant, not over all history. Without it,
--     a list that once crossed the threshold stayed tripped forever: every
--     Resume flipped status to 'sending', then the next cron tick re-read the
--     unchanged cumulative rate and auto-paused again. Resetting the baseline on
--     each manual resume gives the cleaned queue a fresh sample to prove itself.
--
--   last_cleaned_at — when the pending queue was last scrubbed (dead domains or
--     by tag), surfaced on the broadcast page so "did I already clean this?" is
--     answerable at a glance.
ALTER TABLE broadcasts ADD COLUMN breaker_baseline_at TEXT;
ALTER TABLE broadcasts ADD COLUMN last_cleaned_at TEXT;
