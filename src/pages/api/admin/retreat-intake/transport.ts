import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  backToRetreat,
  intakeForProduct,
  retreatProductBySlug,
} from '../../../../lib/intake/retreat-intake';
import { transportSectionForIntake } from '../../../../lib/intake/send';
import { answeredTransportKeys, sectionFromJson } from '../../../../lib/intake/transport';
import { draftTransportSection } from '../../../../lib/intake/transport-ai';
import { syncTransportSheet } from '../../../../lib/intake/transport-sheet';

export const prerender = false;

const MAX_BRIEF = 4000;

// /admin/retreats/<slug> → Intake → the travel questions, edited with Claude.
//   action=draft   — send the admin's instruction + today's questions to the
//                    Claude API; store the result as a DRAFT (guests don't see
//                    it). Builds on an existing draft, so instructions can be
//                    given one after another.
//   action=publish — the draft becomes what the form asks; the sheet is pushed
//                    so a new question becomes its column straight away.
//   action=discard — drop the draft.
//   action=revert  — drop the published version: the form falls back to the
//                    questions written in code for this retreat (or none).
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const productSlug = String(form.get('product_slug') ?? '').trim();
  const action = String(form.get('action') ?? '').trim();
  const product = await retreatProductBySlug(env.DB, productSlug);
  if (!product) return new Response('Unknown retreat', { status: 404 });
  const intake = await intakeForProduct(env.DB, product.id);
  if (!intake) return backToRetreat(product.slug, { intake_failed: 'no-intake' });
  // Before migration 0087 reaches the database (a preview runs on the live D1
  // ahead of it), say so — rather than paying for a Claude draft that then
  // cannot be saved.
  const ready = await env.DB
    .prepare(`SELECT transport_draft_json FROM intake_retreats LIMIT 0`)
    .run()
    .then(() => true)
    .catch(() => false);
  if (!ready) return backToRetreat(product.slug, { transport_failed: 'needs-migration' });

  if (action === 'draft') {
    const brief = String(form.get('brief') ?? '').trim().slice(0, MAX_BRIEF);
    if (!brief) return backToRetreat(product.slug, { transport_failed: 'empty-brief' });

    const [current, dates, answered] = await Promise.all([
      transportSectionForIntake(env.DB, intake.slug, { draft: true }),
      env.DB
        .prepare(`SELECT starts_at, ends_at FROM products WHERE id = ?`)
        .bind(product.id)
        .first<{ starts_at: string | null; ends_at: string | null }>(),
      answeredTransportKeys(env.DB, intake.slug),
    ]);
    const result = await draftTransportSection({
      apiKey: env.ANTHROPIC_API_KEY,
      retreat: { name: product.name, startsAt: dates?.starts_at ?? null, endsAt: dates?.ends_at ?? null },
      current,
      answeredKeys: answered,
      brief,
    });
    if (!result.ok) {
      // Keep what was typed, so a failed attempt costs nothing to retry.
      await env.DB
        .prepare(`UPDATE intake_retreats SET transport_brief = ? WHERE slug = ?`)
        .bind(brief, intake.slug)
        .run();
      return backToRetreat(product.slug, { transport_failed: result.error });
    }
    await env.DB
      .prepare(
        `UPDATE intake_retreats
            SET transport_draft_json = ?, transport_draft_summary = ?, transport_brief = ?
          WHERE slug = ?`,
      )
      .bind(JSON.stringify(result.section), result.summary || null, brief, intake.slug)
      .run();
    return backToRetreat(product.slug, { transport_drafted: '1' });
  }

  if (action === 'publish') {
    const draft = sectionFromJson(intake.transport_draft_json);
    if (!draft) return backToRetreat(product.slug, { transport_failed: 'no-draft' });
    await env.DB
      .prepare(
        `UPDATE intake_retreats
            SET transport_json = ?, transport_draft_json = NULL, transport_draft_summary = NULL,
                transport_updated_at = datetime('now')
          WHERE slug = ?`,
      )
      .bind(JSON.stringify(draft), intake.slug)
      .run();
    if (intake.sheet_url) await syncTransportSheet(env.DB, intake.slug).catch(() => undefined);
    return backToRetreat(product.slug, { transport_published: '1' });
  }

  if (action === 'discard') {
    await env.DB
      .prepare(
        `UPDATE intake_retreats SET transport_draft_json = NULL, transport_draft_summary = NULL WHERE slug = ?`,
      )
      .bind(intake.slug)
      .run();
    return backToRetreat(product.slug, { transport_discarded: '1' });
  }

  if (action === 'revert') {
    await env.DB
      .prepare(
        `UPDATE intake_retreats SET transport_json = NULL, transport_updated_at = datetime('now') WHERE slug = ?`,
      )
      .bind(intake.slug)
      .run();
    if (intake.sheet_url) await syncTransportSheet(env.DB, intake.slug).catch(() => undefined);
    return backToRetreat(product.slug, { transport_reverted: '1' });
  }

  return new Response('Bad action', { status: 400 });
};
