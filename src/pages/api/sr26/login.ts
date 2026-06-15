import type { APIRoute } from 'astro';
import {
  sessionCookieHeader,
  sessionExpiry,
  signSession,
} from '../../../lib/registrations/auth';
import { safeNext } from '../../../lib/sr26/gate';

export const prerender = false;

// Validate against the shared ADMIN_PASSWORD and issue the same HMAC-signed
// `sd_admin` session cookie the admin area uses — so the two stay in sync.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const form = await request.formData();
  const password = String(form.get('password') ?? '');
  const next = safeNext(String(form.get('next') ?? ''));

  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    const back =
      next === '/sr26'
        ? '/sr26?error=1'
        : `/sr26?error=1&next=${encodeURIComponent(next)}`;
    return new Response(null, { status: 302, headers: { Location: back } });
  }

  const token = await signSession(env.ADMIN_SESSION_SECRET, sessionExpiry());
  return new Response(null, {
    status: 302,
    headers: {
      Location: next,
      'Set-Cookie': sessionCookieHeader(token),
    },
  });
};
