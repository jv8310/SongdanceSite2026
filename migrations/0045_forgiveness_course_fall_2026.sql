-- Events grid update (June 2026). Acts on the GRID row only
-- (table `calendar_events`); the dedicated /courses/forgiveness landing page is
-- updated separately in code.
--
-- The Forgiveness Course is moving to Fall 2026. Clear the old July start date
-- and drop the "Launching July 2026" line from the card summary so that — if
-- the card is ever re-published from /admin/events (it has been hidden since
-- 0030) — it no longer shows a stale date. `published` is intentionally left
-- as-is; this only corrects the date copy.
--
-- Idempotent UPDATE by id, safe to re-run like the event-grid migrations
-- before it.

UPDATE calendar_events
   SET start_date = NULL,
       summary = 'The work of forgiveness — in layers, for your own freedom. Coming in Fall 2026.',
       updated_at = datetime('now')
 WHERE id = 'forgiveness-course';
