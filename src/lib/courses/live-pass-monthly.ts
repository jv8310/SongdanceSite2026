// The monthly live pass (src/lib/courses/live-pass.ts): where it stands, and the
// three things that change it — the buyer cancels, the buyer takes that back,
// and a renewal that could not be charged stops it.
//
// - **Cancel** (the buyer, from /courses/live-pass/manage, or an admin from the
//   order page /admin/orders/C-<id>, same function): Stripe gets
//   `cancel_at_period_end`, so nothing more is charged and the subscription
//   ends on the day the month already paid for runs out — Stripe then fires
//   `customer.subscription.deleted` and the webhook marks the row cancelled.
//   PayPal cannot schedule an end, so its subscription is cancelled at once and
//   the row marked cancelled now; either way the member app keeps the sessions
//   open to `paid_through` (the end of the paid month) and then closes them.
// - **Keep it after all**: Stripe only, while the paid month still runs — the
//   flag comes off and it renews as before. A cancelled PayPal monthly can only
//   be started again from the pass page.
// - **A renewal that can't be charged**: Stripe retries on its own schedule; once
//   it gives up (`unpaid`), or PayPal suspends the subscription after its own
//   retries, the monthly is cancelled for good (so it can never open sessions
//   nobody paid for, the way an `unpaid` subscription otherwise would) and the
//   buyer is told, with the way back to the pass page. This is not the
//   installment plans' dunning sequence (dunning.ts): a plan owes the rest of
//   what was bought, a monthly owes nothing beyond the month it is in.

import {
  getCourseRegistrationById,
  markCourseRegistrationCancelled,
  type CourseRegistration,
} from './db';
import { addMonths } from './installment-forecast';
import { isLivePassMonthlySlug, LIVE_PASS_MONTHLY_SLUG, LIVE_PASS_PAGE_PATH } from './live-pass';
import { businessDayOf, brusselsToday } from '../workshops/periods';
import { logEventSafe } from '../registrations/db';
import {
  cancelSubscriptionNow,
  retrieveSubscriptionWithLatestInvoice,
  setSubscriptionCancelAtPeriodEnd,
} from '../registrations/stripe';
import {
  cancelSubscriptionIfPresent,
  getSubscription,
  paypalConfigured,
  type PaypalEnv,
} from '../payments/paypal';
import { livePassMonthlyStoppedEmail } from '../workshops/emails';
import { sendEmail } from '../workshops/resend';

export type MonthlyEnv = PaypalEnv & {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_REPLY_TO?: string;
  PUBLIC_BASE_URL?: string;
};

const ENDED_SUB = ['canceled', 'incomplete_expired'];

// The monthly an address has running (paid, its subscription not ended), the
// newest if there were ever two. A cancelled one whose paid month still runs
// is not "running": it renews no more, and a new one may be started.
export async function findRunningMonthly(db: D1Database, email: string): Promise<CourseRegistration | null> {
  return db
    .prepare(
      `SELECT * FROM course_registrations
        WHERE product_slug = ? AND lower(email) = ? AND status = 'paid'
          AND COALESCE(subscription_status, 'active') NOT IN ('canceled','incomplete_expired')
        ORDER BY id DESC LIMIT 1`,
    )
    .bind(LIVE_PASS_MONTHLY_SLUG, email.trim().toLowerCase())
    .first<CourseRegistration>()
    .catch(() => null);
}

