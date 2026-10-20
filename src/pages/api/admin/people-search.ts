// GET /api/admin/people-search?q=… — the admin ⌘K palette's lookup
// (src/lib/admin/people-search.ts). Admin-gated, read-only.
import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { searchPeople } from '../../../lib/admin/people-search';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals, url }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const q = (url.searchParams.get('q') ?? '').slice(0, 100);
  const people = await searchPeople(env.DB, q);
  return new Response(JSON.stringify({ people }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
