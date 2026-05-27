import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';

export const prerender = false;

// Upsert a retreat row from /admin/intakes/retreats. Accepts both new
// rows and edits to existing rows (matched on slug). Slugs are
// normalised to lowercase + hyphens so they're URL-safe.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const action = String(form.get('action') ?? '').trim();
  const returnTo = '/admin/intakes/retreats';

  if (action === 'delete') {
    const slug = String(form.get('slug') ?? '').trim();
    if (!slug) return new Response('Bad slug', { status: 400 });
    await env.DB.prepare(`DELETE FROM intake_retreats WHERE slug = ?`).bind(slug).run();
    return redirect(returnTo);
  }

  const rawSlug = String(form.get('slug') ?? '').trim();
  const originalSlug = String(form.get('original_slug') ?? '').trim();
  const name = String(form.get('name') ?? '').trim();
  const flavour = String(form.get('flavour') ?? '').trim();
  const active = form.get('active') === 'on' || form.get('active') === '1' ? 1 : 0;

  const slug = normaliseSlug(rawSlug);
  if (!slug || !name) return new Response('Bad input', { status: 400 });

  if (originalSlug && originalSlug !== slug) {
    // Renamed: update the row keyed on the original slug.
    await env.DB
      .prepare(
        `UPDATE intake_retreats
            SET slug = ?, name = ?, flavour = ?, active = ?, updated_at = datetime('now')
          WHERE slug = ?`,
      )
      .bind(slug, name, flavour || null, active, originalSlug)
      .run();
  } else {
    await env.DB
      .prepare(
        `INSERT INTO intake_retreats (slug, name, flavour, active)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           name = excluded.name,
           flavour = excluded.flavour,
           active = excluded.active,
           updated_at = datetime('now')`,
      )
      .bind(slug, name, flavour || null, active)
      .run();
  }

  return redirect(returnTo);
};

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}

function normaliseSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
