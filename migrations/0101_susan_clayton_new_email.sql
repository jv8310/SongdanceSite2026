-- Susan Clayton (Ritual of Belonging 2026, booking #10) booked with
-- susan.clayton@peckovertransport.co.uk, which she no longer reads. She asked
-- us to use susan@grsc.co.uk (November 2026). The admin has no "change email"
-- for a retreat booking, so it is done here.
--
-- Everything that finds her by address moves together, or she would come
-- apart: the intake list joins the booking to its invitation, submission and
-- travel answers by email, and would show her as "not invited" (and offer to
-- invite her again) if only the booking moved. The travel answer's updated_at
-- is touched so the hourly sync rewrites her row in the Google Sheet. The
-- contacts mirror (broadcasts) moves too, tags first, since contact_tags is
-- keyed by email. Drip was renamed in place separately (same subscriber, tags
-- and history kept).
--
-- Every statement is guarded on the old address (and, where the table is
-- unique on email, on the new one being free), so a re-run changes nothing.

UPDATE registrations
   SET email = 'susan@grsc.co.uk'
 WHERE id = 10
   AND lower(email) = 'susan.clayton@peckovertransport.co.uk'
   AND product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026');

UPDATE intake_invitations
   SET email = 'susan@grsc.co.uk'
 WHERE lower(email) = 'susan.clayton@peckovertransport.co.uk'
   AND retreat_slug IN (SELECT slug FROM intake_retreats
                         WHERE product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026'))
   AND NOT EXISTS (SELECT 1 FROM intake_invitations i
                    WHERE i.retreat_slug = intake_invitations.retreat_slug
                      AND lower(i.email) = 'susan@grsc.co.uk');

UPDATE intake_submissions
   SET email = 'susan@grsc.co.uk'
 WHERE lower(email) = 'susan.clayton@peckovertransport.co.uk'
   AND event_code IN (SELECT slug FROM intake_retreats
                       WHERE product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026'));

UPDATE intake_transport_answers
   SET email = 'susan@grsc.co.uk',
       updated_at = datetime('now')
 WHERE lower(email) = 'susan.clayton@peckovertransport.co.uk'
   AND event_code IN (SELECT slug FROM intake_retreats
                       WHERE product_id = (SELECT id FROM products WHERE slug = 'ritual-of-belonging-2026'))
   AND NOT EXISTS (SELECT 1 FROM intake_transport_answers t
                    WHERE t.event_code = intake_transport_answers.event_code
                      AND t.email = 'susan@grsc.co.uk');

UPDATE OR IGNORE contact_tags
   SET email = 'susan@grsc.co.uk'
 WHERE email = 'susan.clayton@peckovertransport.co.uk'
   AND NOT EXISTS (SELECT 1 FROM contacts WHERE email = 'susan@grsc.co.uk');

UPDATE contacts
   SET email = 'susan@grsc.co.uk'
 WHERE email = 'susan.clayton@peckovertransport.co.uk'
   AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.email = 'susan@grsc.co.uk');
