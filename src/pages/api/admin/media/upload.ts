import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { LIBRARY_PREFIX, sanitizeFilename, uniqueKey, type MediaItem } from '../../../../lib/media';

export const prerender = false;

// Upload one or more images into the media library (R2). Files arrive already
// resized/compressed by the browser (see src/scripts/image-optimize.ts), so we
// just store them under the `library/` prefix and return their public URLs.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const form = await request.formData();
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return json({ error: 'No files provided' }, 400);

  const uploaded: MediaItem[] = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const name = sanitizeFilename(file.name, file.type);
    const key = await uniqueKey(env.MEDIA, LIBRARY_PREFIX, name);
    await env.MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });
    uploaded.push({
      key,
      size: file.size,
      uploaded: new Date().toISOString(),
      contentType: file.type || null,
      url: `/media/${key}`,
    });
  }

  if (uploaded.length === 0) return json({ error: 'No valid image files' }, 400);
  return json({ uploaded });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
