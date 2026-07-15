import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import {
  getProductBySlug,
  pickRoomForTier,
  getSpecialRoomByRole,
  logEvent,
  type SpecialRole,
} from '../../../lib/registrations/db';

export const prerender = false;

// Auto-assign every unassigned *paid* registration to a room matching what
// they purchased. Walks one registration at a time and persists each pick
// before the next, so pickRoomForTier sees the updated occupancy and fills
// rooms correctly (and never double-books a bed). Already-assigned people
// (hosts, cook, anyone manually placed) are left untouched. Pending/unpaid
// holds are deliberately skipped — under the "free until paid" policy an
// unpaid registration must not occupy a cabin (it's placed when it pays).
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const productSlug = String(form.get('product_slug') ?? '').trim();
  const product = await getProductBySlug(env.DB, productSlug);
  if (!product) {
    return new Response('Unknown product', { status: 404 });
  }

  // Unassigned + paid, oldest first. Unpaid pending holds are intentionally
  // excluded (see "free until paid" above) — they get a room only once paid.
  const res = await env.DB.prepare(
    `SELECT r.id, r.role, t.slug AS tier_slug
       FROM registrations r
       JOIN tiers t ON t.id = r.tier_id
      WHERE r.product_id = ?
        AND r.inventory_unit_id IS NULL
        AND r.status = 'paid'
      ORDER BY r.created_at, r.id`,
  )
    .bind(product.id)
    .all<{ id: number; role: SpecialRole | null; tier_slug: string }>();
  const pending = res.results ?? [];

  let assigned = 0;
  const skipped: number[] = [];
  for (const reg of pending) {
    const room = reg.role
      ? await getSpecialRoomByRole(env.DB, product.id, reg.role, reg.id)
      : await pickRoomForTier(env.DB, product.id, reg.tier_slug);
    if (!room) {
      skipped.push(reg.id);
      continue;
    }
    await env.DB.prepare(
      'UPDATE registrations SET inventory_unit_id = ? WHERE id = ?',
    )
      .bind(room.id, reg.id)
      .run();
    assigned += 1;
  }

  await logEvent(env.DB, {
    registration_id: null,
    kind: 'admin.auto_assign_rooms',
    source: 'admin',
    payload: { assigned, skipped, considered: pending.length },
  });

  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));
  return new Response(null, { status: 302, headers: { Location: returnTo } });
};

function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin';
}
