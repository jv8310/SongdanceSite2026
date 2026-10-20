// Albums that play in the Songdance app (the CiRCLE) instead of on this site.
//
// An album used to be delivered here: the buyer's email opened a gated player
// at /music/<album>. The app now holds the albums named below as a course in
// its library (songdance-app: ALBUM_PRODUCTS in packages/shared, the MCP tool
// import_site_album copies the tracks across), unlocked by the same things
// that open the player here — the album bought on its own (`album-<id>`), the
// workshop / masterclass order bump, the album's Drip tag — and, for
// "Empowering You", by the 12-week course, which always came with these
// mantras.
//
// The move is a switch per album, off until it is pressed on
// /admin/music/<id> ("Plays in the app"), because the app's address,
// circle.songdance.co, is still the Mighty Networks community until the
// cutover: sending a buyer there before then would land them nowhere. Stored in
// workshop_config as `album_in_app_on:<album id>` = the UTC time it went on.
//
// While it is on, for that album:
//   · /music/<album> sells it as before, but an owner (cookie, email link,
//     the return from checkout) is shown the way into the app, not the player;
//   · the delivery emails (the bump's mantraPackEmail, a standalone purchase's
//     albumPurchaseEmail) send the buyer to the app;
//   · /access lists it under "Your music" with the app as the place to open it;
//   · the bump card on the workshop and masterclass checkouts says where it
//     plays.
// Off again, everything is as it was: the player never went away.
//
// Kept free of heavy imports so pages, emails and the cron can all use it.

import { circleCourseUrl } from '../courses/circle';

// Album id on this site → the app's course key. They are the same string by
// convention; an album missing here has no course in the app and stays on the
// site whatever its switch says.
export const APP_ALBUM_COURSES: Readonly<Record<string, string>> = {
  'empowering-you': 'empowering-you',
};

// The album the workshop / masterclass order bump hands over: the bump cards on
// those checkouts show its cover and say where it plays.
export const EMPOWERING_YOU_ALBUM = 'empowering-you';

const KEY_PREFIX = 'album_in_app_on:';

export function appCourseForAlbum(albumId: string): string | null {
  return APP_ALBUM_COURSES[albumId] ?? null;
}

// The album's page in the app, signed in or not (a signed-out visitor signs in
// first, then lands on it).
export function albumAppUrl(albumId: string): string | null {
  const course = appCourseForAlbum(albumId);
  return course ? circleCourseUrl(course) : null;
}

// When the album moved to the app, or null while it still plays here.
export async function albumInAppSince(db: D1Database, albumId: string): Promise<string | null> {
  if (!appCourseForAlbum(albumId)) return null;
  try {
    const row = await db
      .prepare(`SELECT value FROM workshop_config WHERE key = ?`)
      .bind(`${KEY_PREFIX}${albumId}`)
      .first<{ value: string }>();
    return row?.value || null;
  } catch {
    return null; // off: the player keeps working
  }
}

export async function albumPlaysInApp(db: D1Database, albumId: string): Promise<boolean> {
  return (await albumInAppSince(db, albumId)) !== null;
}

// The albums whose switch is on, for callers that look at several at once.
export async function albumsInApp(db: D1Database): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const { results } = await db
      .prepare(`SELECT key, value FROM workshop_config WHERE key LIKE ?`)
      .bind(`${KEY_PREFIX}%`)
      .all<{ key: string; value: string }>();
    for (const r of results ?? []) {
      const id = r.key.slice(KEY_PREFIX.length);
      if (r.value && appCourseForAlbum(id)) out.add(id);
    }
  } catch {
    /* off */
  }
  return out;
}

export async function setAlbumInApp(db: D1Database, albumId: string, on: boolean): Promise<void> {
  if (!appCourseForAlbum(albumId)) throw new Error(`album "${albumId}" has no course in the app`);
  const key = `${KEY_PREFIX}${albumId}`;
  if (on) {
    // Keep the first moment it went on; pressing it again changes nothing.
    await db
      .prepare(`INSERT INTO workshop_config (key, value) VALUES (?, datetime('now')) ON CONFLICT(key) DO NOTHING`)
      .bind(key)
      .run();
  } else {
    await db.prepare(`DELETE FROM workshop_config WHERE key = ?`).bind(key).run();
  }
}
