-- Course-side B2B fields: company name + VAT number, optional.
--
-- The cert/bundle is an electronic service (Quaderno "eservice" category):
--   - For an EU consumer (no VAT number) Quaderno applies destination-country VAT.
--   - For an EU business with a valid VAT number Stripe attaches it as
--     tax_id_data on the Customer, Quaderno reads it via the Stripe sync,
--     and the invoice is issued reverse-charge (0% VAT).
--   - For non-EU customers (e.g. US) the eservice is out of EU VAT scope.

ALTER TABLE course_registrations
  ADD COLUMN company_name TEXT;

ALTER TABLE course_registrations
  ADD COLUMN vat_number TEXT;
