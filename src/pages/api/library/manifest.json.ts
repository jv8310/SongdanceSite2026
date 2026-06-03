import type { APIRoute } from 'astro';
import { listLibrary, type MediaItem } from '../../../lib/media';

export const prerender = false;

// Public, read-only catalogue of every image in the R2 media bucket.
//
// Individual images are already public at /media/<key>; this endpoint just
// makes the *list* machine-readable so tooling (and Claude, via
// scripts/r2-library.mjs) can discover what's in the library, pull images
// down to look at them, and reuse their /media/… URLs on pages.
//
//   /api/library/manifest.json                 → everything in the bucket
//   /api/library/manifest.json?prefix=library/ → just the library folder
//   /api/library/manifest.json?prefix=events/  → just event-card images
//   /api/library/manifest.json?limit=20         → newest 20
export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;

  let images: MediaItem[];
  try {
    images = await listLibrary(env.MEDIA);
  } catch (err) {
    console.error('library manifest list failed', err);
    return json(
      { error: 'Could not read the media bucket (MEDIA binding / songdance-media).' },
      500,
    );
  }

  const prefix = url.searchParams.get('prefix');
  if (prefix) images = images.filter((it) => it.key.startsWith(prefix));

  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : NaN;
  if (Number.isFinite(limit) && limit > 0) images = images.slice(0, limit);

  // Count images per top-level folder so callers get a quick overview.
  const folders: Record<string, number> = {};
  for (const it of images) {
    const i = it.key.indexOf('/');
    const folder = i >= 0 ? it.key.slice(0, i + 1) : '/';
    folders[folder] = (folders[folder] ?? 0) + 1;
  }

  const base = env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? '';

  return json(
    {
      count: images.length,
      folders,
      // Absolute URL too, so a CLI run outside the browser can fetch the bytes
      // directly without knowing the site origin.
      images: images.map((it) => ({ ...it, absoluteUrl: base ? `${base}${it.url}` : it.url })),
    },
    200,
  );
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Short edge cache; uploads/renames show within a minute.
      'cache-control': 'public, max-age=60',
    },
  });
}
