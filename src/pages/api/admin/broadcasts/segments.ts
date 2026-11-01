// POST /api/admin/broadcasts/segments — saved segments for the segment builder
// (SegmentBuilder.astro), JSON in and out. Admin-gated.
//
//   { action: 'list' }               → { segments }
//   { action: 'get', id }            → { segment: { id, name, rules } }
//   { action: 'save', name, rules }  → { ok, id }   (same name replaces it)
//   { action: 'delete', id }         → { ok }
//   { action: 'field_keys' }         → { keys }     (custom fields on the list)
//
// Saving checks the rules (parseSegmentRules) and compiles them once against
// the tables that exist, so a saved segment always counts. Before migration
// 0100 every action but field_keys answers 409 with the note.

import type { APIRoute } from 'astro';
import { getSessionEmail, readCookie } from '../../../../lib/registrations/auth';
import {
  AudienceRulesError,
  compileSegment,
  parseSegmentRules,
  segmentFeatures,
} from '../../../../lib/broadcasts/segment-rules';
import {
  deleteSavedSegment,
  getSavedSegment,
  listSavedSegments,
  saveSegment,
  segmentsReady,
} from '../../../../lib/broadcasts/saved-segments';
import { customFieldKeys } from '../../../../lib/broadcasts/segment-catalog';
import { logEventSafe } from '../../../../lib/registrations/db';

export const prerender = false;

const NEEDS_0100 = 'Saved segments need migration 0100 (applied when merged).';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const admin = await getSessionEmail(env.ADMIN_SESSION_SECRET, readCookie(request));
  if (!admin) return json({ error: 'Unauthorized' }, 401);

  let p: Record<string, unknown>;
  try {
    p = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const action = String(p.action ?? '');

  if (action === 'field_keys') {
    return json({ keys: await customFieldKeys(env.DB) });
  }

  if (!['list', 'get', 'save', 'delete'].includes(action)) return json({ error: 'Unknown action.' }, 400);
  if (!(await segmentsReady(env.DB))) return json({ error: NEEDS_0100 }, 409);

  switch (action) {
    case 'list':
      return json({ segments: await listSavedSegments(env.DB) });

    case 'get': {
      const id = num(p.id);
      const segment = id ? await getSavedSegment(env.DB, id) : null;
      if (!segment) return json({ error: 'That saved segment no longer exists.' }, 404);
      return json({ segment });
    }

    case 'save': {
      const name = String(p.name ?? '').trim().replace(/\s+/g, ' ');
      if (!name || name.length > 80) return json({ error: 'Give the segment a name of up to 80 characters.' }, 400);
      const parsed = parseSegmentRules(p.rules);
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      if (!parsed.rules || !parsed.rules.conditions.length) {
        return json({ error: 'Add at least one condition before saving a segment.' }, 400);
      }
      try {
        compileSegment(parsed.rules, await segmentFeatures(env.DB));
      } catch (err) {
        if (err instanceof AudienceRulesError) return json({ error: err.message }, 400);
        throw err;
      }
      let id: number;
      try {
        id = await saveSegment(env.DB, name, parsed.rules, admin);
      } catch (err) {
        return json({ error: `Could not save the segment: ${String(err instanceof Error ? err.message : err).slice(0, 200)}` }, 500);
      }
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'broadcast.segment.saved',
        source: 'admin',
        payload: { id, name, by: admin },
      });
      return json({ ok: true, id, name });
    }

    case 'delete': {
      const id = num(p.id);
      if (!id) return json({ error: 'Pick a saved segment.' }, 400);
      const segment = await getSavedSegment(env.DB, id);
      const removed = await deleteSavedSegment(env.DB, id).catch(() => false);
      if (!removed) return json({ error: 'That saved segment no longer exists.' }, 404);
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'broadcast.segment.deleted',
        source: 'admin',
        payload: { id, name: segment?.name ?? null, by: admin },
      });
      return json({ ok: true });
    }
  }
  return json({ error: 'Unknown action.' }, 400);
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
