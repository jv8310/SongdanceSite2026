import type { APIRoute } from 'astro';
import {
  checkPassword,
  sessionCookieHeader,
  sessionExpiry,
  signSession,
} from '../../../lib/ads/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const form = await request.formData();
  const password = String(form.get('password') ?? '');
  // Preserve any period/compare filters the visitor arrived with, so they land
  // back on the same view after signing in.
  const next = String(form.get('next') ?? '/ads');
  const safeNext = next.startsWith('/ads') ? next : '/ads';

  if (!checkPassword(env, password)) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/ads/login?error=1' },
    });
  }
  const token = await signSession(env.ADMIN_SESSION_SECRET, sessionExpiry());
  return new Response(null, {
    status: 302,
    headers: { Location: safeNext, 'Set-Cookie': sessionCookieHeader(token) },
  });
};
