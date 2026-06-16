// Helpers for the R2-backed media library (admin image-manager).
//
// Library uploads live under the `library/` prefix; event-card images live
// under `events/` (written by save-event.ts). Everything is served publicly at
// /media/<key>. The library also holds short, self-hosted clips (mp4/webm) for
// background/accent video — anything longer or watch-with-sound still belongs on
// Vimeo. The serving route (`/media/[...key]`) honours Range requests so video
// seeks/plays correctly.

export const LIBRARY_PREFIX = 'library/';

export interface MediaItem {
  key: string;
  size: number;
  uploaded: string; // ISO
  contentType: string | null;
  url: string; // /media/<key>
}

// Self-hosted video the library accepts. Keep it to short clips — the cap below
// is the contract; long/streamed video goes to Vimeo, not R2.
export const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/ogg',
]);

// Short clips only. Workers' request-body limit is generous, but the library is
// for accent video — not a video host — so we draw the line at 70 MB.
export const MAX_VIDEO_BYTES = 70 * 1024 * 1024;

export function isVideoType(type?: string | null): boolean {
  return !!type && type.startsWith('video/');
}

// Branch the admin grid / page components off the key (the only thing some
// callers have). Mirrors the extensions in EXT_FOR_MIME below.
export function isVideoKey(key: string): boolean {
  return /\.(mp4|webm|mov|m4v|ogv|ogg)$/i.test(key);
}

const EXT_FOR_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/ogg': '.ogv',
};

// Turn a human filename into a safe, lowercase slug while preserving (or
// inferring) an extension. e.g. "Jacob Tree (2026).JPG" → "jacob-tree-2026.jpg"
export function sanitizeFilename(name: string, mime?: string): string {
  const dot = name.lastIndexOf('.');
  let base = dot > 0 ? name.slice(0, dot) : name;
  let ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  if (!ext && mime && EXT_FOR_MIME[mime]) ext = EXT_FOR_MIME[mime];
  base = base
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!base) base = isVideoType(mime) ? 'video' : 'image';
  ext = ext.replace(/[^a-z0-9.]/g, '');
  return `${base}${ext}`;
}

// Find a key under `prefix` that doesn't collide. If `desired` is taken, append
// -2, -3, … before the extension.
export async function uniqueKey(
  bucket: R2Bucket,
  prefix: string,
  filename: string,
): Promise<string> {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  let candidate = `${prefix}${base}${ext}`;
  for (let n = 2; await bucket.head(candidate); n++) {
    candidate = `${prefix}${base}-${n}${ext}`;
  }
  return candidate;
}

export async function listLibrary(bucket: R2Bucket): Promise<MediaItem[]> {
  const items: MediaItem[] = [];
  let cursor: string | undefined;
  do {
    const res = await bucket.list({ limit: 1000, cursor });
    for (const o of res.objects) {
      items.push({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded instanceof Date ? o.uploaded.toISOString() : String(o.uploaded),
        contentType: o.httpMetadata?.contentType ?? null,
        url: `/media/${o.key}`,
      });
    }
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  // Newest first.
  return items.sort((a, b) => (a.uploaded < b.uploaded ? 1 : a.uploaded > b.uploaded ? -1 : 0));
}
