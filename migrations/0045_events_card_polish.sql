-- Two small grid-card polish fixes (table `calendar_events`). Grid rows only;
-- the dedicated landing pages are left untouched. Idempotent UPDATEs by id,
-- safe to re-run like the event-grid migrations before it.

-- 1. 12-Week Course card title wrapped mid-word ("…— 12-" / "Week Course")
--    because the hyphen in "12-Week" is a line-break opportunity. Swap it for a
--    non-breaking hyphen (U+2011) so "12‑Week" stays whole and falls to the next
--    line as a unit: "Somatic Vocal Healing —" / "12‑Week Course".
UPDATE calendar_events
   SET title = 'Somatic Vocal Healing — 12‑Week Course', updated_at = datetime('now')
 WHERE id = 'svh-12-week';

-- 2. Ritual of Belonging card blurb was thin and named a caterer (Muriel).
--    Replace it with on-voice copy pulled from the landing page (RBOpening) —
--    no caterer, no outcome promise.
UPDATE calendar_events
   SET summary = 'Three days in a quiet château in the Ardennes — sounding together, sitting in circle, remembering that belonging is something we return to.',
       updated_at = datetime('now')
 WHERE id = 'ritual-of-belonging-2026-11';
