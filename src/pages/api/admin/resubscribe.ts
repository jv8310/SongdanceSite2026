// POST /api/admin/resubscribe — manually re-subscribe an address from the
// admin People view. Lifts the local marketing suppression and, best-effort,
// resubscribes the address in Drip (status: active). Admin-gated.
//
// This is a deliberate, consented opt-in performed by a human operator —
// only resubscribe someone you have permission to.
import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { resubscribeEmail } from '../../../lib/email/unsubscribe';
import { isErased } from '../../../lib/contacts/erase';

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
    return redirect(safeReturn, { flash: 'resub_error', msg: 'Invalid email address.' });
  }

  // An erased address stays suppressed for good (src/lib/contacts/erase.ts).
  if (await isErased(env.DB, email)) {
    return redirect(safeReturn, { flash: 'resub_error', msg: "This address was erased. It can't be resubscribed from here." });
  }

  try {
    await resubscribeEmail(env, email);
  } catch (err) {
    return redirect(safeReturn, { flash: 'resub_error', msg: String(err) });
  }
  return redirect(safeReturn, { flash: 'resub_ok', email });
};

function redirect(base: string, params: Record<string, string>): Response {
  const url = new URL(base, 'https://x');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const location = url.pathname + url.search;
  return new Response(null, { status: 303, headers: { Location: location } });
}
