-- One-shot: move every secured seat from the 4th Somatic Vocal Healing
-- Masterclass onto the 5th, and email each person that their seat has moved.
--
--   from  workshops.slug = 'somatic-vocal-healing-masterclass-4'
--   to    workshops.slug = 'somatic-vocal-healing-masterclass-5'
--
-- WHY A QUEUE + DRAIN (not a bare UPDATE): the move is only half the job —
-- each moved person must also receive the "your place has moved, same seat,
-- new day" note, and a SQL migration can't send email. So, exactly like the
-- Drip order backfill (0057 → src/lib/orders/drip-backfill.ts), this migration
-- only SEEDS a work queue; the Worker-side cron drain
-- (src/lib/workshops/masterclass-move.ts) does the actual move
-- (moveRegistrationToWorkshop) + the date-changed email, one registration at a
-- time, idempotently, and self-stops once the queue is empty.
--
-- GATED: the drain does nothing until MASTERCLASS_MOVE_ENABLED is flipped to
-- "1"/"true" (wrangler.jsonc var, default "false"), so merging/deploying this
-- never moves anyone or emails anyone on its own — the owner opts in
-- deliberately once masterclass-5's date is final, then flips it back to
-- "false" (or leaves it — the queue drains once and every later tick is a
-- no-op).
--
-- WHO IS MOVED: only SECURED seats (payment_status 'paid' or 'coupon') on
-- masterclass-4 — the same bar the on-site "move me to another date" flow uses.
-- Abandoned/unpaid ('prepared', etc.) rows are left alone: they never had a
-- seat, so there's nothing to move and no "your seat moved" note to send.
--
-- Anyone who ALREADY holds a seat on masterclass-5 is skipped (they keep their
-- one seat; nothing to move, nothing to email), which also sidesteps the
-- workshop_registrations UNIQUE(workshop_id, email) collision.
--
-- SAFE NO-OP if either slug is absent (typo, not created yet, soft-deleted):
-- the slug subqueries resolve to NULL, the guard drops the whole INSERT, and
-- zero rows are queued — nothing happens until the slugs actually exist.
--
-- Runs once (wrangler d1 migrations apply), so the seed captures exactly the
-- secured seats on masterclass-4 at apply time.

CREATE TABLE IF NOT EXISTS masterclass_seat_move (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id     INTEGER NOT NULL UNIQUE REFERENCES workshop_registrations(id),
  source_workshop_id  INTEGER NOT NULL,
  target_workshop_id  INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',  -- pending | moving | done | skipped | failed
  attempts            INTEGER NOT NULL DEFAULT 0,
  error               TEXT,
  claimed_at          TEXT,
  done_at             TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_masterclass_seat_move_status
  ON masterclass_seat_move(status);

-- Seed one row per secured seat on masterclass-4 that isn't already on
-- masterclass-5. Slugs are resolved to ids inline (deleted = 0), and the whole
-- INSERT is guarded so nothing queues unless BOTH workshops exist.
INSERT OR IGNORE INTO masterclass_seat_move
  (registration_id, source_workshop_id, target_workshop_id)
  SELECT
    r.id,
    (SELECT id FROM workshops WHERE slug = 'somatic-vocal-healing-masterclass-4' AND deleted = 0),
    (SELECT id FROM workshops WHERE slug = 'somatic-vocal-healing-masterclass-5' AND deleted = 0)
  FROM workshop_registrations r
  WHERE r.workshop_id = (SELECT id FROM workshops WHERE slug = 'somatic-vocal-healing-masterclass-4' AND deleted = 0)
    AND r.payment_status IN ('paid', 'coupon')
    AND (SELECT id FROM workshops WHERE slug = 'somatic-vocal-healing-masterclass-4' AND deleted = 0) IS NOT NULL
    AND (SELECT id FROM workshops WHERE slug = 'somatic-vocal-healing-masterclass-5' AND deleted = 0) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM workshop_registrations t
       WHERE t.workshop_id = (SELECT id FROM workshops WHERE slug = 'somatic-vocal-healing-masterclass-5' AND deleted = 0)
         AND lower(t.email) = lower(r.email)
    );
