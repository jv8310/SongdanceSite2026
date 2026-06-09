-- A separate Zoom default for the masterclass, so workshops and the €29
-- masterclass can run on different Zoom links/IDs. The masterclass resolves
-- zoom_*_masterclass first and falls back to zoom_*_default when blank; edit
-- both in /admin/settings/zoom.
INSERT OR IGNORE INTO workshop_config (key, value) VALUES
  ('zoom_url_masterclass', 'https://us02web.zoom.us/j/00000000000');
