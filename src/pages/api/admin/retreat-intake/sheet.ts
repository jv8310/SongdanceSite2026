import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  backToRetreat,
  ensureSheetSecret,
  intakeForProduct,
  retreatProductBySlug,
} from '../../../../lib/intake/retreat-intake';
import { normaliseScriptUrl, syncTransportSheet } from '../../../../lib/intake/transport-sheet';

export const prerender = false;

// /admin/retreats/<slug> → Intake → Google Sheet.
//   action=save  — store the Apps Script web-app URL, then push at once, so a
//                  wrong URL or deployment says so now rather than silently
//   action=sync  — push the travel answers again
//   action=clear — disconnect the sheet (the sheet itself is left as it is)
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

  if (action === 'clear') {
    await env.DB
      .prepare(
        `UPDATE intake_retreats SET sheet_url = NULL, sheet_synced_at = NULL, sheet_error = NULL WHERE slug = ?`,
      )
      .bind(intake.slug)
      .run();
    return backToRetreat(product.slug, { sheet_cleared: '1' });
  }

  if (action === 'save') {
    const url = normaliseScriptUrl(String(form.get('sheet_url') ?? ''));
    if (!url) return backToRetreat(product.slug, { sheet_failed: 'bad-url' });
    await ensureSheetSecret(env.DB, intake);
    await env.DB
      .prepare(`UPDATE intake_retreats SET sheet_url = ?, sheet_error = NULL WHERE slug = ?`)
      .bind(url, intake.slug)
      .run();
  } else if (action !== 'sync') {
    return new Response('Bad action', { status: 400 });
  }

  const r = await syncTransportSheet(env.DB, intake.slug);
  return backToRetreat(
    product.slug,
    r.ok ? { sheet_synced: String(r.rows) } : { sheet_failed: r.error },
  );
};
