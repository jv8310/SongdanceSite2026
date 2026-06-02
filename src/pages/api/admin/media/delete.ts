import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';

export const prerender = false;

// Delete a media object from R2. The caller confirms in the UI; we don't check
// whether an event card still references it, so the manager warns about that.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const form = await request.formData();
  const key = String(form.get('key') ?? '').trim();
  if (!key) return json({ error: 'key is required' }, 400);

  await env.MEDIA.delete(key);
  return json({ ok: true });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
