// RFC 8058 one-click target for the course sequence emails — the
// List-Unsubscribe header on every weekly Authentic Singing Journey email and
// every 12-week / certification onboarding note points here. A mail client's
// "Unsubscribe" POSTs (body "List-Unsubscribe=One-Click") with no UI, and that
// stops THIS series only — never an unsubscribe from Songdance, never the
// course. A human who GETs the URL is sent to the /courses/emails page.

import type { APIRoute } from 'astro';
import { verifySequenceToken, SEQUENCE_STOP_PATH } from '../../../../lib/courses/emails/stop-link';
import { stopEnrolment } from '../../../../lib/courses/emails/sequences';

export const prerender = false;

export const POST: APIRoute = async ({ request, url, locals }) => {
  const env = locals.runtime.env;
  let token = (url.searchParams.get('t') ?? '').trim();
  if (!token) {
    try {
      const form = await request.formData();
      token = String(form.get('t') ?? '').trim();
    } catch {
      // not form-encoded — fall through to validation
    }
  }
  const id = env.ADMIN_SESSION_SECRET ? await verifySequenceToken(env.ADMIN_SESSION_SECRET, token) : null;
  if (!id) return new Response('Invalid link.', { status: 400 });
  await stopEnrolment(env.DB, id, 'one-click').catch(() => false);
  return new Response('These emails are stopped.', { status: 200 });
};

export const GET: APIRoute = async ({ url }) => {
  const t = url.searchParams.get('t') ?? '';
  return new Response(null, {
    status: 302,
    headers: { Location: `${SEQUENCE_STOP_PATH}?t=${encodeURIComponent(t)}` },
  });
};
