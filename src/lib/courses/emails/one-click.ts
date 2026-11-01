// RFC 8058 one-click for the course sequence emails — the POST a mail client
// sends to the List-Unsubscribe URL on every weekly Authentic Singing Journey
// email and every 12-week / certification note
// (/api/courses/emails/stop?t=<enrolment id>.<sig>). It stops THAT series only:
// never an unsubscribe from Songdance, never the course.
//
// Answered in src/worker-entrypoint.ts BEFORE the request reaches Astro, for the
// same reason as src/lib/email/one-click.ts: Astro's origin check 403s a
// form-encoded POST with no Origin header, which is what Gmail's one-click POST
// is. src/pages/api/courses/emails/stop.ts runs the same function for `astro
// dev` and as a fallback.

import { verifySequenceToken } from './stop-link';
import { stopEnrolment } from './sequences';

export type SequenceOneClickEnv = {
  DB: D1Database;
  ADMIN_SESSION_SECRET?: string;
};

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function handleSequenceOneClick(request: Request, env: SequenceOneClickEnv): Promise<Response> {
  const url = new URL(request.url);
  let token = (url.searchParams.get('t') ?? '').trim();
  // The token lives in the header URL's query string; tolerate a client that
  // puts it in the (form-encoded) body instead.
  if (!token) {
    try {
      token = (new URLSearchParams(await request.text()).get('t') ?? '').trim();
    } catch {
      // unreadable body — fall through to validation
    }
  }
  const id = env.ADMIN_SESSION_SECRET ? await verifySequenceToken(env.ADMIN_SESSION_SECRET, token) : null;
  if (!id) return text('Invalid link.', 400);
  await stopEnrolment(env.DB, id, 'one-click').catch(() => false);
  return text('These emails are stopped.');
}
