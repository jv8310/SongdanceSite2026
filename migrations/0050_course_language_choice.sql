-- Dutch edition of the Authentic Singing Journey.
--
-- The Authentic Singing Journey ships in two language editions: the original
-- English course and a Dutch one. Buyers in a Dutch context (country BE/NL,
-- geolocation, or a Dutch browser language) are offered a choice on the journey
-- registration form — Dutch / English / both — which decides the Drip product
-- tags granted at payment (see src/lib/courses/journeys.ts → journeyDrip and
-- src/lib/courses/paid-handler.ts). The choice swaps the ASJ component's tags
-- for their Dutch counterparts, leaving any other product tags untouched:
--
--   prod_ASJ     ↔ prod_JAZ
--   prod_ASJ_PRO ↔ prod_JAZ_PRO
--
-- It applies to every product containing the ASJ — asj, asj-pro, journeys-bundle
-- and journeys-bundle-pro. "both" keeps the English ASJ tags and adds the Dutch
-- ones. NULL — every legacy row, a product with no ASJ (mmj / inner-child), and
-- any buyer never shown the choice — keeps the English default.
ALTER TABLE course_registrations
  ADD COLUMN language_choice TEXT;   -- 'nl' | 'en' | 'both' | NULL
