// One installment-plan course order, cycle by cycle — the ledger behind the
// per-installment refund on /admin/orders/C-<id>.
//
// WHY THIS EXISTS. A course row stores the *plan total* in `amount_cents` (the
// invariant the whole attribution stack depends on) and only ever the FIRST
// charge id:
//
//   recordInstallmentPaid       → stripe_payment_intent = COALESCE(…, ?)
//   recordPaypalInstallmentPaid → paypal_capture_id     = COALESCE(…, ?)
//
// So installments 2..N exist only at the gateway. That made the admin refund
// button target installment 1 for every plan: a blank ("full") refund silently
// gave back one cycle while claiming to give back the plan total, and any
// amount larger than one cycle was rejected by the gateway. Refunding cycle 3
// meant opening the Stripe dashboard.
//
// The gateway is the source of truth for the cycles, so we read them live
// rather than mirroring them into D1 — a mirror could only ever be as fresh as
// the last webhook, and the webhook gap is exactly the failure mode that
// stranded plans before (see the reconciles). One admin page load, one plan.
//
// This module is also what the refund endpoint uses to VERIFY a target: the
// list is derived from the row's own subscription id, so an installment id that
// appears in it provably belongs to this order. A posted id is never trusted.

import {
  listSubscriptionInvoices,
  listRefundsForPaymentIntent,
  refundedMinorOf,
} from '../registrations/stripe';
import {
  listSubscriptionTransactions,
  paypalConfigured,
  type PaypalEnv,
} from '../payments/paypal';
import type { UnifiedOrder } from './orders';

export type InstallmentsEnv = PaypalEnv & {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
};

// A gateway that hangs must not hang the admin page. Same posture as the live
// Meta spend pull: hard cap, and a miss degrades to the fallback form.
const GATEWAY_TIMEOUT_MS = 8000;

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), GATEWAY_TIMEOUT_MS),
    ),
  ]);
}

export type Installment = {
  // Cycle number, 1-based, oldest first.
  seq: number;
  // The gateway's own id for the cycle: a Stripe invoice id, or a PayPal sale
  // (subscription transaction) id. This is what the refund form posts back.
  id: string;
  // What to show: Stripe's invoice number, else the id itself.
  reference: string;
  // The charge the refund is actually issued against — a Stripe PaymentIntent
  // or the PayPal sale id. Null (Stripe only, no PI on the invoice) means we
  // can't refund this cycle from here.
  refundTarget: string | null;
  amountMinor: number;
  currency: string;
  // Already refunded on THIS cycle. Null when the gateway doesn't tell us the
  // amount (PayPal reports a refunded *state*, not a figure) — the UI says so
  // rather than implying zero.
  refundedMinor: number | null;
  // Gateway status for the cycle, normalised to lowercase words.
  status: string;
  paidAt: string | null; // ISO 8601
};

export type InstallmentLedger = {
  provider: 'stripe' | 'paypal';
  rows: Installment[];
  // Set when the gateway couldn't be read. The page keeps working (it falls
  // back to the whole-order refund form) instead of 500ing on a Stripe blip.
  error: string | null;
};

// The subscription whose cycles we can enumerate, keyed on the SAME `provider`
// the refund endpoint branches on — so the ledger and the gateway call can
// never disagree about which API a cycle id belongs to. A row whose provider
// column contradicts the ids it carries simply has no ledger, and the page
// falls back to the ordinary single-charge form, exactly as before.
function ledgerSubscriptionOf(o: UnifiedOrder): string | null {
  if (o.source !== 'course') return null;
  if (o.installmentsTotal <= 1) return null;
  return o.provider === 'paypal' ? o.paypalSubscriptionId : o.stripeSubscriptionId;
}

// Is this order a multi-installment plan held at a gateway we can enumerate?
// A `full` course payment, a workshop, a retreat and a manual bank transfer all
// answer no — they have exactly one charge, which the ordinary form handles.
export function hasInstallmentLedger(o: UnifiedOrder): boolean {
  return !!ledgerSubscriptionOf(o);
}

