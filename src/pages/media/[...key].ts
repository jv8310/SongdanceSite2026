import type { APIRoute } from 'astro';

export const prerender = false;

// Serve admin-uploaded media (event card images) from the R2 bucket.
// Objects are public-read; long cache because keys are content-addressed
// (id + timestamp), so a changed image gets a new key.
export const GET: APIRoute = async ({ params, locals }) => {
  const env = locals.runtime.env;
  const key = params.key;
  if (!key) return new Response('Not found', { status: 404 });

  const object = await env.MEDIA.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');

  return new Response(object.body, { headers });
};
