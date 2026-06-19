// POST { includeTags?, excludeTags?, field?, fieldValue? } → { count } of
// contacts matching the audience criteria (minus suppressions). Powers the live
// "X contacts match" estimate on the compose page. Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { countAudience } from '../../../../lib/broadcasts/db';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let p: Record<string, unknown>;
  try {
    p = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const count = await countAudience(env.DB, {
    includeTags: str(p.audience_include_tags ?? p.includeTags),
    excludeTags: str(p.audience_exclude_tags ?? p.excludeTags),
    field: str(p.audience_field ?? p.field),
    fieldValue: str(p.audience_field_value ?? p.fieldValue),
  });
  return json({ count });
};

function str(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s ? s : null;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
