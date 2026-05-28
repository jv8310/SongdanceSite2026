import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getInvitationById } from '../../../../lib/intake/invitations';

export const prerender = false;

// Remove an invitee. Doesn't touch intake_submissions — if they
// already filled in the form their row stays in the assessor flow.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const id = String(form.get('id') ?? '').trim();
  if (!id) return new Response('Bad id', { status: 400 });

  const invitation = await getInvitationById(env.DB, id);
  if (!invitation) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/admin/intakes/retreats' },
    });
  }

  await env.DB
    .prepare(`DELETE FROM intake_invitations WHERE id = ?`)
    .bind(id)
    .run();

  return new Response(null, {
    status: 302,
    headers: {
      Location: `/admin/intakes/retreats#retreat-${encodeURIComponent(invitation.retreat_slug)}`,
    },
  });
};
