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
import {
  notifyCourseOrder,
  notifyRetreatOrder,
  fulfilDeckGift,
} from './notification';
import { getCourseRegistrationById } from '../courses/db';
import { getRegistrationById } from '../registrations/db';
import { DECK_GIFT_BUMP_SLUG } from '../courses/deck-promo';

export type ReconcileResult = { course: number; retreat: number; deckGift: number };

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
  const result: ReconcileResult = { course: 0, retreat: 0, deckGift: 0 };
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

  // Song Deck gift fulfilment: a paid course order can have had its SD-ORDER go
  // out while the gift itself never completed — a Shopify call that failed (its
  // claim releases on failure), a placed order whose confirmation email dropped,
  // or a claim email that never sent — which the order-notify sweep above would
  // never revisit. A gift is "done" when the coupon claim email went out, OR the
  // Shopify order was placed AND its confirmation email went out. Find
  // gift-carrying paid orders in the window that are NOT done and re-run
  // fulfilment; fulfilDeckGift claims-then-acts on every branch, so a placed
  // order won't re-place and a sent email won't re-send.
  const giftRes = await env.DB
    .prepare(
      `SELECT o.id AS id
         FROM course_registrations o
         LEFT JOIN events shop
           ON shop.external_id = ('deck-gift-shopify-' || o.id)
          AND shop.kind = 'deck.gift.shopify.created'
         LEFT JOIN events conf
           ON conf.external_id = ('deck-gift-confirmed-' || o.id)
          AND conf.kind = 'deck.gift.confirmed.sent'
         LEFT JOIN events claim
           ON claim.external_id = ('deck-gift-claim-' || o.id)
          AND claim.kind = 'deck.gift.claim.sent'
        WHERE o.status = 'paid'
          AND o.paid_at IS NOT NULL
          AND o.paid_at >= datetime('now', ?)
          AND o.bumps LIKE ?
          AND claim.id IS NULL
          AND (shop.id IS NULL OR conf.id IS NULL)
        ORDER BY o.paid_at ASC
        LIMIT ?`,
    )
    .bind(dayModifier, `%${DECK_GIFT_BUMP_SLUG}%`, cap)
    .all<{ id: number }>();
  for (const row of giftRes.results ?? []) {
    const reg = await getCourseRegistrationById(env.DB, row.id);
    if (!reg) continue;
    await fulfilDeckGift(env, reg);
    result.deckGift += 1;
  }

  return result;
}
