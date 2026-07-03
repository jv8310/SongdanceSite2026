// Safety net for the internal "SD-ORDER" notifications: re-send any that never
// went out. These fire per-purchase from the payment webhooks with an
// idempotent claim in the `events` log (external_id `order-notify-<type>-<id>`,
// kind `order.notification.sent`) — a separate path from the reporting/orders
// queries, so a normal run finds nothing. But if a webhook errored, Resend had
// a blip, or a send was interrupted, the claim was released (or never made) and
// the email is simply missing. This sweep finds paid course/retreat orders in a
// recent window that carry no sent-claim and re-notifies them.
//
// Wired into the hourly cron. Bounded (recent window + per-run cap) and
// idempotent (the notification claims before sending, so a re-run can't double
// up), so it is safe to run every tick: steady state finds zero.
//
// Scope mirrors sendOrderNotification: course + retreat orders only. Workshop
// registrations never send SD-ORDER emails (high-volume, by design).

import type { OrderEnv } from './notification';
import { notifyCourseOrder, notifyRetreatOrder } from './notification';
import { getCourseRegistrationById } from '../courses/db';
import { getRegistrationById } from '../registrations/db';

export type ReconcileResult = { course: number; retreat: number };

// Rows paid this recently, with no `order.notification.sent` claim, are
// considered missed. The window bounds any first-run catch-up; the cap bounds a
// single tick's work (and its outbound sends / Drip lookups).
const DEFAULT_DAYS = 7;
const DEFAULT_CAP = 25;

// Paid orders in the window whose notification never claimed a `sent` event.
// A LEFT JOIN on the synthesised external_id keeps this to two small queries —
// no id-list binding, so it is itself immune to the 100-param cap.
async function missingIds(
  db: D1Database,
  table: 'course_registrations' | 'registrations',
  notifyType: 'course' | 'retreat',
  dayModifier: string,
  cap: number,
): Promise<number[]> {
  const res = await db
    .prepare(
      `SELECT o.id AS id
         FROM ${table} o
         LEFT JOIN events e
           ON e.external_id = ('order-notify-${notifyType}-' || o.id)
          AND e.kind = 'order.notification.sent'
        WHERE o.status = 'paid'
          AND o.paid_at IS NOT NULL
          AND o.paid_at >= datetime('now', ?)
          AND e.id IS NULL
        ORDER BY o.paid_at ASC
        LIMIT ?`,
    )
    .bind(dayModifier, cap)
    .all<{ id: number }>();
  return (res.results ?? []).map((r) => r.id);
}

export async function reconcileOrderNotifications(
  env: OrderEnv,
  opts: { days?: number; cap?: number } = {},
): Promise<ReconcileResult> {
  const result: ReconcileResult = { course: 0, retreat: 0 };
  if (!env.RESEND_API_KEY) return result;

  const days = Math.max(1, Math.floor(opts.days ?? DEFAULT_DAYS));
  const cap = Math.max(1, Math.floor(opts.cap ?? DEFAULT_CAP));
  const dayModifier = `-${days} days`;

  // Course orders.
  const courseIds = await missingIds(env.DB, 'course_registrations', 'course', dayModifier, cap);
  for (const id of courseIds) {
    const reg = await getCourseRegistrationById(env.DB, id);
    if (!reg) continue;
    // notifyCourseOrder → sendOrderNotification claims then sends; never throws
    // and skips anything already claimed, so this can't double-send.
    await notifyCourseOrder(env, reg);
    result.course += 1;
  }

  // Retreat orders.
  const retreatIds = await missingIds(env.DB, 'registrations', 'retreat', dayModifier, cap);
  for (const id of retreatIds) {
    const reg = await getRegistrationById(env.DB, id);
    if (!reg) continue;
    await notifyRetreatOrder(env, reg);
    result.retreat += 1;
  }

  return result;
}
