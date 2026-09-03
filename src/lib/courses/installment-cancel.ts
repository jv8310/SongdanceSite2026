// Admin-scheduled early cancellation of an installment-plan course purchase.
//
// From the Future-revenue page the host can stop an open plan early:
//   keep = 0            → stop ALL upcoming charges now (cancel the subscription)
//   keep = remaining-1  → cancel only the last charge (let it bill once more)
//   keep = k (1..rem)   → bill k more times, then stop
//   keep = remaining    → keep the full plan (clears any earlier schedule)
//
// We record the intended stop as a TOTAL charge count on the row
// (`cancel_after_installment` = installments_paid + keep, NULL when it's the
// full plan) so the forecast immediately reflects the forgiven charges, and we
// enforce it on the gateway:
//   • Stripe — move the subscription's cancel_at to just after the Nth charge,
//     or DELETE it now for keep=0. Stripe stops billing on its own; the
//     resulting webhook folds the terminal state onto the row.
//   • PayPal — a finite subscription can't be given a future *partial* cancel
//     date, so keep=0 cancels immediately and a partial keep is enforced by the
//     PAYMENT.SALE.COMPLETED webhook (enforcePaypalScheduledCancel) the moment
//     the target charge lands.
//
// The buyer keeps whatever access earlier installments granted — this only stops
// future charges; it never refunds or revokes.

import {
  addMonthsUnix,
  cancelSubscriptionNow,
  retrieveSubscriptionWithLatestInvoice,
  setSubscriptionCancelAt,
  setSubscriptionCancelAtPeriodEnd,
} from '../registrations/stripe';
import { cancelSubscription, paypalConfigured } from '../payments/paypal';
import {
  getCourseRegistrationById,
  setCourseCancelAfterInstallment,
  type CourseRegistration,
} from './db';
import { logEvent } from '../registrations/db';

export type CancelEnv = {
  DB: D1Database;
  STRIPE_SECRET_KEY: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_ENV?: string;
} & Record<string, unknown>;

// Unix-seconds cancel_at that allows exactly `total` full charges: the instant
// the (total+1)th would fall due. It has to be that boundary exactly — Stripe
// prorates the invoice of any period the cancellation lands inside, so a stop
// placed "a couple of weeks after the last charge" bills that last charge at a
// fraction (the bug this file used to share with the checkout webhook), while
// a stop past the boundary buys one more charge. Returns null when the boundary
// is not in the future: Stripe rejects a past cancel_at, and the caller stops
// the plan at the current period end instead (also proration-free).
function cancelAtForTotal(anchorUnix: number, total: number): number | null {
  const at = addMonthsUnix(anchorUnix, total);
  return at > Math.floor(Date.now() / 1000) + 60 ? at : null;
}

// Stripe's own billing anchor for a subscription (unix seconds), or null if it
// can't be read. Every billing period is `anchor + k months`, so this is the
// only timestamp a cancellation can be pinned to exactly.
async function stripeBillingAnchor(
  env: CancelEnv,
  subscriptionId: string,
): Promise<number | null> {
  try {
    const sub = await retrieveSubscriptionWithLatestInvoice(
      env.STRIPE_SECRET_KEY,
      subscriptionId,
    );
    return sub.billing_cycle_anchor;
  } catch {
    return null;
  }
}

export type CancelResult =
  | { ok: true; target: number; keep: number; cleared: boolean; immediate: boolean }
  | { ok: false; reason: string };

// Is this plan in a state where an early-stop can still be scheduled?
export function isCancellablePlan(reg: CourseRegistration): boolean {
  return (
    reg.installments_total > 1 &&
    reg.installments_paid < reg.installments_total &&
    reg.status === 'paid' &&
    reg.subscription_status !== 'canceled' &&
    reg.subscription_status !== 'incomplete_expired'
  );
}

// The wording for one "keep N more charges" option, so the Future-revenue table
// and the per-order installments panel offer the same choices in the same
// words. `origRemaining` is how many charges the plan has left to make.
export function keepLabel(k: number, origRemaining: number): string {
  if (k === 0) {
    return origRemaining === 1
      ? 'Stop now · cancel the last charge'
      : `Stop now · cancel all ${origRemaining} upcoming`;
  }
  if (k >= origRemaining) return `Keep full plan (${origRemaining} more)`;
  const base = `Bill ${k} more, then stop`;
  return k === origRemaining - 1 ? `${base} · only the last cancelled` : base;
}

