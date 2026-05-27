import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';

export const prerender = false;

// Permanently delete an intake submission. Used to clean up tests and
// accidental duplicates from the admin intakes index/detail view.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const form = await request.formData();
  const id = String(form.get('id') ?? '').trim();
  if (!id) return new Response('Bad id', { status: 400 });
  const returnTo = safeReturnTo(String(form.get('return_to') ?? '/admin/intakes'));

  await env.DB.prepare(`DELETE FROM intake_submissions WHERE id = ?`).bind(id).run();

  return new Response(null, {
    status: 302,
    headers: { Location: returnTo },
  });
};

function safeReturnTo(raw: string): string {
  // Never redirect back to the now-deleted detail page.
  if (raw.startsWith('/admin/intakes/') && raw !== '/admin/intakes/') {
    return '/admin/intakes';
  }
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin/intakes';
}
