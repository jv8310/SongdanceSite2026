import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';

export const prerender = false;

// Bulk variant of /api/admin/invitations/delete: removes many rows in
// one statement. intake_submissions is untouched, matching the single
// endpoint's behaviour.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const ids = form.getAll('ids').map((v) => String(v).trim()).filter(Boolean);
  if (ids.length === 0) return new Response('No ids', { status: 400 });

  const placeholders = ids.map(() => '?').join(',');
  const slugRow = await env.DB
    .prepare(`SELECT retreat_slug FROM intake_invitations WHERE id IN (${placeholders}) LIMIT 1`)
    .bind(...ids)
    .first<{ retreat_slug: string }>();

  const res = await env.DB
    .prepare(`DELETE FROM intake_invitations WHERE id IN (${placeholders})`)
    .bind(...ids)
    .run();

  const deleted = res.meta?.changes ?? 0;
  const params = new URLSearchParams({
    bulk: 'delete',
    deleted: String(deleted),
  });
  const anchor = slugRow ? `#retreat-${encodeURIComponent(slugRow.retreat_slug)}` : '';
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/admin/intakes/retreats?${params.toString()}${anchor}`,
    },
  });
};
