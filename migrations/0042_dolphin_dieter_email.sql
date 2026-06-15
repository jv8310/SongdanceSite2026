-- Dolphin & Sound Retreat — put Dieter's real email on the Dieter & Davy
-- booking, replacing the placeholder used when the couple was first seeded
-- (migration 0028). Their double-cabin (D2) registration had NO EMAIL on file,
-- so 'dieter-davy@placeholder.invalid' stood in. Dieter has now given his
-- address, so the row can carry it — which means the paid → Drip push (admin
-- "Mark paid + Drip", or the new "Resend to Drip" button) reaches a real inbox
-- instead of the .invalid placeholder.
--
-- The row is left 'pending': payment is confirmed via the admin "Mark paid +
-- Drip" button, which flips the status AND fires the Drip event in one audited
-- step (and sends the internal SD-ORDER notification).
--
-- Idempotent: scoped to the placeholder address on this product's
-- 'Dieter & Davy' row, so re-running after the address is set is a no-op.

UPDATE registrations
   SET email = 'dieter.vandeputte@hotmail.com',
       notes = 'Booked the double cabin (D2) as a couple. Dieter''s real email now on file (replaced the placeholder). Confirm payment via admin "Mark paid + Drip" to push the registration to Drip.'
 WHERE product_id = (SELECT id FROM products WHERE slug = 'dolphin-and-sound-2026')
   AND name = 'Dieter & Davy'
   AND email = 'dieter-davy@placeholder.invalid';
