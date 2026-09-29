import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getRetreat } from '../../../../lib/intake/retreats-db';
import { getInvitationById } from '../../../../lib/intake/invitations';
import { isIntakeEmailKind, sendIntakeEmail } from '../../../../lib/intake/send';

export const prerender = false;

// Manually send one of { invitation, reminder, final, transport } for a single
// invitee. On success the matching timestamp column is filled in so the admin
// UI can show "sent on …" and move on.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const id = String(form.get('id') ?? '').trim();
  const kind = String(form.get('kind') ?? '').trim();
  if (!id) return new Response('Bad id', { status: 400 });
  if (!isIntakeEmailKind(kind)) return new Response('Bad kind', { status: 400 });

  const invitation = await getInvitationById(env.DB, id);
  if (!invitation) return new Response('Invitation not found', { status: 404 });

  const retreat = await getRetreat(env.DB, invitation.retreat_slug);
  if (!retreat) return new Response('Retreat not found', { status: 404 });

  const sent = await sendIntakeEmail(env, {
    invitation,
    retreat,
    kind,
    baseUrl: env.PUBLIC_BASE_URL || new URL(request.url).origin,
  });
  if (!sent.ok) {
    // Already filled in their intake — nothing was sent, on purpose.
    if (sent.error === 'already-submitted') {
      return new Response('Already submitted', { status: 409 });
    }
    if (sent.error === 'resend-key-missing') {
      return new Response('RESEND_API_KEY missing', { status: 500 });
    }
    return new Response(`Send failed: ${sent.error}`, { status: 502 });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: `/admin/intakes/retreats#retreat-${encodeURIComponent(invitation.retreat_slug)}`,
    },
  });
};
