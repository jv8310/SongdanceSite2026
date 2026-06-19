// POST { id?, name, subject, preheader?, heading, body, hero_image?, cta_label?,
// cta_href? } → create a new draft broadcast, or update an existing draft.
// Editing is refused once a broadcast is sending/done. Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  createBroadcast,
  getBroadcast,
  updateBroadcast,
  type BroadcastInput,
} from '../../../../lib/broadcasts/db';

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

  const name = str(p.name);
  const subject = str(p.subject);
  const body = str(p.body);
  const format = p.format === 'html' ? 'html' : 'simple';
  // Heading anchors the simple-format card; in html format the pasted markup
  // owns the layout, so a heading isn't required.
  const heading = str(p.heading) ?? (format === 'html' ? name : null);
  if (!name || !subject || !heading || !body) {
    return json({ error: 'Name, subject, heading and body are all required.' }, 400);
  }

  const fields: BroadcastInput = {
    name,
    subject,
    heading,
    body,
    format,
    body_text: str(p.body_text),
    preheader: str(p.preheader),
    hero_image: str(p.hero_image),
    cta_label: str(p.cta_label),
    cta_href: str(p.cta_href),
    window_start_hour: hour(p.window_start_hour, 8),
    window_end_hour: hour(p.window_end_hour, 21),
  };

  const id = num(p.id);
  if (id) {
    const existing = await getBroadcast(env.DB, id);
    if (!existing) return json({ error: 'Broadcast not found.' }, 404);
    if (existing.status !== 'draft') {
      return json({ error: 'This broadcast has already started and can no longer be edited.' }, 409);
    }
    await updateBroadcast(env.DB, id, fields);
    return json({ ok: true, id });
  }

  const newId = await createBroadcast(env.DB, fields);
  return json({ ok: true, id: newId });
};

function str(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s ? s : null;
}
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
function hour(v: unknown, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : dflt;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
