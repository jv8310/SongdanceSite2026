import type { APIRoute } from 'astro';
import { parseRange, r2RangeResponse } from '../../../../lib/media';
import { verifyStreamToken } from '../../../../lib/music/access';
import { getTrack } from '../../../../lib/music/db';

export const prerender = false;

// Gated audio streaming for the music albums. The player page (and the admin
// preview) embed short-lived signed URLs — ?e=<unix expiry>&s=<hmac> — minted
// only after the entitlement check passed, so this route just verifies the
// signature. That keeps seeking cheap: a scrub fires many Range requests and
// none of them should hit Drip.
export const GET: APIRoute = async ({ params, request, locals, url }) => {
  const env = locals.runtime.env;
  const trackId = params.track;
  if (!trackId) return new Response('Not found', { status: 404 });

  const okToken = await verifyStreamToken(
    env.ADMIN_SESSION_SECRET,
    trackId,
    url.searchParams.get('e'),
    url.searchParams.get('s'),
  );
  if (!okToken) return new Response('Link expired — reload the player page', { status: 403 });

  const track = await getTrack(env.DB, trackId);
  if (!track) return new Response('Not found', { status: 404 });

  const range = parseRange(request.headers.get('range'));
  const object = await env.MEDIA.get(track.audio_key, range ? { range } : undefined);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  // Private: the URL is personal and time-limited; an hour of browser cache
  // keeps repeat plays free without outliving the signature by much.
  headers.set('cache-control', 'private, max-age=3600');
  headers.set('content-disposition', 'inline');
  return r2RangeResponse(object, range, headers);
};
