// Shared "purchase → Drip order" assembly. One place that turns any of the
// three purchase shapes (retreat registration, course registration, workshop
// registration) into a Drip Shopper Activity order, so the live paid-handlers
// and the historical backfill build identical orders.
//
// Drip derives each subscriber's lifetime value from these orders natively, and
// the order is keyed on a stable `order_id` (retreat-<id> / course-<id> /
// workshop-<id>) so re-sending is idempotent — it updates the same order rather
// than double-counting. That makes every caller safe to re-run.

import {
  recordOrder,
  type DripConfig,
  type DripOrder,
  type DripOrderItem,
} from '../registrations/drip';
import { logEvent } from '../registrations/db';

export type PurchaseType = 'retreat' | 'course' | 'workshop';

export type PurchaseOrderItem = {
  name: string;
  slug?: string | null;
  // Line total in MINOR units (cents). One unit each unless `quantity` is set.
  amountCents: number;
  quantity?: number;
};

export type PurchaseOrder = {
  type: PurchaseType;
  id: number; // source row id (registrations / course_registrations / workshop_registrations)
  email: string;
  currency: string;
  // Full order value in MINOR units (course/ticket + bumps). 0 for a free/comp.
  grandTotalCents: number;
  taxCents?: number | null;
  // When the purchase was paid (paid_at). Drip times the order activity by it,
  // which keeps the historical backfill from looking like a flood of "today"
  // orders. ISO-8601 or sqlite "YYYY-MM-DD HH:MM:SS" (UTC) both accepted.
  occurredAt?: string | null;
  items: PurchaseOrderItem[];
  properties?: Record<string, string | number | null>;
  orderUrl?: string | null;
};

// Stable, collision-free order id per purchase type. Used both to build the
// order and (in the backfill) to enumerate what still needs sending.
export function purchaseOrderId(type: PurchaseType, id: number): string {
  return `${type}-${id}`;
}

// sqlite "YYYY-MM-DD HH:MM:SS" (UTC) or an ISO string → ISO-8601 with Z.
function toIso(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

const major = (cents: number) => Math.round(cents) / 100;

export function buildDripOrder(p: PurchaseOrder): DripOrder {
  const items: DripOrderItem[] = p.items
    .filter((it) => it.name)
    .map((it) => {
      const quantity = it.quantity && it.quantity > 0 ? it.quantity : 1;
      return {
        name: it.name,
        product_id: it.slug || undefined,
        sku: it.slug || undefined,
        price: major(Math.round(it.amountCents / quantity)),
        quantity,
        total: major(it.amountCents),
      };
    });
  return {
    email: p.email,
    action: 'placed',
    order_id: purchaseOrderId(p.type, p.id),
    grand_total: major(p.grandTotalCents),
    total_taxes: p.taxCents != null ? major(p.taxCents) : undefined,
    currency: (p.currency || 'EUR').toUpperCase(),
    occurred_at: toIso(p.occurredAt),
    order_url: p.orderUrl || undefined,
    items,
    properties: { purchase_type: p.type, ...(p.properties ?? {}) },
  };
}

export function dripConfig(env: {
  DRIP_API_TOKEN?: string;
  DRIP_ACCOUNT_ID?: string;
}): DripConfig | null {
  return env.DRIP_API_TOKEN && env.DRIP_ACCOUNT_ID
    ? { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID }
    : null;
}

type RecordEnv = {
  DB: D1Database;
  DRIP_API_TOKEN?: string;
  DRIP_ACCOUNT_ID?: string;
};

// Build + send the order, fully self-guarded so a Drip hiccup never blocks
// fulfillment. Returns true on a successful send, false if skipped (no creds)
// or it errored (logged to the `events` audit log). `logKind` lets each caller
// tag its own error stream (drip.retreat.order.error, …).
export async function recordPurchaseOrder(
  env: RecordEnv,
  p: PurchaseOrder,
  logKind = 'drip.order.error',
): Promise<boolean> {
  const cfg = dripConfig(env);
  if (!cfg) return false;
  try {
    await recordOrder(cfg, buildDripOrder(p));
    return true;
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: logKind,
      source: 'system',
      payload: { type: p.type, id: p.id, error: String(err) },
    });
    return false;
  }
}
