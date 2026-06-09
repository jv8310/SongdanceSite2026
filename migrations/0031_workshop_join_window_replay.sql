-- Join-window + fallback Zoom details + fixed replay.
--
-- The countdown page now opens its Join button only in a tight window around
-- the start (5 min before → 15 min after). A secondary "the button doesn't
-- work for me" reveal needs the raw Zoom meeting id + passcode (older clients),
-- so workshops carry those alongside the join URL (with config-level defaults).
--
-- Canonical Drip tags: the workshop/masterclass carry m26_SVH_* source tags,
-- and the order bump tags as prod_ASJ (configurable per product via drip_tag,
-- falling back to prod_<slug>).

-- Per-workshop Zoom details revealed by the fallback button.
ALTER TABLE workshops ADD COLUMN zoom_meeting_id TEXT;
ALTER TABLE workshops ADD COLUMN zoom_passcode TEXT;

-- Configurable Drip tag per product; NULL falls back to prod_<slug> in code.
ALTER TABLE workshop_products ADD COLUMN drip_tag TEXT;
UPDATE workshop_products SET drip_tag = 'prod_ASJ' WHERE slug = 'asj-bump';

-- Canonical source tags for the seeded SVH workshop & masterclass.
UPDATE workshops SET source_tag = 'm26_SVH_Workshop'    WHERE slug = 'svh';
UPDATE workshops SET source_tag = 'm26_SVH_Masterclass' WHERE slug = 'svh-masterclass';
