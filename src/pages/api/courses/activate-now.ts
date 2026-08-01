// POST { email } → { ok: true, progress }
//
// "I'm ready — open the certification course now." For someone who holds the
// certification (bought the path, or the course itself) but is still walking
// the 12-week foundation, this is the one-click move: the week counter stops
// and their profile field reads "Ongoing Certification" instead of "Week 6 of
// 12". Offered on the certification page (variant C) and on /access.
//
// Two side effects, in this order:
//   1. Our own record — `course_week_progress` (src/lib/courses/week-progress.ts)
//      flips to state 'certification'. This is the authoritative one.
//   2. Drip — the `prod_SVH_week` custom field is published, and
//      `prod_SVH_9m_status` set to "activated" (the same pair a buyer who chose
//      "Activate now" at checkout gets), so any automation gating certification
//      content has a stable hook.
//
// Entitlement is checked on TWO paths, never on Drip alone: the `prod_SVH_9m`
// tag, OR a paid cc-cert / cc-bundle order in D1. Tagging on payment is
// best-effort and never retried, so a buyer whose tag never landed must not be
// told the course isn't theirs — same two-path rule the music players use.
//
// Failures surface as JSON so the front-end can show a readable message
// instead of a generic network error.

import type { APIRoute } from 'astro';
import { getSubscriber, upsertSubscriber } from '../../../lib/registrations/drip';
import { logEvent } from '../../../lib/registrations/db';
import {
  describeWeekProgress,
  getWeekProgress,
  markCertificationOngoing,
  recordWeekProgressSync,
} from '../../../lib/courses/week-progress';
import { WEEK_FIELD } from '../../../lib/courses/week-sync';

export const prerender = false;

type Body = { email?: string };

// A paid certification order under this address (either product) — the local
// half of the entitlement check.
async function ownsCertificationLocally(
  db: D1Database,
  email: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM course_registrations
        WHERE LOWER(TRIM(email)) = ?
          AND product_slug IN ('cc-cert','cc-bundle')
          AND status = 'paid'
        LIMIT 1`,
    )
    .bind(email)
    .first<{ ok: number }>();
  return !!row;
}

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
    // Guardrail: only activate for people who actually own the certification
    // course. The local order is checked first — it's the record we control and
    // it can't be knocked out by a Drip outage.
    let owns = await ownsCertificationLocally(env.DB, email);
    let subscriberKnown = false;
    if (!owns && dripCfg.apiToken && dripCfg.accountId) {
      const sub = await getSubscriber(dripCfg, email);
      subscriberKnown = !!sub;
      owns = !!sub?.tags?.includes('prod_SVH_9m');
    }
    if (!owns) {
      const known = subscriberKnown || (await knownLocally(env.DB, email));
      return json(
        known
          ? {
              error:
                'This activation is only available to certification-course students.',
            }
          : { error: 'We could not find that email in our system.' },
        known ? 403 : 404,
      );
    }

    // 1. Our own record — the counter stops here. Read the week first, so the
    //    log says which week they stepped out of.
    const before = await getWeekProgress(env.DB, email);
    const fromWeek = before ? describeWeekProgress(before).week : null;
    const row = await markCertificationOngoing(env.DB, email, {
      source: 'self-service',
    });
    const status = row ? describeWeekProgress(row) : null;

    // 2. Publish it. Best-effort: the activation has already happened locally,
    //    and the hourly sweep re-publishes anything that didn't land.
    if (dripCfg.apiToken && dripCfg.accountId) {
      try {
        await upsertSubscriber(dripCfg, {
          email,
          custom_fields: {
            [WEEK_FIELD]: status?.fieldValue ?? 'Ongoing Certification',
            prod_SVH_9m_status: 'activated',
          },
        });
        if (status) await recordWeekProgressSync(env.DB, email, status.fieldValue);
      } catch (err) {
        await logEvent(env.DB, {
          registration_id: null,
          kind: 'course.week.sync.error',
          source: 'system',
          payload: { email, error: String(err) },
        });
      }
    }

    await logEvent(env.DB, {
      registration_id: null,
      kind: 'course.cert.activated_early',
      source: 'system',
      payload: { email, from_week: fromWeek },
    });

    return json({
      ok: true,
      progress: status
        ? { state: status.state, week: status.week, label: status.label }
        : null,
    });
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

// Do we know this address at all? Only used to pick the honest error message
// when the certification isn't theirs.
async function knownLocally(db: D1Database, email: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM course_registrations
        WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
    )
    .bind(email)
    .first<{ ok: number }>();
  return !!row;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
