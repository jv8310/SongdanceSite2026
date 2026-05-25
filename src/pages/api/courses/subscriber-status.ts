// POST { email } → { variant, offers, twelve_week_week?, course_portal_url? }
// Drives the variant block on /certification-course.
//
// Failure mode: if Drip is unreachable, return variant E (newcomer) rather
// than blocking the visitor — better to show *some* offer than nothing.

import type { APIRoute } from 'astro';
import { getSubscriber } from '../../../lib/registrations/drip';
import { decideVariant, BUNDLE_OFFER } from '../../../lib/courses/variant';

export const prerender = false;

type Body = { email?: string };

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const email = (payload.email ?? '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400);
  }

  try {
    const sub = await getSubscriber(
      { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID },
      email,
    );
    const decision = decideVariant(sub, {
      coursePortalUrl: env.SVH_CERT_PORTAL_URL,
    });
    return json(decision);
  } catch (err) {
    // Soft failure — treat as newcomer so the page still works.
    return json({
      variant: 'E',
      offers: [
        {
          ...BUNDLE_OFFER,
          save_note: 'Save €651 — mid-cohort discount applied',
          installments_note: 'Or pay in installments.',
        },
      ],
      degraded: true,
      error: String(err),
    });
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
