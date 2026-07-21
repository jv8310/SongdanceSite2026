import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  ALLOWED_AUDIO_TYPES,
  GATED_AUDIO_PREFIX,
  MAX_AUDIO_BYTES,
  isAudioType,
  sanitizeFilename,
  uniqueKey,
} from '../../../../lib/media';
import { getAlbum, insertTrack, type MusicTrackRow } from '../../../../lib/music/db';
import { signedStreamUrl } from '../../../../lib/music/access';

export const prerender = false;

// Upload audio tracks into an album (fetch API behind /admin/music/<id>).
// The admin page uploads one file per request (so each stays well under the
// Workers request-body cap and gets its own progress step), but multiple
// files per request work too. Audio lands under the gated music-audio/
// prefix — never served by /media — and each row gets the next sort_order.
// Returns the created tracks plus a signed stream URL so the admin page can
// preview each one immediately.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const form = await request.formData();
  const albumId = String(form.get('album_id') ?? '').trim();
  const album = albumId ? await getAlbum(env.DB, albumId) : null;
  if (!album) return json({ error: 'Unknown album' }, 400);

  // Best-effort per-file durations, read client-side before upload:
  // { "<original filename>": seconds }.
  let durations: Record<string, number> = {};
  try {
    const parsed = JSON.parse(String(form.get('durations') ?? '{}'));
    if (parsed && typeof parsed === 'object') durations = parsed;
  } catch {
    // Ignore — duration stays null and the player fills it in on load.
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return json({ error: 'No files provided' }, 400);

  const uploaded: Array<MusicTrackRow & { stream_url: string }> = [];
  const errors: string[] = [];
  for (const file of files) {
    if (!isAudioType(file.type) && !ALLOWED_AUDIO_TYPES.has(file.type)) {
      errors.push(`${file.name}: not an audio file (${file.type || 'unknown type'})`);
      continue;
    }
    if (file.size > MAX_AUDIO_BYTES) {
      errors.push(
        `${file.name}: too large (max ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))} MB per track)`,
      );
      continue;
    }
    const name = sanitizeFilename(file.name, file.type);
    const key = await uniqueKey(env.MEDIA, `${GATED_AUDIO_PREFIX}${album.id}/`, name);
    await env.MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });
    const rawDuration = durations[file.name];
    const duration =
      typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0
        ? rawDuration
        : null;
    const row = await insertTrack(env.DB, {
      id: crypto.randomUUID(),
      album_id: album.id,
      title: titleFromFilename(file.name),
      audio_key: key,
      content_type: file.type || null,
      size_bytes: file.size,
      duration_seconds: duration,
    });
    uploaded.push({ ...row, stream_url: await signedStreamUrl(env.ADMIN_SESSION_SECRET, row.id) });
  }

  if (uploaded.length === 0) {
    return json({ error: errors[0] || 'No valid files', errors }, 400);
  }
  return json({ uploaded, errors });
};

// "03 - Om Mani Padme Hum.mp3" → "Om Mani Padme Hum". Strips the extension and
// a leading track number, and un-slugs separators; the admin can rename after.
function titleFromFilename(name: string): string {
  const dot = name.lastIndexOf('.');
  let base = dot > 0 ? name.slice(0, dot) : name;
  base = base
    .replace(/^\s*\d{1,3}\s*[-–._)\s]\s*/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!base) base = 'Untitled track';
  return base.slice(0, 200);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
