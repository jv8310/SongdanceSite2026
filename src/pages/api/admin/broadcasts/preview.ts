// POST { subject, heading, body, format, body_text?, preheader?, hero_image?,
// cta_label?, cta_href? } → { html, text } rendered exactly as it would send,
// so the compose page can show a live preview of unsaved edits. Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { renderBroadcast } from '../../../../lib/broadcasts/email';
import type { Broadcast } from '../../../../lib/broadcasts/db';

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

  // A transient Broadcast shaped from the posted fields (never saved).
  const draft: Broadcast = {
    id: 0,
    name: str(p.name) ?? 'Preview',
    subject: str(p.subject) ?? '(no subject)',
    preheader: str(p.preheader),
    heading: str(p.heading) ?? '',
    body: str(p.body) ?? '',
    format: p.format === 'html' ? 'html' : 'simple',
    body_text: str(p.body_text),
    hero_image: str(p.hero_image),
    cta_label: str(p.cta_label),
    cta_href: str(p.cta_href),
    window_start_hour: 8,
    window_end_hour: 21,
    urgent: 0,
    stop_at: null,
    audience_include_tags: null,
    audience_exclude_tags: null,
    audience_field: null,
    audience_field_value: null,
    status: 'draft',
    paused_reason: null,
    breaker_baseline_at: null,
    last_cleaned_at: null,
    created_at: '',
    started_at: null,
    completed_at: null,
  };

  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const content = renderBroadcast(draft, {
    firstName: 'Maria',
    unsubscribeUrl: `${base}/unsubscribe?e=sample%40example.com&t=preview`,
  });
  return json({ html: content.html, text: content.text });
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
