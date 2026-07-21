import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { deleteTrack, getTrack, moveTrack, renameTrack } from '../../../../lib/music/db';

export const prerender = false;

// Per-track actions from the album detail page (fetch API):
//   rename — { action: 'rename', id, title }
//   delete — { action: 'delete', id }   (also removes the R2 audio object)
//   move   — { action: 'move', id, dir: 'up' | 'down' }
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const form = await request.formData();
  const action = String(form.get('action') ?? '').trim();
  const id = String(form.get('id') ?? '').trim();
  const track = id ? await getTrack(env.DB, id) : null;
  if (!track) return json({ error: 'Unknown track' }, 400);

  if (action === 'rename') {
    const title = String(form.get('title') ?? '').trim().slice(0, 200);
    if (!title) return json({ error: 'Title is required' }, 400);
    await renameTrack(env.DB, id, title);
    return json({ ok: true, title });
  }

  if (action === 'delete') {
    await env.MEDIA.delete(track.audio_key).catch(() => {});
    await deleteTrack(env.DB, id);
    return json({ ok: true });
  }

  if (action === 'move') {
    const dir = String(form.get('dir') ?? '') === 'up' ? 'up' : 'down';
    await moveTrack(env.DB, id, dir);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
