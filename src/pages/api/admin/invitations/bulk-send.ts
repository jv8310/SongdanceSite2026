import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getRetreat, type RetreatRow } from '../../../../lib/intake/retreats-db';
import type { InvitationRow } from '../../../../lib/intake/invitations';
import { isIntakeEmailKind, sendIntakeEmails } from '../../../../lib/intake/send';

export const prerender = false;

// Bulk variant of /api/admin/invitations/send: accepts many `ids` and one
// `kind`. Sends are paced under Resend's rate limit (lib/intake/send.ts), and
// each success stamps its own timestamp column. Already-submitted rows are
// skipped for the screening emails.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const ids = form.getAll('ids').map((v) => String(v).trim()).filter(Boolean);
  const kind = String(form.get('kind') ?? '').trim();
  if (ids.length === 0) return new Response('No ids', { status: 400 });
  if (!isIntakeEmailKind(kind)) return new Response('Bad kind', { status: 400 });
  if (!env.RESEND_API_KEY) return new Response('RESEND_API_KEY missing', { status: 500 });

  const placeholders = ids.map(() => '?').join(',');
  const rowsQ = await env.DB
    .prepare(`SELECT * FROM intake_invitations WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<InvitationRow>();
  const rows = rowsQ.results ?? [];
  if (rows.length === 0) return new Response('No invitations found', { status: 404 });

  const retreatCache = new Map<string, RetreatRow | null>();
  const result = await sendIntakeEmails(env, {
    invitations: rows,
    kind,
    baseUrl: env.PUBLIC_BASE_URL || new URL(request.url).origin,
    retreatFor: async (slug) => {
      if (!retreatCache.has(slug)) retreatCache.set(slug, await getRetreat(env.DB, slug));
      return retreatCache.get(slug) ?? null;
    },
  });

  const retreatSlug = rows[0]!.retreat_slug;
  const params = new URLSearchParams({
    bulk: 'send',
    kind,
    sent: String(result.sent),
    failed: String(result.failed),
    skipped: String(result.skipped),
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/admin/intakes/retreats?${params.toString()}#retreat-${encodeURIComponent(retreatSlug)}`,
    },
  });
};
