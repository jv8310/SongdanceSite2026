import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { logEventSafe } from '../../../../lib/registrations/db';
import { getAlbum } from '../../../../lib/music/db';
import { appCourseForAlbum, setAlbumInApp } from '../../../../lib/music/in-app';

export const prerender = false;

// The "Plays in the app" switch on /admin/music/<id> (src/lib/music/in-app.ts):
// on, the album's owners are sent to its course in the CiRCLE app instead of
// the player here; off, everything is as it was. Only an album the app has a
// course for can be switched.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const form = await request.formData();
  const id = String(form.get('album_id') ?? '').trim();
  const on = String(form.get('on') ?? '') === '1';
  const album = id ? await getAlbum(env.DB, id) : null;
  if (!album) return new Response('No such album', { status: 404 });
  if (!appCourseForAlbum(album.id)) {
    return new Response(`"${album.id}" has no course in the app`, { status: 400 });
  }
  await setAlbumInApp(env.DB, album.id, on);
  await logEventSafe(env.DB, {
    registration_id: null,
    kind: on ? 'music.album.in_app_on' : 'music.album.in_app_off',
    source: 'admin',
    payload: { album_id: album.id, course: appCourseForAlbum(album.id) },
  });
  return new Response(null, {
    status: 303,
    headers: { Location: `/admin/music/${encodeURIComponent(album.id)}?flash=${on ? 'in-app-on' : 'in-app-off'}` },
  });
};
