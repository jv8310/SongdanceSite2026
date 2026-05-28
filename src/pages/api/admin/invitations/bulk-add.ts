import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getRetreat } from '../../../../lib/intake/retreats-db';
import { genToken, genUuid, parseBulkInvitees } from '../../../../lib/intake/invitations';

export const prerender = false;

// Add invitees to a retreat from the admin form. Accepts pasted blob
// (one entry per line — "First Last <email>", "First, email", or just
// "email"). Duplicates (same retreat + email) are skipped silently so
// re-pasting the same list is safe.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const slug = String(form.get('retreat_slug') ?? '').trim();
  const raw = String(form.get('invitees') ?? '');
  const returnTo = `/admin/intakes/retreats#retreat-${encodeURIComponent(slug)}`;

  if (!slug) return new Response('Bad retreat_slug', { status: 400 });

  const retreat = await getRetreat(env.DB, slug);
  if (!retreat) return new Response('Retreat not found', { status: 404 });

  const parsed = parseBulkInvitees(raw);
  if (parsed.length === 0) return redirect(returnTo);

  // Read existing emails for this retreat so we silently skip
  // duplicates instead of erroring on the UNIQUE constraint.
  const existing = await env.DB
    .prepare(`SELECT email FROM intake_invitations WHERE retreat_slug = ?`)
    .bind(slug)
    .all<{ email: string }>();
  const seen = new Set((existing.results ?? []).map((r) => r.email.toLowerCase()));

  for (const p of parsed) {
    if (seen.has(p.email)) continue;
    seen.add(p.email);
    await env.DB
      .prepare(
        `INSERT INTO intake_invitations
           (id, token, retreat_slug, first_name, email)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(genUuid(), genToken(), slug, p.first_name, p.email)
      .run();
  }

  return redirect(returnTo);
};

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}
