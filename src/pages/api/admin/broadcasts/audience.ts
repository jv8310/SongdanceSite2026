// POST { includeTags?, excludeTags?, field?, fieldValue?, refresh? } → { count }
// of contacts matching the audience criteria (minus suppressions). Powers the
// live "X contacts match" estimate on the compose page. With `refresh: true`
// (the "Refresh segments" button, never the keystroke estimate) it first
// recomputes the tag-segments this audience uses (workshop-passed-nonbuyer,
// in-drip) so the returned count is what a launch would actually snapshot.
// Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { countAudience, splitTags } from '../../../../lib/broadcasts/db';
import { refreshBroadcastSegments } from '../../../../lib/broadcasts/segment-refresh';

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

  const criteria = {
    includeTags: str(p.audience_include_tags ?? p.includeTags),
    excludeTags: str(p.audience_exclude_tags ?? p.excludeTags),
    field: str(p.audience_field ?? p.field),
    fieldValue: str(p.audience_field_value ?? p.fieldValue),
  };

  // Opt-in: only the explicit "refresh" action rebuilds segments — the live
  // estimate (fired on every keystroke) must never trigger a list-wide re-tag.
  let refreshed;
  if (p.refresh === true) {
    const tags = new Set([...splitTags(criteria.includeTags), ...splitTags(criteria.excludeTags)]);
    refreshed = await refreshBroadcastSegments(env.DB, tags);
  }

  const count = await countAudience(env.DB, criteria);
  return json({ count, refreshed });
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
