// GET /api/admin/people-search?q=… — the admin ⌘K palette's lookup
// (src/lib/admin/people-search.ts). Admin-gated, read-only. Each hit also
// carries what the member app holds for that address (account + open courses),
// asked in one call over the APP_ADMIN binding; an app that does not answer
// (local dev, or deployed before accessSummaries) leaves `app` null.
import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { searchPeople } from '../../../lib/admin/people-search';
import { askApp } from '../../../lib/admin/app-access';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GET: APIRoute = async ({ request, locals, url }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const q = (url.searchParams.get('q') ?? '').slice(0, 100);
  const hits = await searchPeople(env.DB, q);
  // A whole address the site has no row for may still be a member of the app.
  const typed = q.trim().toLowerCase();
  const typedUnknown = EMAIL_RE.test(typed) && !hits.some((h) => h.email === typed) ? typed : null;
  const emails = [...hits.map((h) => h.email), ...(typedUnknown ? [typedUnknown] : [])];
  const app = emails.length ? await askApp(env, (a) => a.accessSummaries({ emails })) : null;
  const byEmail = new Map(app?.ok ? app.data.map((s) => [s.email, s]) : []);
  const line = (email: string) => {
    const s = byEmail.get(email);
    return s ? { account: !!s.account, role: s.account?.role ?? null, courses: s.courses } : null;
  };
  const people = hits.map((h) => ({ ...h, app: line(h.email) }));
  return new Response(JSON.stringify({ people, typedApp: typedUnknown ? line(typedUnknown) : null }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
