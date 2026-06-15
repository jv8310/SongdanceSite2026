// RFC 8058 one-click unsubscribe target — referenced from the
// List-Unsubscribe header on marketing-flavoured sends. Mail clients POST
// here (body: "List-Unsubscribe=One-Click") with no UI; humans who somehow
// GET this URL are sent to the /unsubscribe confirm page instead.

import type { APIRoute } from 'astro';
import {
  unsubscribeEmail,
  unsubscribeSecret,
  verifyUnsubscribeToken,
} from '../../lib/email/unsubscribe';

export const prerender = false;

export const POST: APIRoute = async ({ request, url, locals }) => {
  const env = locals.runtime.env;
  const secret = unsubscribeSecret(env);

  // Params live in the query string of the header URL; tolerate clients that
  // put them in the form body instead.
  let email = (url.searchParams.get('e') ?? '').trim().toLowerCase();
  let token = (url.searchParams.get('t') ?? '').trim();
  if (!email || !token) {
    try {
      const form = await request.formData();
      email = email || String(form.get('e') ?? '').trim().toLowerCase();
      token = token || String(form.get('t') ?? '').trim();
    } catch {
      // not form-encoded — fall through to validation
    }
  }

  if (!secret || !(await verifyUnsubscribeToken(secret, email, token))) {
    return new Response('Invalid unsubscribe link.', { status: 400 });
  }
  await unsubscribeEmail(env, email, 'one_click');
  return new Response('You are unsubscribed.', { status: 200 });
};

export const GET: APIRoute = async ({ url }) => {
  const e = url.searchParams.get('e') ?? '';
  const t = url.searchParams.get('t') ?? '';
  return new Response(null, {
    status: 302,
    headers: { Location: `/unsubscribe?e=${encodeURIComponent(e)}&t=${encodeURIComponent(t)}` },
  });
};
