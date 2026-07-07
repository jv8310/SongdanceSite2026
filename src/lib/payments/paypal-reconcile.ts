// Safety-net reconcile for the direct PayPal gateway — the missing backstop that
// makes PayPal course recognition survive a dropped/unverified webhook.
//
// WHY THIS EXISTS. A PayPal installment (3×/6×/12×) course subscription's
// installments are recorded ONLY by the PAYMENT.SALE.COMPLETED webhook: the
// buyer-return handler deliberately skips the first installment (see
// paypal-return.ts), and nothing else calls recordCoursePaypalInstallment. So
// if that webhook is never
// delivered or fails signature verification (e.g. a missing/mismatched
// PAYPAL_WEBHOOK_ID → verifyPaypalWebhook returns false → the endpoint 400s
// every event), PayPal keeps charging the customer while the order sits PENDING
// at 0/N — no access, no SD-ORDER, no Drip, and no automated recovery. One-off
// PayPal orders don't have this hole (the return handler fulfils them
// synchronously); only subscriptions do.
//
// WHAT IT DOES. Wired into the hourly cron (like src/lib/orders/reconcile.ts),
// each tick it finds PENDING PayPal *course* rows in a recent window and polls
// PayPal directly:
//   (A) installment subscriptions → read the subscription's transactions and
//       record every COMPLETED cycle via recordCoursePaypalInstallment.
//   (B) full-payment one-offs → read the order and, ONLY if a capture already
//       COMPLETED, fulfil it (never captures — capturing here would charge a
//       genuinely abandoned checkout days later).
//
// SAFETY. Everything funnels through the same idempotent fulfilment the webhook
// uses (recordCoursePaypalInstallment / fulfillCoursePaypalOneOff, both guarded
// on the capture/sale id in the events log), so a later-arriving webhook can
// never double-count, and steady state (webhook healthy) finds nothing. It is
// read-only against PayPal, never performs the terminal EXPIRED/CANCELLED coarse
// flip itself (that would risk cancelling a fully-paid completed plan), and
// tolerates per-row PayPal errors so one bad row can't sink the sweep.

import {
  getSubscription,
  listSubscriptionTransactions,
  getOrder,
  paypalConfigured,
  type PaypalEnv,
} from './paypal';
import {
  recordCoursePaypalInstallment,
  fulfillCoursePaypalOneOff,
  applyPaypalSubscriptionStatus,
  type PaypalFulfillEnv,
} from './paypal-fulfill';
import { getCourseRegistrationById, type CourseRegistration } from '../courses/db';

export type PaypalReconcileEnv = PaypalFulfillEnv & PaypalEnv;

export type PaypalReconcileResult = {
  subscriptions: number; // pending subscription rows that gained ≥1 installment
  installments: number; // total installment cycles recorded this run
  oneOffs: number; // pending one-off orders fulfilled this run
};

// A subscription row leaves 'pending' the moment its first cycle is recorded, so
// this window governs how far back we still look for a row stuck pending — wide
// (120 days) so a stall that went unnoticed for weeks is still recovered; the
// first cycle it needs always settled within days of checkout, regardless of
// plan length (3×/6×/12×). One-off orders that never captured within days are
// dead (PayPal purges the order resource anyway), so theirs is short.
const SUB_DAYS = 120;
const ONEOFF_DAYS = 7;
const DEFAULT_CAP = 25;

