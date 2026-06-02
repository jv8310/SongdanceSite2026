-- Add an explicit "ongoing" flag to events.
--
-- Until now, "no fixed dates" was inferred from a null start_date (rendered as
-- "Start anytime") and an event with a start but no end rendered as a single
-- day. That left no clean way to say "runs from a date, with no end" or
-- "ongoing, join anytime". `ongoing = 1` makes the intent explicit:
--   * the card reads "Ongoing" (no start) or "From <start>" (with a start),
--   * the event never counts as past, regardless of dates.
-- end_date is ignored while ongoing = 1.

ALTER TABLE calendar_events ADD COLUMN ongoing INTEGER NOT NULL DEFAULT 0;
