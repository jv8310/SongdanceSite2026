import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getRetreat } from '../../../../lib/intake/retreats-db';
import {
  buildInvitationEmail,
  getInvitationById,
  timestampColumnFor,
  type InvitationKind,
} from '../../../../lib/intake/invitations';

export const prerender = false;

const DEFAULT_FROM = 'Songdance <intakes@mail.songdance.co>';

// Manually send one of { invitation, reminder, final } for a single
// invitee. On success the matching timestamp column is filled in so
// the admin UI can show "sent on …" and move on.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const id = String(form.get('id') ?? '').trim();
  const kindRaw = String(form.get('kind') ?? '').trim();
  if (!id) return new Response('Bad id', { status: 400 });
  if (kindRaw !== 'invitation' && kindRaw !== 'reminder' && kindRaw !== 'final') {
    return new Response('Bad kind', { status: 400 });
  }
  const kind = kindRaw as InvitationKind;

  const invitation = await getInvitationById(env.DB, id);
  if (!invitation) return new Response('Invitation not found', { status: 404 });
  if (invitation.submitted_at) {
    // Already filled in their intake — don't send anything.
    return new Response('Already submitted', { status: 409 });
  }

  const retreat = await getRetreat(env.DB, invitation.retreat_slug);
  if (!retreat) return new Response('Retreat not found', { status: 404 });

  const locale = retreat.invite_locale === 'en' ? 'en' : 'nl';
  const baseUrl = env.PUBLIC_BASE_URL || new URL(request.url).origin;
  const link = `${baseUrl.replace(/\/+$/, '')}/intake?event=${encodeURIComponent(invitation.retreat_slug)}&inv=${encodeURIComponent(invitation.token)}`;

  const email = buildInvitationEmail({
    kind,
    locale,
    vars: {
      first_name: invitation.first_name,
      event_name: retreat.name,
      link,
    },
  });

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return new Response('RESEND_API_KEY missing', { status: 500 });
  }
  const from = env.RESEND_INTAKES_FROM ?? DEFAULT_FROM;

  const sent = await sendViaResend({
    apiKey,
    from,
    to: invitation.email,
    replyTo: 'jacob@songdance.co',
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  if (!sent.ok) {
    return new Response(`Resend failed: ${sent.error}`, { status: 502 });
  }

  const col = timestampColumnFor(kind);
  await env.DB
    .prepare(`UPDATE intake_invitations SET ${col} = datetime('now') WHERE id = ?`)
    .bind(id)
    .run();

  return new Response(null, {
    status: 302,
    headers: {
      Location: `/admin/intakes/retreats#retreat-${encodeURIComponent(invitation.retreat_slug)}`,
    },
  });
};

async function sendViaResend(args: {
  apiKey: string;
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        from: args.from,
        to: [args.to],
        reply_to: args.replyTo,
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: `resend-${res.status}: ${errText.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.includes('abort') ? 'timeout' : msg.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}
