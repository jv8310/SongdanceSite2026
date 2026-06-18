// POST { rows: [{ email, name?, timezone?, country? }], source? } → upsert a
// chunk of contacts into the marketing list. The admin page parses the CSV in
// the browser and posts it in chunks (so a 55k import never hits a request
// limit and shows live progress). Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { importContacts, countContacts, type ContactRow } from '../../../../lib/broadcasts/db';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 5000; // per request; the client chunks larger files

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: { rows?: unknown; source?: string };
  try {
    payload = (await request.json()) as { rows?: unknown; source?: string };
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  if (!Array.isArray(payload.rows)) return json({ error: 'Expected a rows array.' }, 400);
  if (payload.rows.length > MAX_ROWS) {
    return json({ error: `Too many rows in one chunk (max ${MAX_ROWS}).` }, 400);
  }

  const seen = new Set<string>();
  const valid: ContactRow[] = [];
  let skipped = 0;
  for (const raw of payload.rows as Array<Record<string, unknown>>) {
    const email = String(raw?.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) {
      skipped += 1;
      continue;
    }
    seen.add(email);
    valid.push({
      email,
      name: str(raw?.name),
      timezone: str(raw?.timezone),
      country: str(raw?.country),
    });
  }

  try {
    await importContacts(env.DB, valid, (payload.source || 'import').slice(0, 40));
  } catch (err) {
    return json({ error: `Import failed: ${String(err)}` }, 500);
  }

  return json({ ok: true, processed: valid.length, skipped, total: await countContacts(env.DB) });
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
