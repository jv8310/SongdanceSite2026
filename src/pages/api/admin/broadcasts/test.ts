// POST { id, to } → send one broadcast to a real inbox, subject-prefixed
// [Test], so the author can eyeball it before launching. Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getBroadcast } from '../../../../lib/broadcasts/db';
import { renderBroadcast } from '../../../../lib/broadcasts/email';
import { sendEmail } from '../../../../lib/workshops/resend';
import {
  MARKETING_FROM_DEFAULT,
  MARKETING_REPLY_TO_DEFAULT,
} from '../../../../lib/workshops/emails';
import { unsubscribePageUrl, unsubscribeSecret } from '../../../../lib/email/unsubscribe';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: { id?: number; to?: string };
  try {
    payload = (await request.json()) as { id?: number; to?: string };
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const to = (payload.to ?? '').trim();
  if (!EMAIL_RE.test(to)) return json({ error: 'Enter a valid email address.' }, 400);
  if (!env.RESEND_API_KEY) return json({ error: 'RESEND_API_KEY is not configured.' }, 500);

  const b = await getBroadcast(env.DB, Number(payload.id));
  if (!b) return json({ error: 'Broadcast not found.' }, 404);

  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const secret = unsubscribeSecret(env);
  const unsub = secret ? await unsubscribePageUrl(base, secret, to) : undefined;
  const firstName = to.split('@')[0] ?? 'friend';
  const content = renderBroadcast(b, { firstName, unsubscribeUrl: unsub, email: to });

  try {
    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      from: env.MARKETING_FROM || MARKETING_FROM_DEFAULT,
      replyTo: env.MARKETING_REPLY_TO || MARKETING_REPLY_TO_DEFAULT,
      to,
      subject: `[Test] ${content.subject}`,
      html: content.html,
      text: content.text,
      entityRefId: `broadcast-test-${b.id}`,
    });
  } catch (err) {
    return json({ error: `Send failed: ${String(err)}` }, 502);
  }
  return json({ ok: true });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
