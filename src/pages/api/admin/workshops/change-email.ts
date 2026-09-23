import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getRegistrationById } from '../../../../lib/workshops/db';
import { changeRegistrantEmail } from '../../../../lib/workshops/paid-handler';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Admin action: correct a registrant's email on one workshop registration, and
// carry the change into Drip (see changeRegistrantEmail). Optionally re-sends
// the confirmation to the new address.
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
  const back = (flash: string) =>
    new Response(null, {
      status: 302,
      headers: { Location: `/admin/workshops/${reg.workshop_id}?flash=${flash}` },
    });

  const newEmail = String(form.get('new_email') ?? '').trim();
  if (!EMAIL_RE.test(newEmail)) return back('email_invalid');

  const result = await changeRegistrantEmail(env, rid, newEmail, {
    resendConfirmation: form.get('resend') === '1',
  });
  if (!result.ok) return back(result.error === 'taken' ? 'email_taken' : 'email_error');
  if (!result.changed) return back('email_same');
  return back(`email_changed_${result.drip}${result.resent ? '_resent' : ''}`);
};