// The Brussels day the months paid for run out — the next renewal while it
// runs, the last day of access once cancelled. paid_through when stamped
// (migration 0090), else the first charge + the months charged.
export function monthlyPaidThroughDay(reg: Pick<CourseRegistration, 'paid_at' | 'installments_paid'> & { paid_through?: string | null }): string | null {
  if (reg.paid_through) return businessDayOf(reg.paid_through);
  if (!reg.paid_at || reg.installments_paid <= 0) return null;
  const ms = Date.parse(reg.paid_at.includes('T') ? reg.paid_at : `${reg.paid_at.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? businessDayOf(addMonths(ms, reg.installments_paid)) : null;
}

export type MonthlyState =
  | { kind: 'renews'; on: string | null } // running; the next charge is on `on`
  | { kind: 'behind'; on: string | null } // this month's charge failed; the gateway is retrying
  | { kind: 'ending'; on: string | null } // cancelled; the sessions stay open until `on`
  | { kind: 'ended'; on: string | null }
  | { kind: 'not-started' };

// Where a monthly stands, asking the gateway when the row can't say (a Stripe
// cancellation at period end leaves our row as it was until the period ends).
// A gateway that can't be read falls back to the row.
export async function readMonthlyState(env: MonthlyEnv, reg: CourseRegistration): Promise<MonthlyState> {
  const through = monthlyPaidThroughDay(reg);
  const stopped = (): MonthlyState =>
    through && through > brusselsToday() ? { kind: 'ending', on: through } : { kind: 'ended', on: through };
  if (reg.status === 'pending' || reg.status === 'expired' || reg.installments_paid <= 0) return { kind: 'not-started' };
  if (reg.status !== 'paid' || ENDED_SUB.includes(reg.subscription_status ?? '')) return stopped();

  if (reg.provider === 'paypal') {
    if (reg.paypal_subscription_id && paypalConfigured(env)) {
      try {
        const sub = await getSubscription(env, reg.paypal_subscription_id);
        const st = sub.status.toUpperCase();
        if (st === 'CANCELLED' || st === 'EXPIRED') return stopped();
        if (st === 'SUSPENDED') return { kind: 'behind', on: through };
      } catch {}
    }
    return reg.subscription_status === 'past_due' ? { kind: 'behind', on: through } : { kind: 'renews', on: through };
  }

  if (reg.stripe_subscription_id && env.STRIPE_SECRET_KEY) {
    try {
      const sub = await retrieveSubscriptionWithLatestInvoice(env.STRIPE_SECRET_KEY, reg.stripe_subscription_id);
      if (ENDED_SUB.includes(sub.status)) return stopped();
      if (sub.cancel_at_period_end || sub.cancel_at) return { kind: 'ending', on: through };
      if (sub.status === 'past_due' || sub.status === 'unpaid') return { kind: 'behind', on: through };
      return { kind: 'renews', on: through };
    } catch {}
  }
  return reg.subscription_status === 'past_due' || reg.subscription_status === 'unpaid'
    ? { kind: 'behind', on: through }
    : { kind: 'renews', on: through };
}

// The buyer cancels (or an admin, for them: `by` = 'admin:<their email>').
// Nothing more is charged; the month already paid for runs out. Idempotent:
// cancelling twice changes nothing.
export async function cancelMonthly(env: MonthlyEnv, reg: CourseRegistration, by = 'member'): Promise<MonthlyState> {
  if (!isLivePassMonthlySlug(reg.product_slug)) throw new Error('not a monthly live pass');
  if (reg.provider === 'paypal') {
    if (reg.paypal_subscription_id) {
      if (!paypalConfigured(env)) throw new Error('PayPal is not configured');
      await cancelSubscriptionIfPresent(
        env,
        reg.paypal_subscription_id,
        by === 'member' ? 'Cancelled by the member' : 'Cancelled by Songdance',
      );
    }
    await markCourseRegistrationCancelled(env.DB, reg.id);
  } else {
    if (!reg.stripe_subscription_id || !env.STRIPE_SECRET_KEY) throw new Error('no Stripe subscription on this order');
    await setSubscriptionCancelAtPeriodEnd(env.STRIPE_SECRET_KEY, reg.stripe_subscription_id, true);
  }
  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'live_pass.monthly.cancelled',
    source: 'system',
    payload: { course_registration_id: reg.id, provider: reg.provider, paid_through: monthlyPaidThroughDay(reg), by },
  });
  const fresh = (await getCourseRegistrationById(env.DB, reg.id)) ?? reg;
  const through = monthlyPaidThroughDay(fresh);
  return through && through > brusselsToday() ? { kind: 'ending', on: through } : { kind: 'ended', on: through };
}

// Take a cancellation back while the paid month still runs (Stripe only).
export async function resumeMonthly(env: MonthlyEnv, reg: CourseRegistration, by = 'member'): Promise<boolean> {
  if (!isLivePassMonthlySlug(reg.product_slug) || reg.provider === 'paypal') return false;
  if (reg.status !== 'paid' || !reg.stripe_subscription_id || !env.STRIPE_SECRET_KEY) return false;
  const sub = await retrieveSubscriptionWithLatestInvoice(env.STRIPE_SECRET_KEY, reg.stripe_subscription_id);
  if (ENDED_SUB.includes(sub.status) || !sub.cancel_at_period_end) return false;
  await setSubscriptionCancelAtPeriodEnd(env.STRIPE_SECRET_KEY, reg.stripe_subscription_id, false);
  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'live_pass.monthly.resumed',
    source: 'system',
    payload: { course_registration_id: reg.id, by },
  });
  return true;
}

// A renewal the gateway gave up on (Stripe `unpaid`, PayPal SUSPENDED): end
// the monthly and tell the buyer. Called from both webhooks; a no-op for any
// other order. The email is claimed once per order (`live-pass-monthly-stopped-<id>`).
export async function stopUnpaidMonthly(env: MonthlyEnv, reg: CourseRegistration, reason: string): Promise<void> {
  if (!isLivePassMonthlySlug(reg.product_slug)) return;
  if (reg.status === 'refunded') return;
  try {
    if (reg.provider === 'paypal') {
      if (reg.paypal_subscription_id && paypalConfigured(env)) {
        await cancelSubscriptionIfPresent(env, reg.paypal_subscription_id, 'Renewal payment failed');
      }
    } else if (reg.stripe_subscription_id && env.STRIPE_SECRET_KEY) {
      await cancelSubscriptionNow(env.STRIPE_SECRET_KEY, reg.stripe_subscription_id);
    }
  } catch (err) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'live_pass.monthly.stop_failed',
      source: 'system',
      payload: { course_registration_id: reg.id, reason, error: String(err) },
    });
    return; // the next webhook (or a person) tries again
  }
  await markCourseRegistrationCancelled(env.DB, reg.id);
  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'live_pass.monthly.stopped',
    source: 'system',
    payload: { course_registration_id: reg.id, reason },
  });
  await sendMonthlyStoppedEmail(env, reg);
}

async function sendMonthlyStoppedEmail(env: MonthlyEnv, reg: CourseRegistration): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  const externalId = `live-pass-monthly-stopped-${reg.id}`;
  let claimed = false;
  try {
    const r = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id)
         VALUES (NULL, 'live_pass.monthly.stopped_email', 'system', ?)`,
      )
      .bind(externalId)
      .run();
    claimed = (r.meta?.changes ?? 0) > 0;
    if (!claimed) return;
    const base = (env.PUBLIC_BASE_URL ?? 'https://songdance.co').replace(/\/+$/, '');
    const content = livePassMonthlyStoppedEmail({
      name: reg.first_name,
      passUrl: `${base}${LIVE_PASS_PAGE_PATH}?email=${encodeURIComponent(reg.email)}&months=monthly#get`,
    });
    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      replyTo: env.RESEND_REPLY_TO,
      to: reg.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      entityRefId: externalId,
      track: { db: env.DB, type: 'live_pass_monthly_stopped' },
    });
  } catch (err) {
    if (claimed) {
      await env.DB.prepare(`DELETE FROM events WHERE external_id = ?`).bind(externalId).run().catch(() => {});
    }
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'live_pass.monthly.stopped_email.error',
      source: 'system',
      payload: { course_registration_id: reg.id, error: String(err) },
    });
  }
}
