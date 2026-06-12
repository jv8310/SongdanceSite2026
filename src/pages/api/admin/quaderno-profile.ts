import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { findContactIdByEmail } from '../../../lib/registrations/quaderno';

export const prerender = false;

// "Open Quaderno profile" deep-link from the order overview. Quaderno invoices
// are created automatically by the Stripe↔Quaderno connector (we rarely store
// the invoice id), so we resolve the *contact* by email at click-time and jump
// to their Quaderno page — which lists all their invoices anyway.
export const GET: APIRoute = async ({ request, url, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const account = env.QUADERNO_ACCOUNT;
  const sandbox = env.QUADERNO_SANDBOX === '1';
  const host = sandbox
    ? `${account}.sandbox-quadernoapp.com`
    : `${account}.quadernoapp.com`;
  const email = (url.searchParams.get('email') ?? '').trim();
  const searchUrl = `https://${host}/contacts?q=${encodeURIComponent(email)}`;
  if (!email || !env.QUADERNO_API_KEY || !account) {
    return Response.redirect(`https://${host}/contacts`, 302);
  }

  try {
    const id = await findContactIdByEmail(
      { apiKey: env.QUADERNO_API_KEY, account },
      email,
    );
    const target = id ? `https://${host}/contacts/${id}` : searchUrl;
    return Response.redirect(target, 302);
  } catch {
    return Response.redirect(searchUrl, 302);
  }
};
