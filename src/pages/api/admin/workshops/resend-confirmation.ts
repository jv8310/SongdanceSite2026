import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getRegistrationById } from '../../../../lib/workshops/db';
import { resendConfirmation } from '../../../../lib/workshops/paid-handler';

export const prerender = false;

// Admin action: re-send the confirmation email to a registrant. It carries a
// fresh ?t=<token> join link — handy for anyone whose original link predates
// the rid→token switch. Idempotency-bypassing on purpose (see resendConfirmation).
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const form = await request.formData();
  const rid = parseInt(String(form.get('registration_id') ?? ''), 10);
  if (!Number.isFinite(rid)) return new Response('Bad request', { status: 400 });

  const reg = await getRegistrationById(env.DB, rid);
  if (!reg) return new Response('Not found', { status: 404 });

  const result = await resendConfirmation(env, rid);
  const flash = result.ok ? 'resent' : 'resend_error';
  return new Response(null, {
    status: 302,
    headers: { Location: `/admin/workshops/${reg.workshop_id}?flash=${flash}` },
  });
};
