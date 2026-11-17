// POST /api/admin/live-pass/grant — "Give a free live pass" on a person's page
// (/admin/people/<email>). The same function the member app's AppBridge door
// runs (src/lib/courses/live-pass-grant.ts): a paid €0 order for the pass, its
// dates, Drip, the SD-ORDER and, when ticked, "Your live pass is confirmed".
// Admin-gated; logged as `site:<the admin's sign-in email>`. Always redirects
// back to the person's page with a flash (lp_ok / lp_err + lp_msg), anchored on
// the section.
import type { APIRoute } from 'astro';
import { getSessionEmail, readCookie, verifySession } from '../../../../lib/registrations/auth';
import { grantLivePass } from '../../../../lib/courses/live-pass-grant';

export const prerender = false;

const fmtDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const cookie = readCookie(request);
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, cookie))) return new Response('Unauthorized', { status: 401 });
  // A session from before the multi-user login carries no email; it still signs in.
  const admin = (await getSessionEmail(env.ADMIN_SESSION_SECRET, cookie)) ?? 'admin';

  const form = await request.formData().catch(() => null);
  const field = (k: string) => String(form?.get(k) ?? '').trim();
  const email = field('email').toLowerCase();
  const page = `/admin/people/${encodeURIComponent(email)}`;

  const answer = await grantLivePass(env, {
    email,
    months: Number(field('months')),
    extend: field('extend') === '1',
    notify: field('notify') === '1',
    note: field('note'),
    actor: `site:${admin}`,
  });
  if (!answer.ok) return back(page, { lp_err: '1', lp_msg: answer.message });

  const parts = [
    answer.repeated ? `Already given a moment ago: ${answer.label} (${answer.contents}), order ${answer.orderNo}.` : `Given: ${answer.label} (${answer.contents}), order ${answer.orderNo}.`,
    `It starts ${fmtDay(answer.startsOn)}.`,
    answer.extendedTo ? `Certification window open until ${fmtDay(answer.extendedTo)}.` : '',
    answer.repeated ? '' : answer.notified ? 'The confirmation email is on its way.' : 'No email was sent.',
  ];
  return back(page, { lp_ok: '1', lp_msg: parts.filter(Boolean).join(' ') });
};

function back(base: string, params: Record<string, string>): Response {
  const url = new URL(base, 'https://x');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, { status: 303, headers: { Location: `${url.pathname}${url.search}#free-live-pass` } });
}
