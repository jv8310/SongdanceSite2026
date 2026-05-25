-- Per-room manual pin for multi-mode rooms.
--
-- A multi-mode room (one with both solo_tier_id and shared_tier_id) is
-- normally 'open' while empty — a booking on either tier can land in
-- it, and the first booking locks the mode. The admin can pre-empt
-- that auto-flip by pinning the room to one mode via this column, so
-- the room is offered only as Private or only as Shared on the public
-- form even before anyone books.
--
--   NULL     — no override; behaves 'open' until first booking.
--   'solo'   — room sells only as solo_tier_id.
--   'shared' — room sells only as shared_tier_id.
--
-- Only meaningful for empty rooms (beds_sold = 0). Once a bed is sold,
-- the booking determines the effective mode regardless of forced_mode.

ALTER TABLE inventory_units ADD COLUMN forced_mode TEXT;
