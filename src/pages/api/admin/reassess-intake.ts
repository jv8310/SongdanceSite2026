import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { resolveEventWithDb } from '../../../lib/intake/events';
import { buildAssessorUserMessage, runAssessment } from '../../../lib/intake/assess';
import type { Locale } from '../../../lib/intake/copy';

export const prerender = false;

// Re-run the Claude assessment for a stored intake. The original
// payload stays untouched; assessment_md / classification /
// assessment_error are overwritten with the fresh result.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const form = await request.formData();
  const id = String(form.get('id') ?? '').trim();
  // The bulk "Assess pending" button loops over ids and wants a JSON
  // result per call; the single-row button uses the default redirect.
  const wantsJson = String(form.get('format') ?? '') === 'json';
  if (!id) {
    return wantsJson
      ? jsonResult(400, { ok: false, error: 'bad-id' })
      : new Response('Bad id', { status: 400 });
  }
  const returnTo = safeReturnTo(String(form.get('return_to') ?? `/admin/intakes/${id}`));

  const row = await env.DB
    .prepare(
      `SELECT id, event_code, locale, payload_json
         FROM intake_submissions
         WHERE id = ?`,
    )
    .bind(id)
    .first<{
      id: string;
      event_code: string;
      locale: string;
      payload_json: string;
    }>();
  if (!row) {
    return wantsJson
      ? jsonResult(404, { ok: false, id, error: 'not-found' })
      : new Response('Not found', { status: 404 });
  }

  let answers: Record<string, unknown> = {};
  try {
    answers = JSON.parse(row.payload_json) as Record<string, unknown>;
  } catch {
    answers = {};
  }

  const locale: Locale = row.locale === 'en' ? 'en' : 'nl';
  const event = await resolveEventWithDb(env.DB, row.event_code);
  const userMessage = buildAssessorUserMessage({ event, locale, answers });

  const result = await runAssessment({
    apiKey: env.ANTHROPIC_API_KEY,
    userMessage,
  });

  await env.DB
    .prepare(
      `UPDATE intake_submissions
       SET assessment_md = ?, classification = ?, assessment_error = ?
       WHERE id = ?`,
    )
    .bind(result.markdown || null, result.classification, result.error, id)
    .run();

  if (wantsJson) {
    return jsonResult(200, {
      ok: !result.error,
      id,
      classification: result.classification,
      error: result.error,
    });
  }

  return new Response(null, {
    status: 302,
    headers: { Location: returnTo },
  });
};

function jsonResult(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin/intakes';
}
