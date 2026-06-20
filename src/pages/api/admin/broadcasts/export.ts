// GET ?id=N → CSV of the broadcast's still-pending recipients (email,name), for
// running through an external mailbox-level validator. Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getBroadcast, pendingRecipientsForExport } from '../../../../lib/broadcasts/db';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals, url }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const id = Number(url.searchParams.get('id'));
  const b = id ? await getBroadcast(env.DB, id) : null;
  if (!b) return new Response('Broadcast not found', { status: 404 });

  const rows = await pendingRecipientsForExport(env.DB, id);
  const csv = ['email,name', ...rows.map((r) => `${csvCell(r.email)},${csvCell(r.name ?? '')}`)].join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="broadcast-${id}-pending.csv"`,
    },
  });
};

// Quote a CSV cell when it contains a comma, quote, or newline.
function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
