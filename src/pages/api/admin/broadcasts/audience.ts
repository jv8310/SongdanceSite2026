// POST { includeTags?, excludeTags?, field?, fieldValue?, topic?, refresh? } →
// { count } of contacts matching the audience criteria (minus suppressions and,
// with a topic, everyone who left it). Powers the live "X contacts match"
// estimate on the compose page. With `audience_mode: 'rules'` (or `rules`
// given) it counts segment rules instead (segment-rules.ts) — a rule set that
// can't be read or counted answers 400 { error } in words, never a silent 0.
// With `refresh: true` (the "Refresh segments" button, never the keystroke
// estimate) it first recomputes the tag-segments this audience uses
// (workshop-passed-nonbuyer, in-drip, app:…) so the returned count is what a
// launch would actually snapshot. Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { audienceTags, countAudienceChecked, type AudienceCriteria } from '../../../../lib/broadcasts/db';
import { parseSegmentRules } from '../../../../lib/broadcasts/segment-rules';
import { TOPIC_KEY_RE } from '../../../../lib/email/topics';
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

  const topicRaw = str(p.topic);
  const topic = topicRaw && TOPIC_KEY_RE.test(topicRaw) ? topicRaw : null;
  const rawRules = p.rules ?? p.audience_rules;
  const rulesMode = p.audience_mode === 'rules' || (p.audience_mode !== 'simple' && rawRules != null && rawRules !== '');

  let criteria: AudienceCriteria;
  if (rulesMode) {
    const parsed = parseSegmentRules(rawRules);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    // Rules mode with nothing in it yet = the whole sendable list.
    criteria = { topic, rules: parsed.rules ?? { match: 'all', conditions: [] } };
  } else {
    criteria = {
      includeTags: str(p.audience_include_tags ?? p.includeTags),
      excludeTags: str(p.audience_exclude_tags ?? p.excludeTags),
      field: str(p.audience_field ?? p.field),
      fieldValue: str(p.audience_field_value ?? p.fieldValue),
      topic,
    };
  }

  // Opt-in: only the explicit "refresh" action rebuilds segments — the live
  // estimate (fired on every keystroke) must never trigger a list-wide re-tag.
  let refreshed;
  if (p.refresh === true) {
    refreshed = await refreshBroadcastSegments(env.DB, audienceTags(criteria), env);
  }

  const counted = await countAudienceChecked(env.DB, criteria);
  if ('error' in counted) return json({ error: counted.error, refreshed }, 400);
  return json({ count: counted.count, refreshed });
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