// D1's datetime('now') is 'YYYY-MM-DD HH:MM:SS' (UTC, no tz); PayPal wants
// RFC-3339 with a Z. Fall back to "now" if the stored value can't be parsed.
function toRfc3339(sqliteTs: string): string {
  const ms = Date.parse(sqliteTs.replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

async function pendingPaypalCourseRows(
  db: D1Database,
  extraWhere: string,
  dayModifier: string,
  cap: number,
): Promise<CourseRegistration[]> {
  // `provider = 'paypal'` is essential: pending *Stripe* rows also have
  // paid_at IS NULL and must never be polled against PayPal.
  const res = await db
    .prepare(
      `SELECT * FROM course_registrations
        WHERE provider = 'paypal'
          AND status = 'pending'
          ${extraWhere}
          AND created_at >= datetime('now', ?)
        ORDER BY created_at ASC
        LIMIT ?`,
    )
    .bind(dayModifier, cap)
    .all<CourseRegistration>();
  return res.results ?? [];
}

export async function reconcilePaypalCourseOrders(
  env: PaypalReconcileEnv,
  opts: { subDays?: number; oneOffDays?: number; cap?: number } = {},
): Promise<PaypalReconcileResult> {
  const result: PaypalReconcileResult = { subscriptions: 0, installments: 0, oneOffs: 0 };
  // No-op until the PayPal secrets exist (mirrors reconcile.ts's RESEND gate).
  if (!paypalConfigured(env)) return result;

  const cap = Math.max(1, Math.floor(opts.cap ?? DEFAULT_CAP));
  const subMod = `-${Math.max(1, Math.floor(opts.subDays ?? SUB_DAYS))} days`;
  const oneOffMod = `-${Math.max(1, Math.floor(opts.oneOffDays ?? ONEOFF_DAYS))} days`;

  // ── (A) installment subscriptions: record settled cycles PayPal charged ─────
  //    Any non-full plan is a PayPal subscription — 12-week is 3× only, but the
  //    certification checkout offers 3×/6×/12× (checkout.ts gates on
  //    `paymentPlan !== 'full'`), and the record loop below is generic over N.
  const subRows = await pendingPaypalCourseRows(
    env.DB,
    "AND payment_plan <> 'full' AND paypal_subscription_id IS NOT NULL",
    subMod,
    cap,
  );
  for (const row of subRows) {
    const subscriptionId = row.paypal_subscription_id;
    if (!subscriptionId) continue;
    try {
      // Window the transactions query from just before checkout to now. Both
      // bounds are required by PayPal; a day of slack absorbs clock skew.
      const startIso = new Date(
        Date.parse(toRfc3339(row.created_at)) - 86_400_000,
      ).toISOString();
      const endIso = new Date(Date.now() + 60_000).toISOString();
      const txns = await listSubscriptionTransactions(
        env,
        subscriptionId,
        startIso,
        endIso,
      );
      // Money actually received: COMPLETED (or PARTIALLY_REFUNDED — net still in).
      // Oldest first so the first-cycle side effects (access + SD-ORDER) fire on
      // the genuine first cycle exactly once.
      const settled = txns
        .filter((t) => t.status === 'COMPLETED' || t.status === 'PARTIALLY_REFUNDED')
        .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
      if (settled.length === 0) continue;

      let recorded = 0;
      for (const t of settled) {
        // Re-fetch each iteration so installments_paid (and thus the "was this
        // the first cycle?" test inside recordCoursePaypalInstallment) is fresh
        // across a multi-cycle backlog — otherwise every cycle looks like #1.
        const fresh = await getCourseRegistrationById(env.DB, row.id);
        if (!fresh) break;
        // Respect a genuine admin cancel / refund — never resurrect it.
        if (fresh.status === 'cancelled' || fresh.status === 'refunded') break;
        const did = await recordCoursePaypalInstallment(env, fresh, t.id, t.id);
        if (did) {
          recorded += 1;
          result.installments += 1;
        }
      }

      if (recorded > 0) {
        result.subscriptions += 1;
        // Mirror the live badge status for a recovered row — but only the
        // non-terminal states. We never let the sweep perform the
        // EXPIRED/CANCELLED → coarse-cancel flip (markCourseRegistrationCancelled
        // would cancel a fully-paid completed plan); leave that to the webhook.
        try {
          const sub = await getSubscription(env, subscriptionId);
          const up = (sub.status || '').toUpperCase();
          if (up !== 'CANCELLED' && up !== 'EXPIRED') {
            await applyPaypalSubscriptionStatus(env, subscriptionId, sub.status);
          }
        } catch {
          // Status mirror is cosmetic; the money is already recorded.
        }
      }
    } catch {
      // Transient PayPal error / rate limit / range reject — leave the row for
      // the next tick. The whole sweep must never throw on one bad row.
      continue;
    }
  }

  // ── (B) full-payment one-offs that captured but never fulfilled ─────────────
  //    (buyer closed the tab AND the webhook was missed). Read-only: only fulfil
  //    an order that ALREADY has a COMPLETED capture — never call captureOrder.
  const oneOffRows = await pendingPaypalCourseRows(
    env.DB,
    "AND payment_plan = 'full' AND paypal_order_id IS NOT NULL AND paypal_capture_id IS NULL",
    oneOffMod,
    cap,
  );
  for (const row of oneOffRows) {
    const orderId = row.paypal_order_id;
    if (!orderId) continue;
    try {
      const capture = await getOrder(env, orderId);
      if (capture.captureId && capture.captureStatus === 'COMPLETED') {
        // Idempotent on the capture id — converges with the webhook path.
        await fulfillCoursePaypalOneOff(env, row.id, capture);
        result.oneOffs += 1;
      }
    } catch {
      // Order resource may be purged (404) or PayPal transient — skip, continue.
      continue;
    }
  }

  return result;
}
