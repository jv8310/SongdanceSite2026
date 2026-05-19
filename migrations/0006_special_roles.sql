-- Special-role beds: the Paviljoen (fire keeper) and Room 5.2 (cook help).
--
-- Both rooms stay status='reserved' so the auto-pick algorithm ignores
-- them — they are NOT bookable through the open Common Space pool. The
-- registration form lets the buyer opt into one of these roles on step 3
-- (only when they've picked the cheapest tier(s)). Opting in assigns
-- that specific room and, for cook help, applies a 30% discount on the
-- chosen tier.

ALTER TABLE inventory_units ADD COLUMN role TEXT;
-- values: 'fire_keeper' | 'cook_help' | NULL

UPDATE inventory_units
   SET role = 'fire_keeper'
 WHERE name LIKE 'Paviljoen%';

UPDATE inventory_units
   SET role = 'cook_help'
 WHERE name LIKE 'Room 5.2 — Theaterkamer mezzanine (cook help)%';

-- Per-registration role + the discount we applied (positive cents
-- subtracted from the tier price). amount_cents on registrations
-- stores the actually-charged amount.
ALTER TABLE registrations ADD COLUMN role TEXT;
ALTER TABLE registrations ADD COLUMN role_discount_cents INTEGER NOT NULL DEFAULT 0;