// The cycles of an installment plan, oldest first. Returns null for an order
// that has no plan to enumerate (see hasInstallmentLedger).
export async function listOrderInstallments(
  env: InstallmentsEnv,
  o: UnifiedOrder,
): Promise<InstallmentLedger | null> {
  const subscriptionId = ledgerSubscriptionOf(o);
  if (!subscriptionId) return null;
  return o.provider === 'paypal'
    ? paypalLedger(env, subscriptionId, o.createdAt)
    : stripeLedger(env, subscriptionId);
}

// Find one cycle in an order's own ledger. This is the whole authorisation
// check for a per-installment refund: the ledger is built from the row's
// subscription id, so a hit proves the charge belongs to this order.
export async function findOrderInstallment(
  env: InstallmentsEnv,
  o: UnifiedOrder,
  installmentId: string,
): Promise<
  | { ok: true; installment: Installment }
  | { ok: false; reason: 'no_plan' | 'gateway_error' | 'not_found'; error: string | null }
> {
  const ledger = await listOrderInstallments(env, o);
  if (!ledger) return { ok: false, reason: 'no_plan', error: null };
  if (ledger.error) return { ok: false, reason: 'gateway_error', error: ledger.error };
  const hit = ledger.rows.find((r) => r.id === installmentId);
  if (!hit) return { ok: false, reason: 'not_found', error: null };
  return { ok: true, installment: hit };
}

// What is still refundable on one cycle, in the cycle's own currency. A cycle
// whose refunded figure is unknown (PayPal) offers its full amount and lets the
// gateway be the one to refuse an over-refund.
export function installmentRefundableMinor(i: Installment): number {
  return Math.max(0, i.amountMinor - (i.refundedMinor ?? 0));
}

// What ONE charge on this order was worth, without asking the gateway: the plan
// total divided by the plan length (`amount_cents` is always the whole plan).
//
// This is the honest ceiling for the whole-order refund form, which targets a
// single charge — the row's first PaymentIntent / capture. Offering the plan
// total there was the original bug: blank meant "full €1,347" on screen and one
// €449 installment at the gateway.
export function perChargeRefundableMinor(o: UnifiedOrder): number {
  const remaining = Math.max(0, o.originalAmountMinor - o.refundedMinor);
  if (o.installmentsTotal <= 1) return remaining;
  const perCharge = Math.round(o.originalAmountMinor / o.installmentsTotal);
  return Math.min(remaining, perCharge);
}

// ── Stripe ─────────────────────────────────────────────────────────────────

async function stripeLedger(
  env: InstallmentsEnv,
  subscriptionId: string,
): Promise<InstallmentLedger> {
  if (!env.STRIPE_SECRET_KEY) {
    return { provider: 'stripe', rows: [], error: 'Stripe is not configured' };
  }
  try {
    const invoices = (
      await withTimeout(
        listSubscriptionInvoices(env.STRIPE_SECRET_KEY, subscriptionId, {
          status: 'paid',
        }),
        'Stripe invoice list',
      )
    )
      .filter((inv) => inv.paid || inv.status === 'paid')
      .sort((a, b) => a.created - b.created);

    // Belt and braces on the refund anchor. Stripe's invoice shape moved in
    // basil and the PaymentIntent can come back null; but we logged it
    // ourselves when the cycle was recorded, keyed on the invoice id. So fill
    // any gap from our own events log rather than losing the cycle.
    const anchors = await localRefundAnchors(
      env.DB,
      invoices.filter((inv) => !inv.payment_intent).map((inv) => inv.id),
    );
    const targetOf = (inv: { id: string; payment_intent: string | null }) =>
      inv.payment_intent ?? anchors.get(inv.id) ?? null;

    // Refunds live on the charge, one lookup per cycle. A plan is 3/6/12 rows,
    // so this is a handful of parallel subrequests on an admin page nobody
    // loads in bulk. One failing lookup leaves that cycle's figure unknown
    // rather than sinking the whole panel.
    const refunded = await Promise.all(
      invoices.map(async (inv) => {
        const pi = targetOf(inv);
        if (!pi) return null;
        try {
          return refundedMinorOf(
            await withTimeout(
              listRefundsForPaymentIntent(env.STRIPE_SECRET_KEY!, pi),
              'Stripe refund list',
            ),
          );
        } catch {
          return null;
        }
      }),
    );

    return {
      provider: 'stripe',
      rows: invoices.map((inv, idx) => ({
        seq: idx + 1,
        id: inv.id,
        reference: inv.number ?? inv.id,
        refundTarget: targetOf(inv),
        amountMinor: inv.amount_paid,
        currency: inv.currency || '',
        refundedMinor: refunded[idx],
        status:
          refunded[idx] != null && refunded[idx]! >= inv.amount_paid && inv.amount_paid > 0
            ? 'refunded'
            : refunded[idx]
              ? 'partially refunded'
              : 'paid',
        paidAt: inv.created ? new Date(inv.created * 1000).toISOString() : null,
      })),
      error: null,
    };
  } catch (err) {
    return { provider: 'stripe', rows: [], error: String(err) };
  }
}

