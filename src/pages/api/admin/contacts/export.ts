// GET → CSV of every sendable contact (the whole list minus suppressions), for
// running through a mailbox-level bounce-checker (NeverBounce, ZeroBounce,
// Bouncer, …). Reimport the undeliverable results via /admin/contacts. The
// dead-domain cleaner only catches whole dead domains; this covers dead
// mailboxes at live providers. Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { sendableContactsForExport } from '../../../../lib/broadcasts/db';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const rows = await sendableContactsForExport(env.DB);
  const csv = ['email,name', ...rows.map((r) => `${csvCell(r.email)},${csvCell(r.name ?? '')}`)].join('\n');
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="contacts-sendable-${stamp}.csv"`,
    },
  });
};

// Quote a CSV cell when it contains a comma, quote, or newline.
function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
