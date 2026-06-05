-- B2B fields for workshop registrations — used by the masterclass, which
-- practitioners may book on behalf of a company.
--
-- The masterclass is an electronic service (eservice):
--   - An EU business with a valid VAT number is invoiced reverse-charge (0%):
--     the number is attached to the Stripe Customer as tax_id_data at checkout
--     (the same path the course flow uses), and the Quaderno-Stripe sync reads
--     it off the customer.
--   - An EU consumer (no VAT number) is charged destination-country VAT.
--   - Non-EU buyers are out of EU VAT scope.

ALTER TABLE workshop_registrations
  ADD COLUMN company_name TEXT;

ALTER TABLE workshop_registrations
  ADD COLUMN vat_number TEXT;
