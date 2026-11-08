// "Pay what's left" for a Stripe course installment plan — settle the rest of
// the plan in one payment, optionally with a discount the admin chose.
//
// Three halves, all keyed on one course registration:
//
//   payoffQuote   — what the plan still owes (the installments not yet
//                   charged), less the discount, or why there is nothing to
//                   pay. Worked out from the row every time, never stored.
//
//   startPayoff   — on a click of the durable link
//                   (/courses/pay-remaining?t=…, see ./payoff-link.ts): mint a
//                   fresh one-off Stripe Checkout for that amount and send the
//                   buyer to it.
//
//   applyPayoff   — once that checkout is paid (the return page, and the
//                   checkout.session.completed webhook for a buyer who closed
//                   the tab; they converge on one events claim): mark every
//                   installment as charged, record the order's real total,
//                   reopen a plan that had been closed for an unpaid month,
//                   then close the subscription at Stripe so nothing more is
//                   charged, and void the month Stripe gave up on (this
//                   payment settled it).
//
// The bookkeeping: `amount_cents` holds the plan total and every money figure
// counts a plan as amount_cents × installments_paid / installments_total
// (collectedGrossMinor, collectedMinorOf, contractedMinorOf). So when the plan
// is paid off, amount_cents becomes what the earlier installments took plus
// what this payment took, and installments_paid becomes installments_total:
// every report then reads exactly the money that came in, discount included,
// and the plan reads complete on Future revenue. The payment itself is one
// Stripe charge outside the subscription; Quaderno's Stripe connector invoices
// it like any other charge. It is not in the order page's per-installment
// refund table (that lists the subscription's invoices): refund it from Stripe.
//
// PayPal plans are not covered: PayPal holds those payments.

import { type CourseRegistration, getCourseRegistrationById } from './db';
import { effectiveTotal } from './installment-forecast';
import { courseDisplayName } from './dunning';
import { logEventSafe } from '../registrations/db';
import {
  cancelSubscriptionNow,
  createCheckoutSession,
  listOutstandingSubscriptionInvoices,
  retrievePaymentCheckoutSession,
  retrieveSubscriptionWithLatestInvoice,
  voidInvoice,
} from '../registrations/stripe';
import { PAYOFF_SESSION_PARAM, payoffUrl } from './payoff-link';
import { formatMoney } from '../workshops/currency';

export type PayoffEnv = {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
};

// Marks our payoff checkouts in their metadata, so the webhook can tell one
// from the purchase checkouts that also carry course_registration_id.
export const PAYOFF_PAYMENT_KIND = 'course_payoff';

export type PayoffBlock =
  | 'not_a_plan' // paid in one go, or the open-ended monthly pass
  | 'paypal' // PayPal holds the plan
  | 'not_started' // the plan never took its first payment
  | 'refunded' // money has gone back on it: not something to settle by link
  | 'settled' // nothing left to charge
  | 'nothing_due'; // the discount covers everything left

export type PayoffQuote = {
  block: PayoffBlock | null;
  currency: string; // upper-case
  cyclesLeft: number;
  remainingMinor: number; // before the discount
  discountMinor: number; // as applied (never more than what is left)
  dueMinor: number; // what the buyer pays
  // What the installments already charged took (the course line only).
  chargedMinor: number;
};

function cycleShare(amount: number, cycles: number, total: number): number {
  return total > 0 ? Math.round((amount * cycles) / total) : 0;
}

// How many installments the plan is still owed. A live plan: up to its
// effective end (an admin's early stop is honoured). A plan closed because a
// month went unpaid: everything the buyer signed for.
function owedCycles(reg: CourseRegistration): number {
  return reg.status === 'cancelled' ? reg.installments_total : effectiveTotal(reg);
}

export function payoffQuote(reg: CourseRegistration, discountMinor: number): PayoffQuote {
  const currency = (reg.currency || 'EUR').toUpperCase();
  const total = reg.installments_total;
  const charged = cycleShare(reg.amount_cents, Math.min(reg.installments_paid, total), total);
  const base: PayoffQuote = {
    block: null,
    currency,
    cyclesLeft: 0,
    remainingMinor: 0,
    discountMinor: 0,
    dueMinor: 0,
    chargedMinor: charged,
  };
  if (total <= 1) return { ...base, block: 'not_a_plan' };
  if (reg.provider === 'paypal') return { ...base, block: 'paypal' };
  if (reg.status === 'refunded' || (reg.refunded_amount_cents ?? 0) > 0) {
    return { ...base, block: 'refunded' };
  }
  if (reg.installments_paid < 1 || (reg.status !== 'paid' && reg.status !== 'cancelled')) {
    return { ...base, block: 'not_started' };
  }
  const owed = owedCycles(reg);
  const cyclesLeft = Math.max(0, owed - reg.installments_paid);
  if (cyclesLeft === 0) return { ...base, block: 'settled' };
  const remaining = cycleShare(reg.amount_cents, owed, total) - charged;
  if (remaining <= 0) return { ...base, block: 'settled' };
  const discount = Math.min(Math.max(0, Math.round(discountMinor)), remaining);
  const due = remaining - discount;
  return {
    ...base,
    block: due <= 0 ? 'nothing_due' : null,
    cyclesLeft,
    remainingMinor: remaining,
    discountMinor: discount,
    dueMinor: due,
  };
}

