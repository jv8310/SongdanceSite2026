-- Retreat waiting list — join when full, get offered the place that frees up.
--
-- A sold-out retreat used to be a dead end: the form said "fully booked" and
-- the visitor left. Now they can put their name down, and when a place opens
-- (a cancellation, a room put back on sale) the admin offers it to someone on
-- the list from /admin/retreats/<slug>.
--
-- An offer is a real HOLD, not just an email: while it is live, public
-- availability for that tier is reduced by one (see countActiveOffersByTier in
-- src/lib/registrations/waitlist.ts), so a walk-in can't take the seat that was
-- promised. The invited person books through the ordinary checkout carrying
-- their claim token, which excludes their own hold — so the place is there for
-- them and for nobody else, until the offer expires.
--
-- One row per (retreat, email): re-joining updates that row rather than
-- stacking duplicates. Position on the list is created_at order.

CREATE TABLE IF NOT EXISTS retreat_waitlist (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id        INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- Which room/cabin they'd like. NULL = "anything that comes free".
  tier_id           INTEGER REFERENCES tiers(id),
  first_name        TEXT NOT NULL DEFAULT '',
  last_name         TEXT,
  email             TEXT NOT NULL,
  phone             TEXT,
  phone_country     TEXT,
  country           TEXT,
  -- How many places they're waiting for (1, or 2 for a couple sharing).
  party_size        INTEGER NOT NULL DEFAULT 1,
  notes             TEXT,
  -- 'public' — the join form on the retreat page; 'admin' — added by hand.
  source            TEXT NOT NULL DEFAULT 'public',
  status            TEXT NOT NULL DEFAULT 'waiting'
                      CHECK (status IN ('waiting','invited','booked','declined','expired','removed')),
  -- Live only while status = 'invited': the secret in the claim link.
  claim_token       TEXT,
  -- Which place was offered (may differ from their preference).
  offered_tier_id   INTEGER REFERENCES tiers(id),
  offered_at        TEXT,
  offer_expires_at  TEXT,
  -- How many times a place has been offered to this person.
  offer_count       INTEGER NOT NULL DEFAULT 0,
  -- When they took it, declined it, or the offer ran out.
  responded_at      TEXT,
  -- The booking that came out of the offer, once they start checkout.
  registration_id   INTEGER REFERENCES registrations(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One entry per person per retreat — joining twice updates, never duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_retreat_waitlist_person
  ON retreat_waitlist(product_id, email);

-- The admin list: everyone on a retreat, in join order.
CREATE INDEX IF NOT EXISTS idx_retreat_waitlist_product
  ON retreat_waitlist(product_id, status, created_at);

-- Claim-link lookup. Partial so the many NULLs (everyone not currently
-- holding an offer) don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_retreat_waitlist_token
  ON retreat_waitlist(claim_token) WHERE claim_token IS NOT NULL;
