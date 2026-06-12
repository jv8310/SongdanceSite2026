import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { getSubscriber } from '../../../lib/registrations/drip';

export const prerender = false;

// "Open Drip profile" deep-link from the order overview. We resolve the
// subscriber id by email at click-time (one cheap API call) and 302 to the
// Drip app, falling back to the subscribers index when the address is unknown.
export const GET: APIRoute = async ({ request, url, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const account = env.DRIP_ACCOUNT_ID;
  const email = (url.searchParams.get('email') ?? '').trim();
  const indexUrl = `https://www.getdrip.com/${account}/subscribers`;
  if (!email || !env.DRIP_API_TOKEN || !account) {
    return Response.redirect(indexUrl, 302);
  }

  try {
    const sub = await getSubscriber(
      { apiToken: env.DRIP_API_TOKEN, accountId: account },
      email,
    );
    const target = sub?.id
      ? `https://www.getdrip.com/${account}/subscribers/${encodeURIComponent(sub.id)}`
      : indexUrl;
    return Response.redirect(target, 302);
  } catch {
    return Response.redirect(indexUrl, 302);
  }
};
