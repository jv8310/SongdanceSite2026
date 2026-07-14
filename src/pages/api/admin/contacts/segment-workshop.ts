// POST { tag? } → tag every contact who registered for an already-passed
// workshop and hasn't bought the 12-week or certification course, so a broadcast
// can target that one tag (the "workshop already passed" filter can't be
// expressed with tags alone — see src/lib/contacts/segments.ts). Idempotent and
// re-runnable. Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  buildPastWorkshopSegment,
  PAST_WORKSHOP_SEGMENT_TAG,
} from '../../../../lib/contacts/segments';

export const prerender = false;

// Same shape as a normalised contact tag: lowercase, no commas (the audience
// splits include/exclude on commas), reasonable length.
const TAG_RE = /^[^,]{1,60}$/;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: { tag?: unknown } = {};
  try {
    payload = (await request.json()) as { tag?: unknown };
  } catch {
    // Empty/invalid body is fine — fall back to the default tag.
  }

  const raw = String(payload.tag ?? '').trim();
  const tag = raw || PAST_WORKSHOP_SEGMENT_TAG;
  if (!TAG_RE.test(tag)) {
    return json({ error: 'Tag must be 1–60 characters and contain no commas.' }, 400);
  }

  try {
    const result = await buildPastWorkshopSegment(env.DB, { tag });
    return json({ ok: true, ...result });
  } catch (err) {
    return json({ error: `Segment build failed: ${String(err)}` }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
