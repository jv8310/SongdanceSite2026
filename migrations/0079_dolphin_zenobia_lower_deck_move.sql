-- Dolphin & Sound Retreat — registration #45 (Zenobia Silverio) moves from the
-- upper-deck twin to a lower-deck twin, with the deposit she has overpaid
-- credited against her balance instead of refunded.
--
-- The booking as it stands:
--
--   • booked    Twin cabin – upper deck with sea views · €2495 per person
--               50% deposit €1247.50 paid 22 Jul 2026; balance €1247.50 due
--               before 1 September 2026.
--   • moving to Twin cabin – lower deck with porthole  · €1995 per person,
--               whose 50% deposit would have been €997.50.
--
-- She has therefore already paid €250 more deposit than the new cabin asks
-- for. Rather than refund that €250 and then invoice the full €997.50, the
-- difference is carried straight into what is still owed:
--
--     deposit already paid    €1247.50   (unchanged — real money, really taken)
--     lower-deck cabin price  €1995.00
--     ────────────────────────────────
--     balance still due        €747.50   = €1995.00 − €1247.50
--                                          (€997.50 normal deposit − €250 credit)
--
-- So `amount_cents` stays exactly as charged — the ledger keeps telling the
-- truth about what was collected — and the whole adjustment lands in
-- `balance_due_cents`. Both sides of her booking then read right:
--
--   • the balance link (admin → "Send balance link", src/lib/registrations/
--     balance.ts) is built from balance_due_cents, so it asks for €747.50, on
--     the same gateway the deposit was paid with, for the line item
--     "… — Twin cabin – lower deck with porthole (remaining balance)";
--   • when she settles, markBalancePaid rolls the balance into amount_cents —
--     €1247.50 + €747.50 = €1995.00, exactly the lower-deck price.
--
-- Her cabin needs no change: she is already assigned Cabin L5 (a lower-deck
-- twin), which is what made the upper-deck tier on the row wrong in the first
-- place. Moving the tier also puts the per-tier counts right — the upper deck
-- gets its bed back, the lower deck spends the one she is actually sleeping in.
--
-- The two balance-checkout references are cleared as well: nothing has been
-- emailed to her yet (balance_invite_sent_at is unset), but any session/order
-- id lingering on the row would have been created for the old €1247.50, so it
-- must not be reused.
--
-- Idempotent: the UPDATE is guarded on the row still sitting on twin-upper at
-- the deposit amount, so a re-run matches nothing; the audit event is
-- INSERT OR IGNORE on a unique external_id, and is only written if the update
-- actually landed.

UPDATE registrations
   SET tier_id = (SELECT t.id
                    FROM tiers t
                    JOIN products p ON p.id = t.product_id
                   WHERE p.slug = 'dolphin-and-sound-2026'
                     AND t.slug = 'twin-lower'),
       -- €1995.00 lower-deck price minus everything already paid.
       balance_due_cents = 199500 - amount_cents,
       balance_stripe_session_id = NULL,
       balance_paypal_order_id = NULL,
       -- Keep her own note ("I cannot swim. But the calling is too strong.")
       -- and replace only the deposit sentence the checkout appended after the
       -- " — " separator.
       notes = CASE
         WHEN notes IS NULL THEN
           'Moved from the upper-deck twin (€2495) to the lower-deck twin (€1995) on 29 July 2026, at her request. Deposit of €1247.50 already paid — €250 more than the lower deck''s €997.50 deposit — and that difference is credited against the balance rather than refunded, so €747.50 remains due before 1 September 2026.'
         WHEN instr(notes, ' — 50% deposit paid') > 0 THEN
           substr(notes, 1, instr(notes, ' — 50% deposit paid') - 1)
             || ' — Moved from the upper-deck twin (€2495) to the lower-deck twin (€1995) on 29 July 2026, at her request. Deposit of €1247.50 already paid — €250 more than the lower deck''s €997.50 deposit — and that difference is credited against the balance rather than refunded, so €747.50 remains due before 1 September 2026.'
         ELSE
           notes
             || ' — Moved from the upper-deck twin (€2495) to the lower-deck twin (€1995) on 29 July 2026, at her request. Deposit of €1247.50 already paid — €250 more than the lower deck''s €997.50 deposit — and that difference is credited against the balance rather than refunded, so €747.50 remains due before 1 September 2026.'
       END
 WHERE id = 45
   AND status = 'paid'
   AND amount_cents = 124750
   AND balance_paid_at IS NULL
   AND product_id = (SELECT id FROM products WHERE slug = 'dolphin-and-sound-2026')
   AND tier_id = (SELECT t.id
                    FROM tiers t
                    JOIN products p ON p.id = t.product_id
                   WHERE p.slug = 'dolphin-and-sound-2026'
                     AND t.slug = 'twin-upper');

-- Audit trail on the registration, so the events log on /admin/retreats shows
-- why the cabin, the price and the balance moved without a refund.
INSERT OR IGNORE INTO events (registration_id, kind, source, external_id, payload_json)
SELECT 45,
       'admin.booking.tier_changed',
       'admin',
       'reg-45-twin-upper-to-twin-lower',
       '{"from_tier":"twin-upper","from_price_cents":249500,'
       || '"to_tier":"twin-lower","to_price_cents":199500,'
       || '"deposit_paid_cents":124750,"lower_deck_deposit_cents":99750,'
       || '"deposit_credit_cents":25000,"balance_due_cents":74750,'
       || '"refund":"none - deposit overpayment credited against the balance"}'
 WHERE EXISTS (
   SELECT 1 FROM registrations
    WHERE id = 45 AND balance_due_cents = 74750
 );
