-- Present the order bump under its real product name. `asj-bump` is the
-- Authentic Singing Journey (40 guided journeys) offered as a €19 one-time
-- add-on alongside the workshop and masterclass. Showing it by that name keeps
-- the registration card, the Stripe line item and the invoice consistent with
-- the standalone offering at /courses/authentic-singing. Code keys on the slug,
-- so only the display name changes.

UPDATE workshop_products
   SET name = 'Authentic Singing Journey'
 WHERE slug = 'asj-bump';
