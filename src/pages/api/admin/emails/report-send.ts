// POST { kind: 'daily'|'weekly', date?: 'YYYY-MM-DD', to?: string } → force-send
// an internal SD-REPORT digest with REAL data for that window (from /admin/emails,
// "Reports" group). Admin-gated. This is the on-demand escape hatch for a digest
// the cron dropped — it ignores the once-per-day claim, so it always sends.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { sendReportNow } from '../../../../lib/workshops/reports';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: { kind?: string; date?: string; to?: string };
  try {
    payload = (await request.json()) as { kind?: string; date?: string; to?: string };
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const kind = payload.kind === 'weekly' ? 'weekly' : 'daily';
  const date = (payload.date ?? '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: 'Date must be YYYY-MM-DD.' }, 400);
  }

  // Optional recipient override; blank → the usual REPORTS_TO chain.
  const toRaw = (payload.to ?? '').trim();
  let to: string[] | undefined;
  if (toRaw) {
    to = toRaw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!to.length || to.some((a) => !EMAIL_RE.test(a))) {
      return json({ error: 'Enter valid email address(es).' }, 400);
    }
  }

  try {
    const res = await sendReportNow(env, { kind, date: date || undefined, to });
    return json({ ok: true, ...res });
  } catch (err) {
    return json({ error: `Send failed: ${String(err)}` }, 502);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
