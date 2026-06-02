import type { APIRoute } from 'astro';
import { checkVerificationCode, setVerificationCode } from '../../../lib/workshops/db';
import { sendEmail } from '../../../lib/workshops/resend';
import { verificationEmail } from '../../../lib/workshops/emails';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Optional email-verification step. The registration flow doesn't require it,
// but it's available: POST { email, action:'send' } mails a 6-digit code;
// POST { email, code, action:'check' } verifies it.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  let body: { email?: string; code?: string; action?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const email = (body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: 'Enter a valid email.' }, 400);

  if (body.action === 'check') {
    const ok = await checkVerificationCode(env.DB, email, (body.code ?? '').trim());
    return json({ ok });
  }

  // Default: send a code.
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await setVerificationCode(env.DB, email, code, 15);
  if (env.RESEND_API_KEY) {
    const content = verificationEmail(code);
    try {
      await sendEmail({
        apiKey: env.RESEND_API_KEY,
        replyTo: env.RESEND_REPLY_TO,
        to: email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        entityRefId: `workshop-verify-${email}`,
      });
    } catch (err) {
      return json({ error: 'Could not send the code right now.' }, 502);
    }
  }
  return json({ ok: true });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
