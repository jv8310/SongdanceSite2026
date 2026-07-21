import type { APIRoute } from 'astro';
import { getAlbum } from '../../../lib/music/db';
import {
  hasAlbumAccess,
  listenerCookieHeader,
  signListener,
} from '../../../lib/music/access';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST { album, email, hp } → { ok, granted }
//
// The email gate on /music/<album>. Same trust model as /access: the album's
// buyers carry its Drip tag, so the purchase email is the login. When the tag
// checks out we set the signed sd_music cookie (30 days) and the page reloads
// into the player. `granted: false` is a normal answer (unknown email, or one
// without the tag) — the page shows a gentle "check the email you used at
// checkout" note, never an error.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  let body: { album?: string; email?: string; hp?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { ok: false, error: 'bad-json' });
  }

  // Honeypot: pretend nothing was found so bots move on.
  if (typeof body.hp === 'string' && body.hp.trim() !== '') {
    return json(200, { ok: true, granted: false });
  }

  const email = (body.email ?? '').toString().trim().slice(0, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return json(400, { ok: false, error: 'bad-email' });

  const albumId = (body.album ?? '').toString().trim().slice(0, 80);
  const album = albumId ? await getAlbum(env.DB, albumId) : null;
  if (!album || album.published !== 1) return json(404, { ok: false, error: 'unknown-album' });

  const granted = await hasAlbumAccess(env, email, album);
  if (!granted) return json(200, { ok: true, granted: false });

  const token = await signListener(env.ADMIN_SESSION_SECRET, email);
  return json(200, { ok: true, granted: true }, { 'Set-Cookie': listenerCookieHeader(token) });
};

function json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
