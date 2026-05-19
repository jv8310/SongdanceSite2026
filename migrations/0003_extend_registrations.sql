-- Extend registrations with the detailed contact + consent fields
-- captured by the multi-step on-page registration form.
--
-- "name" is kept for back-compat with rows seeded in 0002 and is filled
-- on new inserts as `first_name + " " + last_name`.

ALTER TABLE registrations ADD COLUMN first_name TEXT;
ALTER TABLE registrations ADD COLUMN last_name TEXT;
ALTER TABLE registrations ADD COLUMN phone_country TEXT;   -- ISO-2: BE, NL, DE, ...
ALTER TABLE registrations ADD COLUMN company_name TEXT;
ALTER TABLE registrations ADD COLUMN vat_number TEXT;
ALTER TABLE registrations ADD COLUMN address TEXT;          -- full address, free-text
ALTER TABLE registrations ADD COLUMN consent_framework INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN consent_terms     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN consent_at TEXT;
