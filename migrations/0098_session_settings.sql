-- Individual sessions: Jacob's settings (November 2026) — €175 per session,
-- 50 minutes. The buffer goes to 10 minutes so a "Boekingen" window is cut on
-- the hour (10:00, 11:00, 12:00 …): 50 minutes of session, 10 between.
-- Everything here stays editable on /admin/sessions (src/lib/sessions/config.ts);
-- a later change there wins over this.
INSERT INTO workshop_config (key, value) VALUES
  ('sessions_price_eur_cents', '17500'),
  ('sessions_duration_min', '50'),
  ('sessions_buffer_min', '10')
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
