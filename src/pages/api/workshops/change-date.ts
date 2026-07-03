import type { APIRoute } from 'astro';
import { logEvent } from '../../../lib/registrations/db';
import {
  getPublishedWorkshopBySlug,
  getRegistrationByAccessToken,
  moveRegistrationToWorkshop,
} from '../../../lib/workshops/db';
import { runWorkshopDateChangeSideEffects, successUrl } from '../../../lib/workshops/paid-handler';

export const prerender = false;

type Body = { t?: string; workshop_slug?: string };

// POST /api/workshops/change-date  { t, workshop_slug }
//
// "Move me to another date." Someone registered for an upcoming live session can
// switch their seat to a different upcoming date straight from their countdown
// page — before it happens. Distinct from the post-miss free rebook
// (/reregister), which comps a brand-new seat: here the seat itself travels, so
// the old date stops reminding/counting them and the new one picks up the
// cadence. The token is stable, so their countdown link keeps working and simply
// shows the new date.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const token = (payload.t ?? '').trim();
  const slug = (payload.workshop_slug ?? '').trim();
  if (!token || !slug) return json({ error: 'Bad request.' }, 400);

  // A real, secured seat vouches for the move.
  const reg = await getRegistrationByAccessToken(env.DB, token);
  if (!reg || (reg.payment_status !== 'paid' && reg.payment_status !== 'coupon')) {
    return json({ error: 'We couldn’t find your registration.' }, 404);
  }

  const target = await getPublishedWorkshopBySlug(env.DB, slug);
  if (!target) return json({ error: 'That date isn’t open for registration.' }, 404);
  if (target.id === reg.workshop_id) {
    return json({ error: 'That’s the date you’re already on.' }, 400);
  }
  // Only a future live session can be switched onto — never a replay, never one
  // that's already started.
  if (target.is_replay === 1 || new Date(target.starts_at_utc).getTime() <= Date.now()) {
    return json({ error: 'That date isn’t open for registration.' }, 400);
  }

  const moved = await moveRegistrationToWorkshop(env.DB, reg.id, target.id);
  if (!moved.ok) {
    if (moved.reason === 'already_on_target') {
      return json({ error: 'You already have a spot on that date.' }, 409);
    }
    return json({ error: 'We couldn’t find your registration.' }, 404);
  }

  await logEvent(env.DB, {
    registration_id: null,
    kind: 'workshop.date_changed',
    payload: { registration_id: reg.id, from_workshop_id: reg.workshop_id, to_workshop_id: target.id },
  });

  // Fresh confirmation for the new date + Drip re-tag (no Meta — no new purchase
  // value). Best-effort, off the request path when the runtime allows it.
  const ctx: any = locals.runtime?.ctx;
  const sideEffects = runWorkshopDateChangeSideEffects(env, reg.id);
  if (ctx?.waitUntil) ctx.waitUntil(sideEffects);
  else await sideEffects.catch(() => {});

  return json({ redirect_url: successUrl(env.PUBLIC_BASE_URL, moved.token) });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
