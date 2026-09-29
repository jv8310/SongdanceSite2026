import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  backToRetreat,
  createIntakeForProduct,
  linkIntakeToProduct,
  retreatProductBySlug,
  unlinkIntake,
} from '../../../../lib/intake/retreat-intake';

export const prerender = false;

// /admin/retreats/<slug> → Intake: join the retreat to its intake.
//   action=create — a fresh intake keyed by the retreat's own slug
//   action=link   — an intake that already exists (made by hand on
//                   /admin/intakes/retreats, with its invitees and answers)
//   action=unlink — the retreat forgets its intake; nothing is deleted
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

  if (action === 'create') {
    const locale = String(form.get('invite_locale') ?? '') === 'nl' ? 'nl' : 'en';
    await createIntakeForProduct(env.DB, product, locale);
    return backToRetreat(product.slug, { intake_linked: '1' });
  }
  if (action === 'link') {
    const intakeSlug = String(form.get('intake_slug') ?? '').trim();
    if (!intakeSlug) return backToRetreat(product.slug, { intake_failed: 'pick-an-intake' });
    const ok = await linkIntakeToProduct(env.DB, intakeSlug, product.id);
    return backToRetreat(product.slug, ok ? { intake_linked: '1' } : { intake_failed: 'unknown-intake' });
  }
  if (action === 'unlink') {
    await unlinkIntake(env.DB, product.id);
    return backToRetreat(product.slug, { intake_unlinked: '1' });
  }
  return new Response('Bad action', { status: 400 });
};
