import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { dripBackfillProgress } from '../../../lib/orders/drip-backfill';

export const prerender = false;

// Read-only progress for the one-shot historical Drip order backfill
// (src/lib/orders/drip-backfill.ts). Lets the owner watch the gated cron drain
// empty the queue and know when it's safe to turn DRIP_BACKFILL_ENABLED back
// off: once `pending` reaches 0, every past purchase has been sent to Drip.
//
//   GET /api/admin/drip-backfill  →  { enabled, pending, sent, failed, total }
//
// `failed` rows are ones Drip rejected 4× (e.g. if it ever refuses an order);
// a non-zero count is worth a look but doesn't stall the rest of the drain.
export const GET: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const progress = await dripBackfillProgress(env.DB);
  const v = (env.DRIP_BACKFILL_ENABLED ?? '').trim().toLowerCase();
  const enabled = v === '1' || v === 'true' || v === 'yes' || v === 'on';
  return new Response(JSON.stringify({ enabled, ...progress }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
};
