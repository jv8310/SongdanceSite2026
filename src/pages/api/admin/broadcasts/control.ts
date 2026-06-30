// POST { id, action: 'launch' | 'pause' | 'resume' } → drive a broadcast's
// lifecycle. Launch snapshots the current sendable contacts into the queue and
// flips it to 'sending'; the 5-minute cron does the actual paced delivery.
// Pause/resume let the owner stop and restart a drip by hand. Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  getBroadcast,
  launchBroadcast,
  pauseBroadcast,
  resumeBroadcast,
  setBroadcastUrgent,
} from '../../../../lib/broadcasts/db';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: { id?: number; action?: string };
  try {
    payload = (await request.json()) as { id?: number; action?: string };
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const id = Number(payload.id);
  const b = id ? await getBroadcast(env.DB, id) : null;
  if (!b) return json({ error: 'Broadcast not found.' }, 404);

  switch (payload.action) {
    case 'launch': {
      if (b.status !== 'draft' && b.status !== 'paused') {
        return json({ error: `Can't launch a broadcast that is ${b.status}.` }, 409);
      }
      if (!env.RESEND_API_KEY) return json({ error: 'RESEND_API_KEY is not configured.' }, 500);
      const recipients = await launchBroadcast(env.DB, id);
      return json({ ok: true, status: 'sending', recipients });
    }
    case 'pause': {
      await pauseBroadcast(env.DB, id, 'Paused by admin.');
      return json({ ok: true, status: 'paused' });
    }
    case 'resume': {
      await resumeBroadcast(env.DB, id);
      return json({ ok: true, status: 'sending' });
    }
    case 'urgent_on':
    case 'urgent_off': {
      // Bypass (or restore) the per-recipient local-time window. Takes effect on
      // the next cron tick — no relaunch needed, the queue is unchanged.
      await setBroadcastUrgent(env.DB, id, payload.action === 'urgent_on');
      return json({ ok: true, urgent: payload.action === 'urgent_on' });
    }
    default:
      return json({ error: 'Unknown action.' }, 400);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
