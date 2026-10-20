// GET /api/admin/app-certificate?email=… — the certificate the member app holds
// for one person, so the admin can look at what was added from their People
// page ("App access" → Certification, src/lib/admin/app-access.ts). The file
// lives in the app's private bucket; the app hands it over through the
// APP_ADMIN binding. Admin-gated; shown in the browser, never cached.
import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { askApp } from '../../../lib/admin/app-access';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GET: APIRoute = async ({ request, locals, url }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) return new Response('Unauthorized', { status: 401 });
  const email = (url.searchParams.get('email') ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return new Response('Invalid email address.', { status: 400 });
  const r = await askApp(env, (app) => app.certificate({ email }));
  if (!r.ok) return new Response(r.message, { status: r.error === 'no-certificate' ? 404 : 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const type = ['application/pdf', 'image/jpeg', 'image/png'].includes(r.data.contentType) ? r.data.contentType : 'application/octet-stream';
  const ascii = r.data.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(r.data.bytes, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(r.data.filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
