import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import {
  extractSummary,
  renderAssessmentMarkdown,
  stripClassificationHeading,
} from '../../../lib/intake/admin';
import { englishAssessment } from '../../../lib/intake/translate';

export const prerender = false;

// One intake assessment in English, rendered for the assessments PDF
// (/admin/intakes/retreat-pdf calls this for each assessment written in
// Dutch that has no English version kept yet).
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }
  const form = await request.formData();
  const id = String(form.get('id') ?? '').trim();
  if (!id) return json(400, { ok: false, error: 'Missing id' });

  const row = await env.DB
    .prepare(`SELECT id, assessment_md FROM intake_submissions WHERE id = ?`)
    .bind(id)
    .first<{ id: string; assessment_md: string | null }>();
  if (!row || !row.assessment_md) return json(404, { ok: false, error: 'No assessment' });

  const result = await englishAssessment(env, row.id, row.assessment_md);
  if (!result.ok) return json(502, { ok: false, error: result.error });
  return json(200, {
    ok: true,
    summary: extractSummary(result.markdown),
    html: renderAssessmentMarkdown(stripClassificationHeading(result.markdown)),
  });
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
