import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { logEventSafe } from '../../../../lib/registrations/db';
import {
  getEntry,
  setStatus,
  withdrawOffer,
  type WaitlistStatus,
} from '../../../../lib/registrations/waitlist';

export const prerender = false;

// Admin: move one waiting-list entry along by hand.
//
//   withdraw — take back a live offer; the hold is released and they go back
//              in the queue (used when the place went elsewhere).
//   waiting  — put someone back on the list.
//   declined — they said no. Keeps the row, frees the place.
//   booked   — they booked another way (bank transfer, by phone).
//   removed  — off the list.
//   delete   — the row goes entirely (a duplicate, a test entry).
const ACTIONS = new Set(['withdraw', 'waiting', 'declined', 'booked', 'removed', 'delete']);

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const entryId = parseInt(String(form.get('waitlist_id') ?? ''), 10);
  const action = String(form.get('action') ?? '').trim();
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));

  if (!Number.isFinite(entryId)) return new Response('Bad waitlist_id', { status: 400 });
  if (!ACTIONS.has(action)) return new Response('Bad action', { status: 400 });

  const entry = await getEntry(env.DB, entryId);
  if (!entry) return new Response('Waiting-list entry not found', { status: 404 });

  if (action === 'delete') {
    await env.DB.prepare('DELETE FROM retreat_waitlist WHERE id = ?').bind(entryId).run();
  } else if (action === 'withdraw') {
    await withdrawOffer(env.DB, entryId);
  } else {
    await setStatus(env.DB, entryId, action as WaitlistStatus);
  }

  await logEventSafe(env.DB, {
    registration_id: null,
    kind: `waitlist.${action}`,
    source: 'admin',
    payload: { waitlist_id: entryId, email: entry.email, from: entry.status },
  });

  const sep = returnTo.includes('?') ? '&' : '?';
  return new Response(null, {
    status: 302,
    headers: { Location: `${returnTo}${sep}wl_updated=1#waiting-list` },
  });
};

function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin';
}
