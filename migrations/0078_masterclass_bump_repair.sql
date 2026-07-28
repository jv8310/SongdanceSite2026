-- Repair the masterclass order bump — mis-sold from 21 Jul 2026.
--
-- What happened. A masterclass names no bump of its own (SYNC_MAPPINGS carries
-- `bumpSlug: null`), so every caller applied its own default — and on 21 Jul
-- 2026 they diverged:
--
--   • the registration calendar (calendar.ts) started defaulting to
--     `mantra-empower-bump`, so the card advertised "Empowering You mantra
--     pack — €9";
--   • the checkout (register.ts) and the PayPal fulfilment still defaulted to
--     the old `asj-bump`, so that is what was charged (€19, not €9) and what
--     the purchase ledger recorded;
--   • the Drip tagging gated on `workshops.bump_product_id` being set, which
--     for a masterclass is NULL — so those buyers were granted NO product tag
--     at all: not the mantra pack they chose, not even the ASJ they were
--     billed for.
--
-- Net effect: no mantra-pack delivery email, nothing under "Your music" on
-- /access, and a locked player — for a bump they paid for.
--
-- The code fix is in src/lib/workshops/bump.ts (one resolver, shared by the
-- pages, the checkout, both fulfilment paths and the tagging). This migration
-- repairs the rows that fix cannot reach on its own.
--
-- NOTE ON MONEY: amounts are left exactly as charged. These buyers were billed
-- the ASJ bump's price for the mantra pack; correcting the difference is a
-- refund decision, not a data migration. Only the product attribution moves, so
-- entitlement and delivery are right while the ledger stays truthful about what
-- was taken.

-- 1. Re-attribute the mis-recorded bump lines: a bump purchase booked against
--    `asj-bump` on a MASTERCLASS that names no bump of its own, made on or
--    after the merge that changed what the page advertised (PR #383,
--    2026-07-21 09:33:31 UTC). Before that moment the card really did offer the
--    Authentic Singing Journey at its own price, so those rows are correct and
--    are deliberately left alone.
UPDATE workshop_purchases
   SET product_id = (SELECT id FROM workshop_products WHERE slug = 'mantra-empower-bump')
 WHERE product_type = 'bump'
   AND product_id = (SELECT id FROM workshop_products WHERE slug = 'asj-bump')
   AND created_at >= '2026-07-21 09:33:31'
   AND registration_id IN (
     SELECT r.id
       FROM workshop_registrations r
       JOIN workshops w ON w.id = r.workshop_id
       LEFT JOIN workshop_products mp ON mp.id = w.main_product_id
      WHERE w.bump_product_id IS NULL
        AND mp.slug LIKE '%masterclass%'
   );

-- 2. Name the bump on the masterclasses themselves, so the fallback is only
--    ever a safety net rather than the thing every caller has to agree on.
--    Ordered after step 1 on purpose: that step keys on bump_product_id IS NULL.
UPDATE workshops
   SET bump_product_id = (SELECT id FROM workshop_products WHERE slug = 'mantra-empower-bump'),
       updated_at = datetime('now')
 WHERE bump_product_id IS NULL
   AND deleted = 0
   AND main_product_id IN (SELECT id FROM workshop_products WHERE slug LIKE '%masterclass%');

-- 3. Re-queue every affected buyer through the local contact-tag backfill, so
--    the tags they should have had are mirrored onto the contacts list. The
--    mantra-pack delivery sweep picks the same people up on the next 5-minute
--    tick (their ledger line now names the pack), sends the player link, and
--    re-applies the Drip tag; /access and the player already read D1 directly,
--    so their access is restored either way.
INSERT INTO contact_tag_backfill (order_type, source_id, email, status)
  SELECT 'workshop', r.id, r.email, 'pending'
    FROM workshop_registrations r
    JOIN workshop_purchases p ON p.registration_id = r.id
   WHERE p.product_type = 'bump'
     AND p.product_id = (SELECT id FROM workshop_products WHERE slug = 'mantra-empower-bump')
     AND r.payment_status IN ('paid', 'coupon')
  ON CONFLICT(order_type, source_id) DO UPDATE SET
    status = 'pending', attempts = 0, error = NULL, claimed_at = NULL, done_at = NULL;
