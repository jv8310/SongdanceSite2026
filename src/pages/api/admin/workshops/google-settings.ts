import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  disconnectGoogle,
  saveCalendarId,
  saveOAuthApp,
} from '../../../../lib/workshops/google-config';

export const prerender = false;

const SETTINGS = '/admin/settings/calendar-sync';

// Save the OAuth app credentials / chosen calendar, or disconnect. Submitted
// as form posts from the import-google settings page.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const action = String(form.get('action') ?? '').trim();

  if (action === 'save_app') {
    const clientId = String(form.get('client_id') ?? '').trim();
    const clientSecret = String(form.get('client_secret') ?? '').trim();
    if (!clientId || !clientSecret) return redirect(`${SETTINGS}?flash=appmissing`);
    await saveOAuthApp(env.DB, clientId, clientSecret);
    return redirect(`${SETTINGS}?flash=appsaved`);
  }

  if (action === 'set_calendar') {
    const calendarId = String(form.get('calendar_id') ?? '').trim();
    if (!calendarId) return redirect(`${SETTINGS}?flash=nocal`);
    await saveCalendarId(env.DB, calendarId);
    return redirect(`${SETTINGS}?flash=calsaved`);
  }

  if (action === 'disconnect') {
    await disconnectGoogle(env.DB);
    return redirect(`${SETTINGS}?flash=disconnected`);
  }

  return redirect(SETTINGS);
};

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}
