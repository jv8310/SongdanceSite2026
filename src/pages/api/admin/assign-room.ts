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
  const registrationId = parseInt(String(form.get('registration_id') ?? ''), 10);
  const unitRaw = String(form.get('inventory_unit_id') ?? '');
  const inventoryUnitId = unitRaw ? parseInt(unitRaw, 10) : null;

  if (!Number.isFinite(registrationId)) {
    return new Response('Bad registration_id', { status: 400 });
  }
  if (unitRaw && !Number.isFinite(inventoryUnitId)) {
    return new Response('Bad inventory_unit_id', { status: 400 });
  }

  await env.DB.prepare(
    'UPDATE registrations SET inventory_unit_id = ? WHERE id = ?',
  )
    .bind(inventoryUnitId, registrationId)
    .run();

  await logEvent(env.DB, {
    registration_id: registrationId,
    kind: 'admin.assign_room',
    source: 'admin',
    payload: { inventory_unit_id: inventoryUnitId },
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