export async function scheduleInstallmentCancellation(
  env: CancelEnv,
  regId: number,
  keepRaw: number,
): Promise<CancelResult> {
  const reg = await getCourseRegistrationById(env.DB, regId);
  if (!reg) return { ok: false, reason: 'Registration not found' };
  if (!isCancellablePlan(reg)) {
    return { ok: false, reason: 'This plan can no longer be changed' };
  }
  if (!reg.paid_at) return { ok: false, reason: 'Plan has no billing anchor yet' };

  const remaining = reg.installments_total - reg.installments_paid;
  const keep = Math.max(0, Math.min(keepRaw, remaining));
  const target = reg.installments_paid + keep; // total charges to ever make
  const cleared = target >= reg.installments_total; // "keep the full plan"
  const immediate = keep === 0;

  const anchor = Date.parse(reg.paid_at);
  if (immediate && !Number.isFinite(anchor)) {
    // keep=0 doesn't need the anchor; fall through. Other cases need it.
  } else if (!Number.isFinite(anchor)) {
    return { ok: false, reason: 'Plan has no valid billing anchor' };
  }

  // ── Gateway action ──
  if (reg.provider === 'paypal') {
    if (!reg.paypal_subscription_id) {
      return { ok: false, reason: 'No PayPal subscription to change' };
    }
    if (immediate) {
      if (!paypalConfigured(env)) {
        return { ok: false, reason: 'PayPal is not configured here' };
      }
      await cancelSubscription(env, reg.paypal_subscription_id, 'Cancelled by Songdance (admin)');
    }
    // A partial keep (≥1) is enforced by the installment webhook once the
    // target charge lands — nothing to call on PayPal right now.
  } else {
    if (!reg.stripe_subscription_id) {
      return { ok: false, reason: 'No Stripe subscription to change' };
    }
    if (immediate) {
      await cancelSubscriptionNow(env.STRIPE_SECRET_KEY, reg.stripe_subscription_id);
    } else {
      // Schedule (or restore) cancel_at to the billing boundary right after the
      // chosen last charge. Restoring the full plan re-points it at the natural
      // end. The boundary must come from Stripe's own billing_cycle_anchor: our
      // `paid_at` is stamped when the first invoice was *recorded*, which can be
      // minutes late, and a cancel_at even slightly past the boundary buys an
      // extra charge. If Stripe won't tell us, fall back to paid_at pulled an
      // hour back — the safe direction (at worst a ~0.1% proration on the final
      // charge), and the hourly reconcile re-pins it to the exact boundary.
      const anchorUnix =
        (await stripeBillingAnchor(env, reg.stripe_subscription_id)) ??
        Math.floor(anchor / 1000) - 3600;
      const at = cancelAtForTotal(
        anchorUnix,
        cleared ? reg.installments_total : target,
      );
      if (at == null) {
        // The boundary is already behind us (the last allowed charge has been
        // taken). Stop at the end of the current period — same instant, and
        // Stripe accepts it where a past timestamp would be rejected.
        await setSubscriptionCancelAtPeriodEnd(
          env.STRIPE_SECRET_KEY,
          reg.stripe_subscription_id,
        );
      } else {
        await setSubscriptionCancelAt(
          env.STRIPE_SECRET_KEY,
          reg.stripe_subscription_id,
          at,
        );
      }
    }
  }

  await setCourseCancelAfterInstallment(env.DB, reg.id, cleared ? null : target);

  await logEvent(env.DB, {
    registration_id: null,
    kind: 'course.installment.cancel.scheduled',
    source: 'admin',
    payload: {
      course_registration_id: reg.id,
      provider: reg.provider,
      installments_paid: reg.installments_paid,
      installments_total: reg.installments_total,
      keep,
      target,
      cleared,
      immediate,
    },
  });

  return { ok: true, target, keep, cleared, immediate };
}

// Webhook hook: after a PayPal installment is recorded, cancel the subscription
// if it has reached its admin-scheduled stop. Safe to call unconditionally —
// it no-ops unless a partial schedule is set and now satisfied. Pass the FRESH
// row (post-increment) so installments_paid is current.
export async function enforcePaypalScheduledCancel(
  env: CancelEnv,
  reg: CourseRegistration,
): Promise<void> {
  if (reg.provider !== 'paypal') return;
  if (reg.cancel_after_installment == null) return;
  if (reg.installments_paid < reg.cancel_after_installment) return;
  if (!reg.paypal_subscription_id) return;
  if (
    reg.subscription_status === 'canceled' ||
    reg.subscription_status === 'incomplete_expired'
  ) {
    return;
  }
  if (!paypalConfigured(env)) return;
  try {
    await cancelSubscription(
      env,
      reg.paypal_subscription_id,
      'Scheduled stop reached (Songdance)',
    );
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'course.installment.cancel.enforced',
      source: 'paypal',
      external_id: `paypal-sched-cancel-${reg.paypal_subscription_id}`,
      payload: {
        course_registration_id: reg.id,
        subscription_id: reg.paypal_subscription_id,
        installments_paid: reg.installments_paid,
        cancel_after_installment: reg.cancel_after_installment,
      },
    });
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'course.installment.cancel.enforce.failed',
      source: 'paypal',
      payload: {
        course_registration_id: reg.id,
        subscription_id: reg.paypal_subscription_id,
        error: String(err),
      },
    });
  }
}
