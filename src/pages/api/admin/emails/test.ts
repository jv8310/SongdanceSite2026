// POST { id, to } → send one sample lifecycle email (from /admin/emails) to a
// real inbox, subject-prefixed [Test]. Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { buildEmailSamples } from '../../../../lib/workshops/email-samples';
import { sendEmail } from '../../../../lib/workshops/resend';
import { MARKETING_FROM } from '../../../../lib/workshops/emails';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: { id?: string; to?: string };
  try {
    payload = (await request.json()) as { id?: string; to?: string };
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const to = (payload.to ?? '').trim();
  if (!EMAIL_RE.test(to)) return json({ error: 'Enter a valid email address.' }, 400);

  const sample = buildEmailSamples(env.PUBLIC_BASE_URL).find((s) => s.id === payload.id);
  if (!sample) return json({ error: 'Unknown email id.' }, 404);
  if (!env.RESEND_API_KEY) return json({ error: 'RESEND_API_KEY is not configured.' }, 500);

  try {
    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      from: MARKETING_FROM,
      replyTo: env.RESEND_REPLY_TO,
      to,
      subject: `[Test] ${sample.content.subject}`,
      html: sample.content.html,
      text: sample.content.text,
      entityRefId: `email-preview-${sample.id}`,
    });
  } catch (err) {
    return json({ error: `Send failed: ${String(err)}` }, 502);
  }
  return json({ ok: true });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
