import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getRegistrationById, setAttendance } from '../../../../lib/workshops/db';

export const prerender = false;

// Manual attendance override from the registrant list.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const form = await request.formData();
  const rid = parseInt(String(form.get('registration_id') ?? ''), 10);
  const status = String(form.get('attendance_status') ?? '').trim();
  if (!Number.isFinite(rid) || !['registered', 'attended', 'no_show'].includes(status)) {
    return new Response('Bad request', { status: 400 });
  }
  const reg = await getRegistrationById(env.DB, rid);
  if (!reg) return new Response('Not found', { status: 404 });

  await setAttendance(env.DB, rid, status as 'registered' | 'attended' | 'no_show');
  return new Response(null, {
    status: 302,
    headers: { Location: `/admin/workshops/${reg.workshop_id}?flash=attendance` },
  });
};
