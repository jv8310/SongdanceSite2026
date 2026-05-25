import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { logEvent } from '../../../lib/registrations/db';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const inventoryUnitId = parseInt(String(form.get('inventory_unit_id') ?? ''), 10);
  const raw = String(form.get('forced_mode') ?? '').trim();

  if (!Number.isFinite(inventoryUnitId)) {
    return new Response('Bad inventory_unit_id', { status: 400 });
  }
  if (raw !== '' && raw !== 'solo' && raw !== 'shared') {
    return new Response('Bad forced_mode', { status: 400 });
  }
  const forcedMode: 'solo' | 'shared' | null = raw === '' ? null : (raw as 'solo' | 'shared');

  // Only allow pinning a multi-mode room (both tier links set) that is
  // currently empty. A booked room's effective mode is decided by the
  // booking; a single-tier room has nothing to pin.
  const unit = await env.DB.prepare(
    `SELECT iu.id, iu.solo_tier_id, iu.shared_tier_id,
            (SELECT COUNT(*) FROM registrations r
              WHERE r.inventory_unit_id = iu.id
                AND r.status IN ('paid','pending')
                AND (r.status = 'paid'
                     OR r.hold_expires_at IS NULL
                     OR r.hold_expires_at > datetime('now'))) AS beds_sold
       FROM inventory_units iu
      WHERE iu.id = ?`,
  )
    .bind(inventoryUnitId)
    .first<{
      id: number;
      solo_tier_id: number | null;
      shared_tier_id: number | null;
      beds_sold: number;
    }>();

  if (!unit) {
    return new Response('Room not found', { status: 404 });
  }
  if (unit.solo_tier_id == null || unit.shared_tier_id == null) {
    return new Response('Room is not multi-mode', { status: 400 });
  }
  if (unit.beds_sold > 0) {
    return new Response('Room already has bookings — mode is locked', { status: 409 });
  }

  await env.DB.prepare(
    'UPDATE inventory_units SET forced_mode = ? WHERE id = ?',
  )
    .bind(forcedMode, inventoryUnitId)
    .run();

  await logEvent(env.DB, {
    registration_id: null,
    kind: 'admin.set_room_mode',
    source: 'admin',
    payload: { inventory_unit_id: inventoryUnitId, forced_mode: forcedMode },
  });

  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));
  return new Response(null, {
    status: 302,
    headers: { Location: returnTo },
  });
};

function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin';
}
