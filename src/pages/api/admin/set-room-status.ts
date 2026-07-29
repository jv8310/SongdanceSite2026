import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { logEvent } from '../../../lib/registrations/db';

export const prerender = false;

// Hold a room back from sale, or put it back on sale.
//
// `inventory_units.status` is what every availability path reads (see
// deriveRoomMode in registrations/db.ts): a 'reserved' room is skipped by the
// tier counts, the public form's picker and auto-assign, so its free beds are
// never sold — while the people already placed in it stay put. Flipping it
// back to 'available' lets the room resume selling its remaining beds under
// whatever tier(s) it is linked to.
//
// 'inactive' is a different thing (a room that isn't part of the retreat at
// all) and is set in the retreat's own setup, not from here — so this route
// only ever moves a room between available and reserved.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const inventoryUnitId = parseInt(String(form.get('inventory_unit_id') ?? ''), 10);
  const status = String(form.get('status') ?? '').trim();

  if (!Number.isFinite(inventoryUnitId)) {
    return new Response('Bad inventory_unit_id', { status: 400 });
  }
  if (status !== 'available' && status !== 'reserved') {
    return new Response('Bad status', { status: 400 });
  }

  const unit = await env.DB.prepare(
    'SELECT id, name, status FROM inventory_units WHERE id = ?',
  )
    .bind(inventoryUnitId)
    .first<{ id: number; name: string; status: string }>();

  if (!unit) {
    return new Response('Room not found', { status: 404 });
  }
  // An inactive room is out of the retreat entirely; bringing it back is a
  // setup change, not a sales one.
  if (unit.status === 'inactive') {
    return new Response('Room is inactive — reactivate it in the retreat setup', { status: 409 });
  }

  if (unit.status !== status) {
    await env.DB.prepare('UPDATE inventory_units SET status = ? WHERE id = ?')
      .bind(status, inventoryUnitId)
      .run();

    await logEvent(env.DB, {
      registration_id: null,
      kind: 'admin.set_room_status',
      source: 'admin',
      payload: {
        inventory_unit_id: inventoryUnitId,
        room: unit.name,
        from: unit.status,
        to: status,
      },
    });
  }

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
