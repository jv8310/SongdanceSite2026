// POST /api/admin/people/lift-import-suppressions — reconcile a bulk Drip
// import that wrongly suppressed a whole segment. Deletes ONLY the suppression
// rows the contact import created from a CSV `status` = "unsubscribed" column
// (reason 'unsubscribe', source 'import'), so those addresses can receive
// marketing again. Everything else on the list is left untouched: genuine
// unsubscribes made through our own email links (source 'link'/'one_click'),
// admin unsubscribes, hard bounces, spam complaints, dead domains and
// verifier-invalids all stay suppressed.
//
// Surgical and re-runnable. It does NOT send any email and does NOT resubscribe
// in Drip (Drip is tag-only now) — it only lifts the local marketing gate.
// Admin-gated. Only lift a segment you have the standing to email.
import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const returnTo = String(form?.get('return_to') ?? '/admin/people');
  // Only ever redirect back inside the admin (no open redirect).
  const safeReturn = returnTo.startsWith('/admin') ? returnTo : '/admin/people';

  try {
    const res = await env.DB
      .prepare(
        `DELETE FROM email_suppressions WHERE reason = 'unsubscribe' AND source = 'import'`,
      )
      .run();
    const n = res.meta?.changes ?? 0;
    return redirect(safeReturn, { flash: 'lift_ok', n: String(n) });
  } catch (err) {
    return redirect(safeReturn, { flash: 'lift_error', msg: String(err) });
  }
};

function redirect(base: string, params: Record<string, string>): Response {
  const url = new URL(base, 'https://x');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const location = url.pathname + url.search;
  return new Response(null, { status: 303, headers: { Location: location } });
}
