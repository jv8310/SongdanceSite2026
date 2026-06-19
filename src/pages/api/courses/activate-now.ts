// POST { email } → { ok: true }
//
// One-click "activate the cert course now" for variant-C visitors (i.e.
// they already hold prod_SVH_9m) who are still inside the 12-week course.
// We set their prod_SVH_week custom field to "12" on Drip; the existing Drip
// automation picks up from there to open cert-course access.
//
// We don't reach inside Stripe or our own DB — the only side effect is on
// Drip. Failures surface as JSON so the front-end can show a readable
// message instead of a generic network error.

import type { APIRoute } from 'astro';
import { getSubscriber, upsertSubscriber } from '../../../lib/registrations/drip';
import { logEvent } from '../../../lib/registrations/db';

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

  const dripCfg = {
    apiToken: env.DRIP_API_TOKEN,
    accountId: env.DRIP_ACCOUNT_ID,
  };

  try {
    // Guardrail: only activate for subscribers who actually own the cert
    // course. Anyone else hitting this endpoint shouldn't be able to flip
    // their prod_SVH_week.
    const sub = await getSubscriber(dripCfg, email);
    if (!sub) {
      return json(
        { error: 'We could not find that email in our system.' },
        404,
      );
    }
    if (!sub.tags.includes('prod_SVH_9m')) {
      return json(
        {
          error:
            'This activation is only available to certification-course students.',
        },
        403,
      );
    }

    await upsertSubscriber(dripCfg, {
      email,
      custom_fields: { prod_SVH_week: '12' },
    });

    await logEvent(env.DB, {
      registration_id: null,
      kind: 'course.cert.activated_early',
      source: 'system',
      payload: { email },
    });

    return json({ ok: true });
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'course.cert.activate.error',
      source: 'system',
      payload: { email, error: String(err) },
    });
    return json(
      { error: 'We could not activate the course just now. Please try again.' },
      502,
    );
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
