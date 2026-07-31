import type { APIRoute } from 'astro';
import {
  getSessionEmail,
  readCookie,
  verifySession,
} from '../../../../lib/registrations/auth';
import { sendWaitlistOffer } from '../../../../lib/registrations/waitlist-offer';
import { DEFAULT_OFFER_HOURS } from '../../../../lib/registrations/waitlist';

export const prerender = false;

// Admin: offer a freed place to one person on a retreat's waiting list.
//
// This is the button. It holds the place in that tier (so the public form
// stops selling it), emails them a claim link, and starts the clock. A failed
// send releases the hold — see sendWaitlistOffer.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const cookie = readCookie(request);
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, cookie))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const by = await getSessionEmail(env.ADMIN_SESSION_SECRET, cookie);

  const form = await request.formData();
  const entryId = parseInt(String(form.get('waitlist_id') ?? ''), 10);
  const tierId = parseInt(String(form.get('tier_id') ?? ''), 10);
  const hoursRaw = parseInt(String(form.get('hours') ?? ''), 10);
  const message = String(form.get('message') ?? '').trim() || null;
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));

  if (!Number.isFinite(entryId)) return new Response('Bad waitlist_id', { status: 400 });
  if (!Number.isFinite(tierId)) return redirect(returnTo, { wl_failed: 'pick-a-room' });

  const result = await sendWaitlistOffer(env, entryId, {
    tierId,
    hours: Number.isFinite(hoursRaw) ? hoursRaw : DEFAULT_OFFER_HOURS,
    message,
    by: by ?? undefined,
    requestOrigin: new URL(request.url).origin,
  });

  return redirect(
    returnTo,
    result.ok ? { wl_offered: '1' } : { wl_failed: result.error },
  );
};

function redirect(returnTo: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const sep = returnTo.includes('?') ? '&' : '?';
  return new Response(null, {
    status: 302,
    headers: { Location: `${returnTo}${sep}${qs}#waiting-list` },
  });
}

function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin';
}
