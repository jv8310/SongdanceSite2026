// POST { includeTags?, excludeTags?, field?, fieldValue?, engagedDays?, refresh? } → { count }
// of contacts matching the audience criteria (minus suppressions). Powers the
// live "X contacts match" estimate on the compose page. POST { id, refresh? }
// counts that broadcast's saved audience instead (the Send box, the launch
// question). With `refresh: true`
// (the "Refresh segments" button, never the keystroke estimate) it first
// recomputes the tag-segments this audience uses (workshop-passed-nonbuyer,
// in-drip) so the returned count is what a launch would actually snapshot.
// Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  broadcastCriteria,
  countAudience,
  describeAudience,
  getBroadcast,
  normalizeEngagedDays,
  splitTags,
  type AudienceCriteria,
} from '../../../../lib/broadcasts/db';
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

  // With `id` the criteria are the broadcast's SAVED ones, read from the row:
  // exactly what a launch would snapshot, whatever the page was rendered with
  // or the form holds unsaved.
  let criteria: AudienceCriteria;
  const id = Number(p.id);
  if (Number.isFinite(id) && id > 0) {
    const b = await getBroadcast(env.DB, Math.floor(id));
    if (!b) return json({ error: 'Broadcast not found.' }, 404);
    criteria = broadcastCriteria(b);
  } else criteria = {
    includeTags: str(p.audience_include_tags ?? p.includeTags),
    excludeTags: str(p.audience_exclude_tags ?? p.excludeTags),
    field: str(p.audience_field ?? p.field),
    fieldValue: str(p.audience_field_value ?? p.fieldValue),
    engagedDays: normalizeEngagedDays(p.audience_engaged_days ?? p.engagedDays),
  };

  // Opt-in: only the explicit "refresh" action rebuilds segments — the live
  // estimate (fired on every keystroke) must never trigger a list-wide re-tag.
  let refreshed;
  if (p.refresh === true) {
    const tags = new Set([...splitTags(criteria.includeTags), ...splitTags(criteria.excludeTags)]);
    refreshed = await refreshBroadcastSegments(env.DB, tags, env);
  }

  const count = await countAudience(env.DB, criteria);
  return json({
    count,
    refreshed,
    summary: describeAudience(criteria),
    excludesInDrip: splitTags(criteria.excludeTags).includes('in-drip'),
  });
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
