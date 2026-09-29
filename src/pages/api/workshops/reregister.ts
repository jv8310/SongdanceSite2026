import type { APIRoute } from 'astro';
import { logEventSafe } from '../../../lib/registrations/db';
import {
  getPublishedWorkshopBySlug,
  getRegistrationByAccessToken,
  getWorkshopById,
  upsertRegistration,
  setRegistrationPaymentStatus,
} from '../../../lib/workshops/db';
import { attendedLive, JOIN_CLOSE_AFTER_SECONDS } from '../../../lib/workshops/time';
import { runWorkshopPaidSideEffects, successUrl } from '../../../lib/workshops/paid-handler';
import { findRebook, rebookEventId, REBOOK_EVENT_KIND } from '../../../lib/workshops/rebook';

export const prerender = false;

type Body = { t?: string; workshop_slug?: string };

// POST /api/workshops/reregister  { t, workshop_slug }
//
// "I missed it — put me on a new date." Someone who already paid for a session
// they missed can move to another upcoming date free of charge: we reuse their
// existing details (name / email / timezone …) and create a coupon-grade
// registration on the chosen workshop, then send the usual confirmation.
//
// Once per seat. The original row is left as it was, so the workshop.rebooked
// event is the only record that it has moved — see lib/workshops/rebook.ts.
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

  // The original registration vouches for them — it must be a real, paid place.
  const origin = await getRegistrationByAccessToken(env.DB, token);
  if (!origin || (origin.payment_status !== 'paid' && origin.payment_status !== 'coupon')) {
    return json({ error: 'We couldn’t find your registration.' }, 404);
  }
  // …and one they missed. Someone who was in the live room has used the seat;
  // the countdown page no longer offers them this, but a page left open from
  // before the session still could.
  const originWorkshop = await getWorkshopById(env.DB, origin.workshop_id);
  if (!originWorkshop) return json({ error: 'We couldn’t find your registration.' }, 404);
  if (attendedLive(origin, originWorkshop)) {
    return json({ error: 'You joined this session live, so this seat can’t move to another date. If that’s not right, email info@songdance.co.' }, 409);
  }
  // …and one that hasn't moved already. The page swaps the list for the date
  // they moved to, but the link in the first confirmation email opens this
  // page too, and each press used to make another free seat.
  if (await findRebook(env.DB, origin.id)) {
    return json({ error: 'This seat has already moved to another date — refresh this page to see which. If that’s not right, email info@songdance.co.' }, 409);
  }
  // Only what the page offers: a live session that is over (the list appears
  // once a first join is no longer possible). A replay ticket, or a session
  // still to come, isn't a missed seat — before the start, "Switch to another
  // date" moves the seat itself.
  if (originWorkshop.is_replay === 1) {
    return json({ error: 'A replay seat doesn’t move to a live date. If that’s not right, email info@songdance.co.' }, 409);
  }
  if (Date.now() <= new Date(originWorkshop.starts_at_utc).getTime() + JOIN_CLOSE_AFTER_SECONDS * 1000) {
    return json({ error: 'This session isn’t over yet, so there’s nothing to move. If you can’t make it, email info@songdance.co.' }, 409);
  }

  const target = await getPublishedWorkshopBySlug(env.DB, slug);
  if (!target) return json({ error: 'That date isn’t open for registration.' }, 404);
  if (target.id === origin.workshop_id) {
    return json({ error: 'That’s the date you’re already on.' }, 400);
  }
  // Onto a live session still ahead — never a replay, never one that's begun
  // (the same rule as /change-date).
  if (target.is_replay === 1 || new Date(target.starts_at_utc).getTime() <= Date.now()) {
    return json({ error: 'That date isn’t open for registration.' }, 400);
  }

  const { id: registrationId, token: newToken } = await upsertRegistration(env.DB, {
    workshop_id: target.id,
    name: origin.name,
    email: origin.email,
    phone: origin.phone,
    country: origin.country,
    currency: origin.currency,
    timezone: origin.timezone,
    wants_bump: false,
    source_tag: target.source_tag,
    audience: origin.audience,
  });
  await setRegistrationPaymentStatus(env.DB, registrationId, 'coupon');

  // The record that this seat has moved (findRebook reads it back).
  await logEventSafe(env.DB, {
    registration_id: null,
    kind: REBOOK_EVENT_KIND,
    external_id: rebookEventId(origin.id, registrationId),
    payload: { from_registration_id: origin.id, to_registration_id: registrationId, workshop_id: target.id },
  });

  // Confirmation email + Drip tag (no Meta — there's no purchase value).
  const ctx: any = locals.runtime?.ctx;
  const sideEffects = runWorkshopPaidSideEffects(env, { registrationId });
  if (ctx?.waitUntil) ctx.waitUntil(sideEffects);
  else await sideEffects.catch(() => {});

  return json({ redirect_url: successUrl(env.PUBLIC_BASE_URL, newToken) });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
