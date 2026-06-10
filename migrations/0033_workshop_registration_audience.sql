-- Which "door(s)" the visitor had chosen on the workshop page when they
-- registered — from ?audience=1,3, a ?campaign= alias, or the on-page
-- selector form: 1 = healing, 2 = freedom, 3 = pro (practitioners).
--
-- Stored as the sorted comma-joined door list ("3", "1,3"); NULL when they
-- never chose a lens. On payment the doors become Drip tags
-- (svh_audience_healing / svh_audience_freedom / svh_audience_pro) plus an
-- `audience` custom field, so pro registrants are segmentable in both the
-- database and Drip.

ALTER TABLE workshop_registrations
  ADD COLUMN audience TEXT;
