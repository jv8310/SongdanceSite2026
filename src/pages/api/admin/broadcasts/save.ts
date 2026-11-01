// POST { id?, name, subject, preheader?, heading, body, hero_image?, cta_label?,
// cta_href?, from_preset?, from_name?, from_local?, reply_to?, topic? } →
// create a new draft broadcast, or update an existing one (until it is done).
// Admin-gated.
//
// The sender (0098) and topic (0099) are written after the main row, by their
// own guarded statements (saveBroadcastExtras), and only when the form posted
// them: a field that isn't in the body — a disabled select is never posted —
// means "leave it as it is". They are validated before anything is written, so
// a bad sender or topic saves nothing. On a preview whose migrations aren't
// applied yet the rest still saves, with a `warning`.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  broadcastColumnsReady,
  createBroadcast,
  getBroadcast,
  saveBroadcastExtras,
  updateBroadcast,
  type BroadcastExtras,
  type BroadcastInput,
} from '../../../../lib/broadcasts/db';
import { resolveSenderInput } from '../../../../lib/broadcasts/sender';
import { getTopic } from '../../../../lib/email/topics';

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
    audience_include_tags: str(p.audience_include_tags),
    audience_exclude_tags: str(p.audience_exclude_tags),
    audience_field: str(p.audience_field),
    audience_field_value: str(p.audience_field_value),
  };

  // Validate the sender and topic first (only what was posted), so a bad value
  // saves nothing.
  const ready = await broadcastColumnsReady(env.DB);
  const extras: BroadcastExtras = {};
  if ('from_preset' in p) {
    if (ready.sender) {
      const sender = resolveSenderInput(
        { preset: p.from_preset, from_name: p.from_name, from_local: p.from_local, reply_to: p.reply_to },
        env,
      );
      if (!sender.ok) return json({ error: sender.error }, 400);
      Object.assign(extras, sender.fields);
    } else if (String(p.from_preset ?? '') !== 'default' || str(p.reply_to)) {
      // Asked for a sender the database can't hold yet: report it, save the rest.
      Object.assign(extras, { from_name: str(p.from_name), from_local: str(p.from_local), reply_to: str(p.reply_to) });
    }
  }
  if ('topic' in p) {
    const key = str(p.topic);
    if (key) {
      if (ready.topic) {
        const topic = await getTopic(env.DB, key);
        if (!topic) return json({ error: `Unknown topic "${key}".` }, 400);
        extras.topic = topic.key;
      } else {
        extras.topic = key;
      }
    } else if (ready.topic) {
      extras.topic = null;
    }
  }

  const id = num(p.id);
  let savedId: number;
  if (id) {
    const existing = await getBroadcast(env.DB, id);
    if (!existing) return json({ error: 'Broadcast not found.' }, 404);
    if (existing.status === 'done') {
      return json({ error: 'This broadcast has finished and can no longer be edited.' }, 409);
    }
    await updateBroadcast(env.DB, id, fields);
    savedId = id;
  } else {
    savedId = await createBroadcast(env.DB, fields);
  }

  const { skipped } = await saveBroadcastExtras(env.DB, savedId, extras);
  const warning = skipped.length ? skippedWarning(skipped) : undefined;
  return json({ ok: true, id: savedId, ...(warning ? { warning } : {}) });
};

const NEEDS: Record<string, { what: string; migration: string }> = {
  sender: { what: 'sender', migration: '0098' },
  topic: { what: 'topic', migration: '0099' },
  rules: { what: 'audience rules', migration: '0100' },
};
function skippedWarning(groups: string[]): string {
  const g = groups.map((k) => NEEDS[k]).filter(Boolean);
  const what = g.map((x) => x.what).join(' and ');
  const migrations = g.map((x) => x.migration).join(', ');
  const many = g.length > 1;
  return `Saved — but the ${what} need${many ? '' : 's'} migration${many ? 's' : ''} ${migrations} (applied when merged), so ${many ? 'those were left as they were' : 'it was left as it was'}.`;
}

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
