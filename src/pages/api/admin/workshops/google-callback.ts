import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { exchangeCodeForTokens } from '../../../../lib/workshops/google-calendar';
import {
  googleRedirectUri,
  resolveOAuthApp,
  saveRefreshToken,
  verifyState,
} from '../../../../lib/workshops/google-config';
import { logEvent } from '../../../../lib/registrations/db';

export const prerender = false;

const SETTINGS = '/admin/workshops/import-google';

// Google redirects the admin's browser back here with ?code & ?state. We
// verify the admin session + signed state, exchange the code for a refresh
// token, and persist it.
export const GET: APIRoute = async ({ request, url, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const error = url.searchParams.get('error');
  if (error) return redirect(`${SETTINGS}?flash=denied`);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !(await verifyState(env.ADMIN_SESSION_SECRET, state))) {
    return redirect(`${SETTINGS}?flash=badstate`);
  }

  const app = await resolveOAuthApp(env.DB, env);
  if (!app) return redirect(`${SETTINGS}?flash=noapp`);

  try {
    const { refreshToken } = await exchangeCodeForTokens(
      app.clientId,
      app.clientSecret,
      code,
      googleRedirectUri(env.PUBLIC_BASE_URL),
    );
    if (!refreshToken) {
      // Google only returns a refresh token on first consent unless we force
      // prompt=consent (we do). If it's still missing, the existing grant must
      // be revoked at myaccount.google.com → Security → Third-party access.
      return redirect(`${SETTINGS}?flash=norefresh`);
    }
    await saveRefreshToken(env.DB, refreshToken);
  } catch (err) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.google.connect.error', payload: { error: String(err) } });
    return redirect(`${SETTINGS}?flash=exchangefail`);
  }

  return redirect(`${SETTINGS}?flash=connected`);
};

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}
