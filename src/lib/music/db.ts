// Music albums — gated mantra players (tables in migrations/0076_music_albums.sql).
//
// An album = cover + ordered audio tracks, managed on /admin/music and played
// on /music/<id>. Access is keyed on the album's Drip tag (see access.ts):
// buyers get the tag from the product/bump automation on payment, and the
// player page opens for any email that carries it. Audio objects live in R2
// under the gated `music-audio/` prefix (never served by /media); covers are
// ordinary public media under `music-covers/`.

export const MUSIC_COVER_PREFIX = 'music-covers/';

// Migration 0076 lands on merge to main, but branch previews share production
// D1 — so until then every read here would 500 the page. Treat exactly that
// one error ("no such table") as an empty library; anything else still throws.
function isMissingTable(err: unknown): boolean {
  return String(err).includes('no such table');
}

export interface MusicAlbumRow {
  id: string;
  title: string;
  description: string | null;
  cover_key: string | null;
  drip_tag: string | null;
  published: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MusicTrackRow {
  id: string;
  album_id: string;
  title: string;
  audio_key: string;
  content_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  sort_order: number;
  created_at: string;
}

export function albumCoverUrl(album: Pick<MusicAlbumRow, 'cover_key'>): string | null {
  return album.cover_key ? `/media/${album.cover_key}` : null;
}

export function albumUrl(album: Pick<MusicAlbumRow, 'id'>): string {
  return `/music/${album.id}`;
}

// ---- Albums ----

export async function listAlbums(
  db: D1Database,
): Promise<Array<MusicAlbumRow & { track_count: number }>> {
  try {
    const q = await db
      .prepare(
        `SELECT a.*, (SELECT COUNT(*) FROM music_tracks t WHERE t.album_id = a.id) AS track_count
           FROM music_albums a
          ORDER BY a.sort_order ASC, a.created_at DESC`,
      )
      .all<MusicAlbumRow & { track_count: number }>();
    return q.results ?? [];
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export async function getAlbum(db: D1Database, id: string): Promise<MusicAlbumRow | null> {
  try {
    const row = await db.prepare(`SELECT * FROM music_albums WHERE id = ?`).bind(id).first<MusicAlbumRow>();
    return row ?? null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

export interface AlbumInput {
  id: string;
  title: string;
  description: string | null;
  drip_tag: string | null;
  published: number;
  cover_key?: string | null; // undefined = leave the existing cover untouched
}

export async function upsertAlbum(
  db: D1Database,
  input: AlbumInput,
  originalId?: string,
): Promise<void> {
  if (originalId && originalId !== input.id) {
    // Renamed (slug changed): move the row and its tracks onto the new id.
    // Audio keys keep their old path — the key never needs to match the slug.
    await db.batch([
      db
        .prepare(
          `UPDATE music_albums SET
             id = ?, title = ?, description = ?, drip_tag = ?, published = ?,
             ${input.cover_key !== undefined ? 'cover_key = ?,' : ''}
             updated_at = datetime('now')
           WHERE id = ?`,
        )
        .bind(
          input.id, input.title, input.description, input.drip_tag, input.published,
          ...(input.cover_key !== undefined ? [input.cover_key] : []),
          originalId,
        ),
      db.prepare(`UPDATE music_tracks SET album_id = ? WHERE album_id = ?`).bind(input.id, originalId),
    ]);
    return;
  }

  await db
    .prepare(
      `INSERT INTO music_albums (id, title, description, drip_tag, published, cover_key)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         drip_tag = excluded.drip_tag,
         published = excluded.published,
         ${input.cover_key !== undefined ? 'cover_key = excluded.cover_key,' : ''}
         updated_at = datetime('now')`,
    )
    .bind(
      input.id, input.title, input.description, input.drip_tag, input.published,
      input.cover_key ?? null,
    )
    .run();
}

export async function deleteAlbum(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM music_tracks WHERE album_id = ?`).bind(id),
    db.prepare(`DELETE FROM music_albums WHERE id = ?`).bind(id),
  ]);
}

// Published albums whose Drip tag appears in the subscriber's tag set —
// the "what music does this email hold?" probe behind /access and the player
// gate. Tag match is case-insensitive (Drip tags are free-form).
export async function listAlbumsForTags(
  db: D1Database,
  tags: string[],
): Promise<MusicAlbumRow[]> {
  if (!tags.length) return [];
  const owned = new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean));
  try {
    const q = await db
      .prepare(
        `SELECT * FROM music_albums
          WHERE published = 1 AND drip_tag IS NOT NULL AND drip_tag != ''
          ORDER BY sort_order ASC, created_at DESC`,
      )
      .all<MusicAlbumRow>();
    return (q.results ?? []).filter((a) => owned.has((a.drip_tag ?? '').trim().toLowerCase()));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

// ---- Tracks ----

export async function listTracks(db: D1Database, albumId: string): Promise<MusicTrackRow[]> {
  try {
    const q = await db
      .prepare(
        `SELECT * FROM music_tracks WHERE album_id = ?
          ORDER BY sort_order ASC, created_at ASC`,
      )
      .bind(albumId)
      .all<MusicTrackRow>();
    return q.results ?? [];
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export async function getTrack(db: D1Database, id: string): Promise<MusicTrackRow | null> {
  try {
    const row = await db.prepare(`SELECT * FROM music_tracks WHERE id = ?`).bind(id).first<MusicTrackRow>();
    return row ?? null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

export async function insertTrack(
  db: D1Database,
  input: Omit<MusicTrackRow, 'sort_order' | 'created_at'>,
): Promise<MusicTrackRow> {
  const next = await db
    .prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM music_tracks WHERE album_id = ?`)
    .bind(input.album_id)
    .first<{ n: number }>();
  const sort = next?.n ?? 1;
  await db
    .prepare(
      `INSERT INTO music_tracks (id, album_id, title, audio_key, content_type, size_bytes, duration_seconds, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id, input.album_id, input.title, input.audio_key,
      input.content_type, input.size_bytes, input.duration_seconds, sort,
    )
    .run();
  return { ...input, sort_order: sort, created_at: new Date().toISOString() };
}

export async function renameTrack(db: D1Database, id: string, title: string): Promise<void> {
  await db.prepare(`UPDATE music_tracks SET title = ? WHERE id = ?`).bind(title, id).run();
}

export async function deleteTrack(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM music_tracks WHERE id = ?`).bind(id).run();
}

// Move a track one step up/down its album. Re-sequences the whole album to
// 1..n on every call, so legacy/equal sort_orders can never wedge a track.
export async function moveTrack(db: D1Database, id: string, dir: 'up' | 'down'): Promise<void> {
  const track = await getTrack(db, id);
  if (!track) return;
  const tracks = await listTracks(db, track.album_id);
  const i = tracks.findIndex((t) => t.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= tracks.length) return;
  [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  await db.batch(
    tracks.map((t, idx) =>
      db.prepare(`UPDATE music_tracks SET sort_order = ? WHERE id = ?`).bind(idx + 1, t.id),
    ),
  );
}

// ---- Formatting ----

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
