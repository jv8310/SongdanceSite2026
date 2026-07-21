import type { APIRoute } from 'astro';
import { GATED_AUDIO_PREFIX, parseRange, r2RangeResponse } from '../../lib/media';

export const prerender = false;

// Serve admin-uploaded media (images and short videos) from the R2 bucket.
// Objects are public-read; long cache because keys are content-addressed
// (id + timestamp), so a changed image gets a new key.
//
// Range requests are honoured (see r2RangeResponse in lib/media.ts) so video
// plays and seeks correctly.
//
// The one exception: gated album audio (`music-audio/…`) is never served here —
// those bytes are buyer-only and go through the signed /api/music/stream route.
export const GET: APIRoute = async ({ params, request, locals }) => {
  const env = locals.runtime.env;
  const key = params.key;
  if (!key || key.startsWith(GATED_AUDIO_PREFIX)) return new Response('Not found', { status: 404 });

  const range = parseRange(request.headers.get('range'));
  const object = await env.MEDIA.get(key, range ? { range } : undefined);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return r2RangeResponse(object, range, headers);
};
