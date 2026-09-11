import type { APIRoute } from 'astro';
import {
  authenticate,
  clearCookieHeader,
  loginUrl,
  safeAdminNext,
  sessionCookieHeader,
  sessionExpiry,
  signSession,
} from '../../../lib/registrations/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const form = await request.formData();

  // Sign out. The button posts `_method=DELETE` (an HTML form can't send a
  // real DELETE) — nothing was reading it, so signing out ran this login
  // handler with no credentials: it answered "Incorrect email or password"
  // and left the cookie in place, i.e. you stayed signed in. Now that a
  // session renews itself on every admin page (src/middleware.ts), this is
  // the only way to end one, so it has to work.
  if (String(form.get('_method') ?? '').toUpperCase() === 'DELETE') {
    return signOut();
  }

  const email = String(form.get('email') ?? '');
  const password = String(form.get('password') ?? '');
  // Where they were headed before the login form interrupted them (a form
  // POST on a lapsed session — see src/middleware.ts). Sanitised to an in-site
  // admin path, defaulting to /admin.
  const next = safeAdminNext(String(form.get('next') ?? ''));

  const subject = authenticate(env, email, password);
  if (!subject) {
    // Keep the destination across a mistyped password.
    const retry = new URL(loginUrl(next), 'https://songdance.co');
    retry.searchParams.set('error', '1');
    return new Response(null, {
      status: 302,
      headers: { Location: `${retry.pathname}${retry.search}` },
    });
  }
  const exp = sessionExpiry();
  const token = await signSession(env.ADMIN_SESSION_SECRET, exp, subject);
  return new Response(null, {
    status: 302,
    headers: {
      Location: next,
      'Set-Cookie': sessionCookieHeader(token),
    },
  });
};

export const DELETE: APIRoute = async () => signOut();

function signOut(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/admin/login',
      'Set-Cookie': clearCookieHeader(),
    },
  });
}
