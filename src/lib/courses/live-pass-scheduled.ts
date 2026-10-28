// A monthly live pass agreed for a later first charge (live-pass-plan.ts,
// planMonthlyStart): what happens the moment the buyer finishes the gateway's
// page, before any money moves.
//
//   Stripe — Checkout completed on a trialing subscription
//            (stripe-webhook.ts, checkout.session.completed)
//   PayPal — the subscription approved and ACTIVE with a later start_time
//            (paypal-return.ts, and the BILLING.SUBSCRIPTION.ACTIVATED webhook)
//
// Three things, each once:
//   1. Stripe: the first month's extra is added to the subscription's first
//      real invoice (addSubscriptionInvoiceItem), so that day's charge is the
//      full first month. PayPal carries it in the plan's first cycle already.
//   2. The row is marked agreed: subscription_status trialing (Stripe; PayPal's
//      ACTIVE is mirrored by the caller), and an `expired` row — a buyer who
//      took more than 15 minutes on the gateway's page — goes back to pending.
//      Together with access_starts_at that is what SCHEDULED_MONTHLY_SQL reads.
//   3. "Your monthly live pass starts on …" to the buyer, with the manage link,
//      so they can cancel before it begins.
// The first charge then lands like any monthly's: invoice.paid / the PayPal
// sale → recorded, paid, Drip, SD-ORDER, "Your monthly live pass is running".

import { getCourseRegistrationById, setCourseSubscriptionStatusById, type CourseRegistration } from './db';
import { logEventSafe } from '../registrations/db';
import { addSubscriptionInvoiceItem } from '../registrations/stripe';
import { formatMoney, type SupportedCurrency } from '../workshops/currency';
import { livePassMonthlyScheduledEmail } from '../workshops/emails';
import { sendEmail } from '../workshops/resend';
import { addDays } from './cert-access';
import {
  isLivePassMonthlySlug,
  MONTHLY_FIRST_MONTH_LABEL,
  monthlyFirstMonthExtraCents,
} from './live-pass';
import { isScheduledMonthly, monthlyStartDay } from './live-pass-monthly';
import { LIVE_PASS_EVENTS_URL, livePassManageUrlFor } from './live-pass-email';

type ScheduledEnv = {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_REPLY_TO?: string;
  ADMIN_SESSION_SECRET?: string;
  PUBLIC_BASE_URL?: string;
};

const fmtDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Claim an `events` row once; false when it was already there.
async function claim(db: D1Database, externalId: string, kind: string): Promise<boolean> {
  const r = await db
    .prepare(`INSERT OR IGNORE INTO events (registration_id, kind, source, external_id) VALUES (NULL, ?, 'system', ?)`)
    .bind(kind, externalId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

async function release(db: D1Database, externalId: string): Promise<void> {
  await db.prepare(`DELETE FROM events WHERE external_id = ?`).bind(externalId).run().catch(() => {});
}

// Never throws: the gateway has already agreed the subscription, and a webhook
// or return page must not fail over a side effect.
export async function noteScheduledMonthly(
  env: ScheduledEnv,
  regId: number,
  stripe?: { subscriptionStatus: string; customer: string | null },
): Promise<void> {
  try {
    let reg = await getCourseRegistrationById(env.DB, regId);
    if (!reg || !isLivePassMonthlySlug(reg.product_slug) || reg.installments_paid > 0 || !reg.access_starts_at) return;
    if (reg.status !== 'pending' && reg.status !== 'expired') return;

    if (stripe) {
      if (stripe.subscriptionStatus !== 'trialing') return;
      await setCourseSubscriptionStatusById(env.DB, reg.id, 'trialing');
      await addFirstMonthExtra(env, reg, stripe.customer);
    }
    if (reg.status === 'expired') {
      await env.DB
        .prepare(`UPDATE course_registrations SET status = 'pending' WHERE id = ? AND status = 'expired' AND installments_paid = 0`)
        .bind(reg.id)
        .run();
    }
    reg = (await getCourseRegistrationById(env.DB, reg.id)) ?? reg;
    if (!isScheduledMonthly(reg)) return;
    await sendScheduledConfirmation(env, reg);
  } catch (err) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'live_pass.monthly.scheduled.error',
      source: 'system',
      payload: { course_registration_id: regId, error: String(err) },
    });
  }
}

// Stripe: the first month's extra onto the first real invoice. Claimed in
// `events` (and sent with an idempotency key) so a webhook retry adds it once.
async function addFirstMonthExtra(env: ScheduledEnv, reg: CourseRegistration, customer: string | null): Promise<void> {
  const extra = monthlyFirstMonthExtraCents(reg.bumps);
  if (extra <= 0 || !env.STRIPE_SECRET_KEY || !reg.stripe_subscription_id || !customer) return;
  const key = `live-pass-monthly-extra-${reg.id}`;
  if (!(await claim(env.DB, key, 'live_pass.monthly.first_extra'))) return;
  try {
    await addSubscriptionInvoiceItem({
      secretKey: env.STRIPE_SECRET_KEY,
      customer,
      subscription: reg.stripe_subscription_id,
      amount_cents: extra,
      currency: (reg.currency || 'EUR').toLowerCase(),
      description: MONTHLY_FIRST_MONTH_LABEL,
      metadata: { course_registration_id: String(reg.id), product_slug: 'monthly-first-month' },
      idempotency_key: key,
    });
  } catch (err) {
    await release(env.DB, key);
    throw err;
  }
}

async function sendScheduledConfirmation(env: ScheduledEnv, reg: CourseRegistration): Promise<void> {
  const startsOn = monthlyStartDay(reg);
  if (!env.RESEND_API_KEY || !startsOn) return;
  const key = `live-pass-monthly-scheduled-${reg.id}`;
  if (!(await claim(env.DB, key, 'live_pass.monthly.scheduled'))) return;
  try {
    const currency = (reg.currency || 'EUR').toUpperCase() as SupportedCurrency;
    const extra = monthlyFirstMonthExtraCents(reg.bumps);
    const content = livePassMonthlyScheduledEmail({
      name: reg.first_name,
      loginEmail: reg.email,
      startsLabel: fmtDay(startsOn),
      firstMonthLabel: formatMoney(reg.amount_cents + extra, currency),
      priceLabel: formatMoney(reg.amount_cents, currency),
      coveredUntilLabel: fmtDay(addDays(startsOn, -1)),
      manageUrl: await livePassManageUrlFor(env, reg.id),
      eventsUrl: LIVE_PASS_EVENTS_URL,
    });
    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      replyTo: env.RESEND_REPLY_TO,
      to: reg.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      entityRefId: key,
      track: { db: env.DB, type: 'live_pass_monthly_scheduled' },
    });
  } catch (err) {
    await release(env.DB, key);
    throw err;
  }
}
