import type { APIRoute } from 'astro';

export const prerender = false;

// Serve admin-uploaded media (images and short videos) from the R2 bucket.
// Objects are public-read; long cache because keys are content-addressed
// (id + timestamp), so a changed image gets a new key.
//
// Range requests are honoured so video (which the browser fetches with
// `Range: bytes=…`) plays and seeks correctly; without 206 support Safari in
// particular refuses to play self-hosted video.
export const GET: APIRoute = async ({ params, request, locals }) => {
  const env = locals.runtime.env;
  const key = params.key;
  if (!key) return new Response('Not found', { status: 404 });

  const range = parseRange(request.headers.get('range'));
  const object = await env.MEDIA.get(key, range ? { range } : undefined);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('accept-ranges', 'bytes');
  if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');

  // A satisfied range comes back as a partial body (206) with Content-Range.
  if (range && object.range) {
    const offset = 'offset' in object.range ? (object.range.offset ?? 0) : 0;
    const length =
      'length' in object.range && object.range.length != null
        ? object.range.length
        : object.size - offset;
    const end = offset + length - 1;
    headers.set('content-range', `bytes ${offset}-${end}/${object.size}`);
    headers.set('content-length', String(length));
    return new Response(object.body, { status: 206, headers });
  }

  return new Response(object.body, { headers });
};

// Parse a single-range `Range` header into an R2Range. Returns undefined for a
// missing/multi/unparseable header so we fall back to serving the whole object.
function parseRange(header: string | null): R2Range | undefined {
  if (!header) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return undefined;
  const startStr = m[1];
  const endStr = m[2];
  if (startStr === '' && endStr === '') return undefined;
  if (startStr === '') {
    // `bytes=-N` → final N bytes.
    return { suffix: Number(endStr) };
  }
  const offset = Number(startStr);
  if (endStr === '') return { offset }; // `bytes=N-` → from N to the end.
  return { offset, length: Number(endStr) - offset + 1 };
}