// ── PayPal ─────────────────────────────────────────────────────────────────

// PayPal's transactions endpoint needs both bounds; window it from just before
// checkout to now, the same way the safety-net reconcile does.
async function paypalLedger(
  env: InstallmentsEnv,
  subscriptionId: string,
  createdAt: string,
): Promise<InstallmentLedger> {
  if (!paypalConfigured(env)) {
    return { provider: 'paypal', rows: [], error: 'PayPal is not configured' };
  }
  try {
    const startMs = Date.parse(toRfc3339(createdAt));
    const startIso = new Date(
      (Number.isFinite(startMs) ? startMs : Date.now() - 400 * 86_400_000) - 86_400_000,
    ).toISOString();
    const endIso = new Date(Date.now() + 60_000).toISOString();
    const txns = (
      await withTimeout(
        listSubscriptionTransactions(env, subscriptionId, startIso, endIso),
        'PayPal transaction list',
      )
    )
      .filter((t) => t.status !== 'DECLINED' && t.status !== 'PENDING')
      .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));

    return {
      provider: 'paypal',
      rows: txns.map((t, idx) => ({
        seq: idx + 1,
        id: t.id,
        reference: t.id,
        // The cycle's own id IS the refund target: it is a capture in the
        // current Payments API, which is what refundSubscriptionCycle reverses.
        refundTarget: t.id,
        amountMinor: t.amountMinor ?? 0,
        currency: t.currency ?? '',
        // PayPal reports a refunded *state* per transaction, never an amount.
        // A fully REFUNDED cycle has nothing left, so say so outright (else the
        // panel would keep offering a refund PayPal will reject); a
        // PARTIALLY_REFUNDED one stays unknown and offers its full value, and
        // PayPal is the one to refuse an over-refund.
        refundedMinor: t.status === 'REFUNDED' ? (t.amountMinor ?? 0) : null,
        status: t.status.toLowerCase().replace(/_/g, ' '),
        paidAt: t.time,
      })),
      error: null,
    };
  } catch (err) {
    return { provider: 'paypal', rows: [], error: String(err) };
  }
}

// The PaymentIntent we recorded for each of these invoice ids, from our own
// `course.installment.recorded` events (external_id = the Stripe invoice id,
// payload carries the PI). Missing ids simply don't appear in the map.
async function localRefundAnchors(
  db: D1Database,
  invoiceIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!invoiceIds.length) return out;
  // D1 caps bound params at 100/statement; a plan is at most 12 cycles, so one
  // statement always suffices — slice defensively all the same.
  const ids = invoiceIds.slice(0, 90);
  const res = await db
    .prepare(
      `SELECT external_id, payload_json FROM events
        WHERE kind = 'course.installment.recorded'
          AND external_id IN (${ids.map(() => '?').join(',')})`,
    )
    .bind(...ids)
    .all<{ external_id: string; payload_json: string | null }>();
  for (const row of res.results ?? []) {
    try {
      const pi = JSON.parse(row.payload_json ?? '{}')?.payment_intent;
      if (typeof pi === 'string' && pi) out.set(row.external_id, pi);
    } catch {
      /* ignore malformed payloads */
    }
  }
  return out;
}

// D1 stores 'YYYY-MM-DD HH:MM:SS' in UTC; PayPal wants RFC 3339.
function toRfc3339(ts: string): string {
  const raw = (ts || '').trim();
  if (!raw) return new Date().toISOString();
  return raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
}
