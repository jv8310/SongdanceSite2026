import type { APIRoute } from 'astro';
import { logEvent } from '../../../lib/registrations/db';
import {
  getPublishedWorkshopBySlug,
  getRegistrationById,
  upsertRegistration,
  setRegistrationPaymentStatus,
} from '../../../lib/workshops/db';
import { runWorkshopPaidSideEffects, successUrl } from '../../../lib/workshops/paid-handler';

export const prerender = false;

type Body = { rid?: number; workshop_slug?: string };

// POST /api/workshops/reregister  { rid, workshop_slug }
//
// "I missed it — put me on a new date." Someone who already paid for a session
// they missed can move to another upcoming date free of charge: we reuse their
// existing details (name / email / timezone …) and create a coupon-grade
// registration on the chosen workshop, then send the usual confirmation.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const rid = Number(payload.rid);
  const slug = (payload.workshop_slug ?? '').trim();
  if (!Number.isFinite(rid) || !slug) return json({ error: 'Bad request.' }, 400);

  // The original registration vouches for them — it must be a real, paid place.
  const origin = await getRegistrationById(env.DB, rid);
  if (!origin || (origin.payment_status !== 'paid' && origin.payment_status !== 'coupon')) {
    return json({ error: 'We couldn’t find your registration.' }, 404);
  }

  const target = await getPublishedWorkshopBySlug(env.DB, slug);
  if (!target) return json({ error: 'That date isn’t open for registration.' }, 404);
  if (target.id === origin.workshop_id) {
    return json({ error: 'That’s the date you’re already on.' }, 400);
  }

  const registrationId = await upsertRegistration(env.DB, {
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

  await logEvent(env.DB, {
    registration_id: null,
    kind: 'workshop.rebooked',
    external_id: `workshop-rebook-${rid}-to-${registrationId}`,
    payload: { from_registration_id: rid, to_registration_id: registrationId, workshop_id: target.id },
  });

  // Confirmation email + Drip tag (no Meta — there's no purchase value).
  const ctx: any = locals.runtime?.ctx;
  const sideEffects = runWorkshopPaidSideEffects(env, { registrationId });
  if (ctx?.waitUntil) ctx.waitUntil(sideEffects);
  else await sideEffects.catch(() => {});

  return json({ redirect_url: successUrl(env.PUBLIC_BASE_URL, registrationId) });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
