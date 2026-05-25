import type { APIRoute } from 'astro';
import {
  clearCookieHeader,
  sessionCookieHeader,
  sessionExpiry,
  signSession,
} from '../../../lib/registrations/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const form = await request.formData();
  const password = String(form.get('password') ?? '');
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/admin/login?error=1' },
    });
  }
  const exp = sessionExpiry();
  const token = await signSession(env.ADMIN_SESSION_SECRET, exp);
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/admin',
      'Set-Cookie': sessionCookieHeader(token),
    },
  });
};

export const DELETE: APIRoute = async () =>
  new Response(null, {
    status: 302,
    headers: {
      Location: '/admin/login',
      'Set-Cookie': clearCookieHeader(),
    },
  });
