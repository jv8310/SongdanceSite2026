-- The live pass (src/lib/courses/live-pass.ts): the weekly Q&As and the monthly
-- deepening session, bought for 1, 3 or 6 months (product slugs live-pass-1m /
-- -3m / -6m on course_registrations, the certification-window add-on a
-- `cert-extension` row in `bumps`).
--
-- A pass starts the day it is bought, or the day after the buyer's current live
-- sessions end, so the period is a fact of the sale rather than something to
-- re-derive: it is written here when the payment lands, as the UTC instants that
-- bound the Brussels days ('YYYY-MM-DD HH:MM:SS', like every other stamp here).
-- The member app reads these two columns to open the sessions for exactly that
-- period. NULL on every other order; a pass paid before this migration falls
-- back to its paid day.
ALTER TABLE course_registrations ADD COLUMN access_starts_at TEXT;
ALTER TABLE course_registrations ADD COLUMN access_ends_at TEXT;
