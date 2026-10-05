import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { runCertAccessDripSync } from '../../../../lib/courses/cert-access-drip';

export const prerender = false;

// "Push to Drip now" on /admin/courses/cert-access — the same sweep the hourly
// cron runs, with a wider cap, and it always re-reads the prod_SVH_9m /
// prod_CEEE-25 roster from Drip first (the cron does that twice a day).
// Idempotent per (student, end date), so pressing it twice is harmless.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  let flash = 'ok';
  let msg: string;
  try {
    const r = await runCertAccessDripSync(env as any, { cap: 100, refresh: true });
    const rosterNote = r.refreshError ? ` (Could not re-read the Drip tags: ${r.refreshError})` : '';
    if (r.skipped) {
      flash = 'err';
      msg = 'Drip is not configured in this environment.';
    } else if (r.failed) {
      flash = 'err';
      msg = `Pushed ${r.sent} to Drip; ${r.failed} failed (logged as cert.access.drip_error) — press again to retry.`;
    } else {
      msg = r.sent
        ? `Pushed ${r.sent} student(s) to Drip.${r.remaining ? ` ${r.remaining} still to go — press again.` : ''}`
        : 'Everyone is already in Drip with their current end date.';
    }
    msg += rosterNote;
    if (r.refreshError) flash = 'err';
  } catch (err) {
    flash = 'err';
    msg = `Could not push to Drip: ${String(err).slice(0, 140)}`;
  }

  const qs = new URLSearchParams({ flash, msg });
  return new Response(null, {
    status: 302,
    headers: { Location: `/admin/courses/cert-access?${qs}` },
  });
};