// One line for the admin, saying what the link will ask for.
export function payoffSummary(q: PayoffQuote): string {
  const m = (n: number) => formatMoney(n, q.currency);
  const left = `${q.cyclesLeft} installment${q.cyclesLeft === 1 ? '' : 's'} left (${m(q.remainingMinor)})`;
  return q.discountMinor > 0
    ? `${left} − ${m(q.discountMinor)} discount = ${m(q.dueMinor)} to pay`
    : `${left} = ${m(q.dueMinor)} to pay`;
}

// ── Start: the click ──────────────────────────────────────────────────────

export type StartPayoffResult =
  | { ok: true; url: string }
  | { ok: false; error: 'blocked'; block: PayoffBlock }
  | { ok: false; error: 'not_configured' | 'gateway'; detail?: string };

export async function startPayoff(
  env: PayoffEnv,
  reg: CourseRegistration,
  token: string,
  discountMinor: number,
  origin: string,
): Promise<StartPayoffResult> {
  const q = payoffQuote(reg, discountMinor);
  if (q.block) return { ok: false, error: 'blocked', block: q.block };
  if (!env.STRIPE_SECRET_KEY) return { ok: false, error: 'not_configured' };

  // The plan's own Stripe customer, so the payment sits beside the
  // installments in Stripe. If it can't be read, Checkout makes one from the
  // address — the payment still lands and is recorded the same way.
  let customer: string | null = null;
  if (reg.stripe_subscription_id) {
    try {
      const sub = await retrieveSubscriptionWithLatestInvoice(
        env.STRIPE_SECRET_KEY,
        reg.stripe_subscription_id,
      );
      customer = sub.customer;
    } catch {
      customer = null;
    }
  }

  const course = courseDisplayName(reg.product_slug);
  const label = `${course.charAt(0).toUpperCase()}${course.slice(1)} — the rest of your payment plan (order C-${reg.id})`;
  const back = payoffUrl(origin, token);
  // Bucketed by the hour, like the balance link: a double click gets the same
  // page, tomorrow's click a live one. The amount is in the key, so a link
  // used after another month was charged mints a page for the new figure.
  const bucket = Math.floor(Date.now() / 3_600_000);
  try {
    const session = await createCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      ...(customer ? { customer } : { customer_email: reg.email }),
      // {CHECKOUT_SESSION_ID} must reach Stripe as literal braces.
      success_url: `${back}&${PAYOFF_SESSION_PARAM}={CHECKOUT_SESSION_ID}`,
      cancel_url: payoffUrl(origin, token, { stay: true }),
      payment_intent_description: label,
      immediate_methods_only: true,
      line_items: [
        {
          name: label,
          amount_cents: q.dueMinor,
          currency: q.currency.toLowerCase(),
          quantity: 1,
        },
      ],
      metadata: {
        payment_kind: PAYOFF_PAYMENT_KIND,
        course_registration_id: String(reg.id),
        product_slug: reg.product_slug,
        payoff_cycles: String(q.cyclesLeft),
        payoff_discount_minor: String(q.discountMinor),
        payoff_due_minor: String(q.dueMinor),
      },
      idempotency_key: `payoff-${reg.id}-${q.dueMinor}-${bucket}`,
    });
    return { ok: true, url: session.url };
  } catch (err) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'course.payoff.start_failed',
      source: 'stripe',
      payload: { course_registration_id: reg.id, error: String(err) },
    });
    return { ok: false, error: 'gateway', detail: String(err) };
  }
}

// ── Apply: once it is paid ────────────────────────────────────────────────

export type ApplyPayoffResult =
  | { result: 'paid'; paidMinor: number; currency: string }
  | { result: 'processing' } // a bank debit still clearing
  | { result: 'not_paid' } // the checkout was left, or isn't ours
  | { result: 'error'; detail: string };

const appliedId = (sessionId: string) => `course-payoff-${sessionId}`;

