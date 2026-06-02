import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { sanitizeFilename } from '../../../../lib/media';

export const prerender = false;

// Rename a media object. R2 has no native rename, so we copy to the new key
// (preserving the folder prefix and content type) and delete the old one.
// NB: this changes the public /media/<key> URL — anything already pointing at
// the old key (e.g. an event card) will 404 until re-pointed.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const form = await request.formData();
  const key = String(form.get('key') ?? '').trim();
  const rawName = String(form.get('name') ?? '').trim();
  if (!key || !rawName) return json({ error: 'key and name are required' }, 400);

  const slash = key.lastIndexOf('/');
  const prefix = slash >= 0 ? key.slice(0, slash + 1) : '';
  const newName = sanitizeFilename(rawName);
  const newKey = `${prefix}${newName}`;

  if (newKey === key) return json({ key });
  if (await env.MEDIA.head(newKey)) {
    return json({ error: 'A file with that name already exists' }, 409);
  }

  const src = await env.MEDIA.get(key);
  if (!src) return json({ error: 'Not found' }, 404);

  await env.MEDIA.put(newKey, src.body, { httpMetadata: src.httpMetadata });
  await env.MEDIA.delete(key);

  return json({ key: newKey, url: `/media/${newKey}` });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
