import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  MUSIC_COVER_PREFIX,
  deleteAlbum,
  getAlbum,
  listTracks,
  upsertAlbum,
} from '../../../../lib/music/db';

export const prerender = false;

// Create / update / delete a music album from /admin/music. Accepts
// multipart/form-data so an optional cover image can ride along; the cover is
// stored in R2 under music-covers/ (public — cover art isn't the secret, the
// audio is) and referenced by cover_key. Deleting an album also removes its
// tracks' gated audio objects and the cover from R2.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const action = String(form.get('action') ?? '').trim();

  if (action === 'delete') {
    const id = String(form.get('id') ?? '').trim();
    if (!id) return new Response('Bad id', { status: 400 });
    const existing = await getAlbum(env.DB, id);
    if (!existing) return redirect('/admin/music?flash=deleted');
    const tracks = await listTracks(env.DB, id);
    for (const t of tracks) {
      await env.MEDIA.delete(t.audio_key).catch(() => {});
    }
    if (existing.cover_key) await env.MEDIA.delete(existing.cover_key).catch(() => {});
    await deleteAlbum(env.DB, id);
    return redirect('/admin/music?flash=deleted');
  }

  const originalId = String(form.get('original_id') ?? '').trim();
  const id = normaliseSlug(String(form.get('id') ?? '').trim());
  const title = String(form.get('title') ?? '').trim();
  if (!id || !title) return new Response('Title and URL id are required', { status: 400 });

  // A create must not silently overwrite an existing album's settings.
  if (!originalId && (await getAlbum(env.DB, id))) {
    return redirect(`/admin/music?flash=exists&id=${encodeURIComponent(id)}`);
  }

  // Optional cover upload → R2. Only set cover_key when a file is actually
  // provided, so saving without re-uploading keeps the existing cover.
  let cover_key: string | null | undefined = undefined;
  const file = form.get('cover');
  if (file instanceof File && file.size > 0 && file.type.startsWith('image/')) {
    const key = `${MUSIC_COVER_PREFIX}${id}-${Date.now()}${extFor(file.type, file.name)}`;
    await env.MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });
    cover_key = key;
    const prev = await getAlbum(env.DB, originalId || id);
    if (prev?.cover_key && prev.cover_key !== key) {
      await env.MEDIA.delete(prev.cover_key).catch(() => {});
    }
  } else if (form.get('remove_cover') === '1') {
    const prev = await getAlbum(env.DB, originalId || id);
    if (prev?.cover_key) await env.MEDIA.delete(prev.cover_key).catch(() => {});
    cover_key = null;
  }

  await upsertAlbum(
    env.DB,
    {
      id,
      title,
      description: nullable(form.get('description')),
      drip_tag: nullable(form.get('drip_tag')),
      published: form.get('published') === 'on' || form.get('published') === '1' ? 1 : 0,
      cover_key,
    },
    originalId || undefined,
  );

  return redirect(`/admin/music/${id}?flash=saved`);
};

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}

function nullable(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

function extFor(mime: string, name: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'image/gif': '.gif',
  };
  if (map[mime]) return map[mime];
  const m = /\.[a-z0-9]+$/i.exec(name);
  return m ? m[0].toLowerCase() : '';
}

function normaliseSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
