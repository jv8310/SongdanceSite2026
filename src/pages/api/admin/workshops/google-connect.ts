import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { buildAuthUrl } from '../../../../lib/workshops/google-calendar';
import { googleRedirectUri, resolveOAuthApp, signState } from '../../../../lib/workshops/google-config';

export const prerender = false;

// GET → start the Google consent flow. The admin's browser carries the
// session cookie; we additionally sign a `state` to guard the callback.
export const GET: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const app = await resolveOAuthApp(env.DB, env);
  if (!app) {
    return redirect('/admin/workshops/import-google?flash=noapp');
  }
  const state = await signState(env.ADMIN_SESSION_SECRET);
  const url = buildAuthUrl(app.clientId, googleRedirectUri(env.PUBLIC_BASE_URL), state);
  return redirect(url);
};

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}
