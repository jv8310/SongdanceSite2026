import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  ALLOWED_VIDEO_TYPES,
  LIBRARY_PREFIX,
  MAX_VIDEO_BYTES,
  sanitizeFilename,
  uniqueKey,
  type MediaItem,
} from '../../../../lib/media';

export const prerender = false;

// Upload one or more images — or short videos — into the media library (R2).
// Images arrive already resized/compressed by the browser (see
// src/scripts/image-optimize.ts); videos are stored as-is. Either way we drop
// them under the `library/` prefix and return their public URLs.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const form = await request.formData();
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return json({ error: 'No files provided' }, 400);

  const uploaded: MediaItem[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const isImage = file.type.startsWith('image/');
    const isVideo = ALLOWED_VIDEO_TYPES.has(file.type);
    if (!isImage && !isVideo) {
      errors.push(`${file.name}: unsupported type (${file.type || 'unknown'})`);
      continue;
    }
    if (isVideo && file.size > MAX_VIDEO_BYTES) {
      errors.push(
        `${file.name}: video is too large (max ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB — use a short clip, or host it on Vimeo)`,
      );
      continue;
    }
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

  if (uploaded.length === 0) {
    return json({ error: errors[0] || 'No valid files', errors }, 400);
  }
  return json({ uploaded, errors });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
