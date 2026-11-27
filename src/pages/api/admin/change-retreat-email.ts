import type { APIRoute } from 'astro';
import { getSessionEmail, readCookie, verifySession } from '../../../lib/registrations/auth';
import { changeRetreatEmail } from '../../../lib/registrations/change-email';

export const prerender = false;

// Admin action: correct the email address on one retreat booking. The
// retreat's intake (invitation, submission, travel answers) and the Drip
// subscriber follow; see lib/registrations/change-email.ts.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const cookie = readCookie(request);
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, cookie))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const form = await request.formData();
  const id = parseInt(String(form.get('registration_id') ?? ''), 10);
  if (!Number.isFinite(id)) return new Response('Bad registration_id', { status: 400 });
  const raw = String(form.get('return_to') ?? '');
  const returnTo = raw.startsWith('/admin/') ? raw : '/admin';
  const back = (code: string) =>
    new Response(null, {
      status: 302,
      headers: { Location: `${returnTo}${returnTo.includes('?') ? '&' : '?'}email_change=${code}` },
    });

  const actor = (await getSessionEmail(env.ADMIN_SESSION_SECRET, cookie)) ?? 'admin';
  const result = await changeRetreatEmail(env, id, String(form.get('new_email') ?? ''), `admin:${actor}`);
  if (!result.ok) return back(result.error);
  return back(`done_${result.drip}${result.intakeMoved ? '_intake' : ''}`);
};
