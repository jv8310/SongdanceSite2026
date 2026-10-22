// POST /api/admin/unsubscribe — manually unsubscribe an address from the admin
// People view, the mirror of /api/admin/resubscribe. Puts the address on the
// local marketing suppression list (authoritative: broadcasts, lifecycle and
// course-sequence marketing all honour it) and, best-effort, unsubscribes it
// from everything in Drip. Transactional mail (order confirmations, reminders)
// still delivers, as with any unsubscribe. Admin-gated.
//
// For someone who asked by email or reply rather than through a footer link.
import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { unsubscribeEmail } from '../../../lib/email/unsubscribe';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const email = String(form?.get('email') ?? '').trim().toLowerCase();
  const returnTo = String(form?.get('return_to') ?? '/admin/people');
  // Only ever redirect back inside the admin (no open redirect).
  const safeReturn = returnTo.startsWith('/admin') ? returnTo : '/admin/people';

  if (!EMAIL_RE.test(email)) {
    return redirect(safeReturn, { flash: 'unsub_error', msg: 'Invalid email address.' });
  }

  try {
    await unsubscribeEmail(env, email, 'admin');
  } catch (err) {
    return redirect(safeReturn, { flash: 'unsub_error', msg: String(err) });
  }
  return redirect(safeReturn, { flash: 'unsub_ok', email });
};

function redirect(base: string, params: Record<string, string>): Response {
  const url = new URL(base, 'https://x');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const location = url.pathname + url.search;
  return new Response(null, { status: 303, headers: { Location: location } });
}
