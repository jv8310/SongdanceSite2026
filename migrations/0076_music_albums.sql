-- Music albums — gated mantra players (src/lib/music/).
--
-- An album is a small collection of audio tracks with a cover, sold as a
-- product (for now: a checkout order bump). Each album has a public player URL
-- (/music/<id>) that only opens for buyers: access is keyed on a per-album
-- Drip tag (`drip_tag`) — the same tag the bump/product automation applies on
-- payment — and the "login" is just the buyer's email address, exactly like
-- /access. Owned albums also show up in the /access lookup results.
--
-- Audio bytes live in R2 under the `music-audio/` prefix, which the public
-- /media route refuses to serve; playback goes through short-lived signed URLs
-- (/api/music/stream/<track>). Covers are ordinary public media
-- (`music-covers/`).

CREATE TABLE IF NOT EXISTS music_albums (
  id TEXT PRIMARY KEY,                 -- slug; the public player URL is /music/<id>
  title TEXT NOT NULL,
  description TEXT,                    -- optional intro paragraph on the player page
  cover_key TEXT,                      -- R2 key of the cover art (music-covers/…)
  drip_tag TEXT,                       -- Drip tag that grants access (e.g. prod_MANTRA);
                                       -- NULL = nobody but admins can open it yet
  published INTEGER NOT NULL DEFAULT 1,-- 0 hides the page from everyone but admins
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS music_tracks (
  id TEXT PRIMARY KEY,                 -- random uuid
  album_id TEXT NOT NULL,
  title TEXT NOT NULL,
  audio_key TEXT NOT NULL,             -- R2 key under music-audio/<album>/ (never public)
  content_type TEXT,
  size_bytes INTEGER,
  duration_seconds REAL,               -- read client-side at upload; best-effort
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_music_tracks_album ON music_tracks(album_id, sort_order);
