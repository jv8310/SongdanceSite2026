// POST { emails: string[], reason? } → add a batch of addresses to the global
// suppression list (bounce-checker results reimported from /admin/contacts) and
// scrub any live broadcast queues to match. The admin page chunks large result
// files. Idempotent. Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { suppressEmailsBatch, countSendable } from '../../../../lib/broadcasts/db';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 5000; // per request; the client chunks larger files
const ALLOWED_REASONS = new Set(['bounced']);

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: { emails?: unknown; reason?: unknown };
  try {
    payload = (await request.json()) as { emails?: unknown; reason?: unknown };
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  if (!Array.isArray(payload.emails)) return json({ error: 'Expected an emails array.' }, 400);
  if (payload.emails.length > MAX_ROWS) {
    return json({ error: `Too many rows in one chunk (max ${MAX_ROWS}).` }, 400);
  }

  const reason = ALLOWED_REASONS.has(String(payload.reason)) ? String(payload.reason) : 'bounced';
  const emails = (payload.emails as unknown[])
    .map((e) => String(e ?? '').trim().toLowerCase())
    .filter((e) => EMAIL_RE.test(e));

  let suppressed = 0;
  let scrubbed = 0;
  try {
    const res = await suppressEmailsBatch(env.DB, emails, reason, 'bounce_check');
    suppressed = res.suppressed;
    scrubbed = res.scrubbed;
  } catch (err) {
    return json({ error: `Suppress failed: ${String(err)}` }, 500);
  }

  return json({
    ok: true,
    received: emails.length,
    suppressed,
    scrubbed,
    sendable: await countSendable(env.DB),
  });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