export async function applyPayoff(
  env: PayoffEnv,
  regId: number,
  sessionId: string,
): Promise<ApplyPayoffResult> {
  if (!env.STRIPE_SECRET_KEY) return { result: 'error', detail: 'Stripe not configured' };
  let session;
  try {
    session = await retrievePaymentCheckoutSession(env.STRIPE_SECRET_KEY, sessionId);
  } catch (err) {
    return { result: 'error', detail: String(err) };
  }
  if (
    session.metadata.payment_kind !== PAYOFF_PAYMENT_KIND ||
    session.metadata.course_registration_id !== String(regId)
  ) {
    return { result: 'not_paid' };
  }
  if (session.status === 'complete' && session.payment_status !== 'paid') {
    return { result: 'processing' };
  }
  if (session.payment_status !== 'paid') return { result: 'not_paid' };

  const paidMinor = session.amount_total;
  const currency = session.currency;

  // One claim per checkout: the return page and the webhook both get here,
  // and only the first does the work.
  const claimed = await db_claim(env.DB, appliedId(sessionId), {
    course_registration_id: regId,
    session_id: sessionId,
    payment_intent: session.payment_intent,
    amount_minor: paidMinor,
    currency,
    cycles: Number(session.metadata.payoff_cycles ?? 0),
    discount_minor: Number(session.metadata.payoff_discount_minor ?? 0),
  });
  if (!claimed) return { result: 'paid', paidMinor, currency };

  const reg = await getCourseRegistrationById(env.DB, regId);
  if (!reg) return { result: 'error', detail: 'order not found' };

  try {
    const charged = cycleShare(
      reg.amount_cents,
      Math.min(reg.installments_paid, reg.installments_total),
      reg.installments_total,
    );
    // Written BEFORE the subscription is cancelled: the
    // customer.subscription.deleted webhook reads installments_paid to tell a
    // finished plan (keeps status 'paid') from one that ended owing money
    // (flips it to 'cancelled').
    await env.DB
      .prepare(
        `UPDATE course_registrations
            SET installments_paid = installments_total,
                amount_cents = ?,
                cancel_after_installment = NULL,
                status = 'paid',
                cancelled_at = NULL
          WHERE id = ? AND status IN ('paid', 'cancelled')`,
      )
      .bind(charged + paidMinor, reg.id)
      .run();
  } catch (err) {
    await db_release(env.DB, appliedId(sessionId));
    return { result: 'error', detail: String(err) };
  }

  await closeAtStripe(env, reg, sessionId);
  return { result: 'paid', paidMinor, currency };
}

// Nothing more is charged: cancel the subscription if it is still running, and
// void any month Stripe was still holding open (the payoff covered it).
// Failures are logged, never thrown — the money is in and recorded.
async function closeAtStripe(
  env: PayoffEnv,
  reg: CourseRegistration,
  sessionId: string,
): Promise<void> {
  const key = env.STRIPE_SECRET_KEY as string;
  const subId = reg.stripe_subscription_id;
  if (!subId) return;
  const voided: string[] = [];
  try {
    const sub = await retrieveSubscriptionWithLatestInvoice(key, subId);
    if (sub.status !== 'canceled' && sub.status !== 'incomplete_expired') {
      await cancelSubscriptionNow(key, subId);
    }
    await env.DB
      .prepare(`UPDATE course_registrations SET subscription_status = 'canceled' WHERE id = ?`)
      .bind(reg.id)
      .run();
    const open = await listOutstandingSubscriptionInvoices(key, subId);
    for (const inv of open) {
      if (inv.status !== 'open') continue;
      await voidInvoice(key, inv.id, `payoff-void-${inv.id}`);
      voided.push(inv.id);
    }
  } catch (err) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'course.payoff.close_failed',
      source: 'stripe',
      payload: { course_registration_id: reg.id, session_id: sessionId, error: String(err) },
    });
  }
  // A failed-payment reminder must not go out for a month that has been paid.
  try {
    await env.DB
      .prepare(
        `UPDATE course_dunning SET resolved_at = datetime('now'), resolution = 'paid'
          WHERE course_registration_id = ? AND resolved_at IS NULL`,
      )
      .bind(reg.id)
      .run();
  } catch {
    // Table not migrated (preview) — nothing to close.
  }
  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'course.payoff.closed',
    source: 'stripe',
    payload: { course_registration_id: reg.id, subscription_id: subId, voided_invoices: voided },
  });
}

async function db_claim(
  db: D1Database,
  externalId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id, payload_json)
       VALUES (NULL, 'course.plan.paid_off', 'stripe', ?, ?)`,
    )
    .bind(externalId, JSON.stringify(payload))
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

async function db_release(db: D1Database, externalId: string): Promise<void> {
  await db
    .prepare(`DELETE FROM events WHERE external_id = ? AND kind = 'course.plan.paid_off'`)
    .bind(externalId)
    .run();
}
