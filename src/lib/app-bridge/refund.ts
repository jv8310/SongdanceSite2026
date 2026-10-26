// The site's half of refunding from the member app's MCP tools (songdance-app
// `list_site_orders` and `refund_order`), so Claude can do what the Refund
// forms on /admin/orders/<no> do. Reached only through the AppBridge
// entrypoint (src/worker-entrypoint.ts), never over HTTP; only an admin signs
// in to that connector, and the app names who asked in `actor`.
//
// The refund itself is lib/admin/refund.ts, the same code the admin forms run.
// What this door adds:
//
//   • A TYPED CONFIRMATION, always (Jacob, October 2026). `confirm` must read
//     "REFUND <order> [#<installment>] <amount> <currency>" and name exactly
//     the refund this call comes to — the order, the installment, the amount
//     and the currency the gateway will be asked for. Anything else refunds
//     nothing. "full" therefore has to be confirmed with its figure, which
//     means looking the order up first.
//   • THE AMOUNT FROM THE GATEWAY. The confirmation states a figure, so the
//     figure must be the charge's real remainder, not our row's estimate of it
//     (readChargeRemaining says why the two differ).
//   • ONE CHARGE PER CALL. A payment plan is refunded an installment at a
//     time, by its number in the ledger; a plan with no installment named is
//     refused rather than guessed at.
//   • A REPEAT IS THE SAME REFUND. A tool call can be retried; the same
//     request on the same day carries the same key to the gateway
//     (Idempotency-Key / PayPal-Request-Id) and is answered from our own
//     events log, so it never refunds twice.
//
// Payment ids never leave the site: orders go by their number (C-12) and
// installments by theirs.

import { logEventSafe } from '../registrations/db';
import { brusselsToday } from '../workshops/periods';
import { findOrder, isRefundable, listAllOrders, refundableMinor, type UnifiedOrder } from '../admin/orders';
import { hasInstallmentLedger, installmentRefundableMinor, listOrderInstallments } from '../admin/installments';
import { cycleNote, issueRefund, readChargeRemaining, resolveRefundTarget } from '../admin/refund';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ORDERS = 30;

const money = (minor: number) => (minor / 100).toFixed(2);

export type AppInstallment = {
  number: number;
  paidAt: string | null;
  amount: string;
  currency: string;
  // Null when PayPal names a partial refund without its figure.
  refunded: string | null;
  status: string;
  // What may still go back on this installment (0.00 = nothing).
  refundable: string;
};

export type AppOrder = {
  orderNo: string;
  kind: 'course' | 'workshop' | 'retreat';
  product: string;
  email: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
  provider: string;
  // What the order row holds (for a plan: the whole plan) and what has gone back.
  amount: string;
  refunded: string;
  currency: string;
  plan: { plan: string; paid: number; total: number } | null;
  refundable: boolean;
  // Why not, in plain words, when refundable is false.
  notRefundable?: string;
  // A single charge: what may still go back on it, read from the gateway.
  chargeRefundable?: { amount: string; currency: string };
  // A payment plan: its installments, from the gateway.
  installments?: AppInstallment[];
  // The gateway could not be read: the figures above are not to be confirmed.
  gatewayError?: string;
};

export type OrdersAnswer =
  | { ok: true; orders: AppOrder[]; unpaidCheckouts: number; more: boolean }
  | { ok: false; error: string; message: string };

function notRefundableWhy(o: UnifiedOrder): string {
  if (o.provider === 'bank_transfer') return 'Paid by bank transfer: it goes back from the bank account by hand.';
  if (o.statusClass === 'pending') return 'Not paid.';
  if (o.originalAmountMinor <= 0) return 'Nothing was charged.';
  if (refundableMinor(o) <= 0) return 'Already refunded in full.';
  return 'No payment at Stripe or PayPal to refund.';
}

async function describeOrder(env: Env, o: UnifiedOrder): Promise<AppOrder> {
  const out: AppOrder = {
    orderNo: o.orderNo,
    kind: o.source,
    product: o.productLabel,
    email: o.email,
    status: o.rawStatus,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    provider: o.provider,
    amount: money(o.originalAmountMinor),
    refunded: money(o.refundedMinor),
    currency: o.originalCurrency,
    plan:
      o.source === 'course' && o.installmentsTotal !== 1
        ? { plan: o.paymentPlan, paid: o.installmentsPaid, total: o.installmentsTotal }
        : null,
    refundable: isRefundable(o),
  };
  if (!out.refundable) return { ...out, notRefundable: notRefundableWhy(o) };

  if (hasInstallmentLedger(o)) {
    const ledger = await listOrderInstallments(env, o);
    if (!ledger || ledger.error) return { ...out, gatewayError: ledger?.error ?? 'no plan to read' };
    return {
      ...out,
      installments: ledger.rows.map((r) => ({
        number: r.seq,
        paidAt: r.paidAt,
        amount: money(r.amountMinor),
        currency: (r.currency || o.originalCurrency).toUpperCase(),
        refunded: r.refundedMinor == null ? null : money(r.refundedMinor),
        status: r.status,
        refundable: money(r.refundTarget ? installmentRefundableMinor(r) : 0),
      })),
    };
  }

  const resolved = await resolveRefundTarget(env, o, {}, 'app');
  if (!resolved.ok) return { ...out, refundable: false, notRefundable: resolved.message };
  const live = await readChargeRemaining(env, o, resolved.target);
  if (!live.ok) return { ...out, gatewayError: live.message };
  return {
    ...out,
    chargeRefundable: { amount: money(live.target.remainingMinor), currency: live.target.currency },
  };
}

// Everything bought under these addresses (the member's linked emails), newest
// first, with what can still be refunded. Checkouts that were never paid are
// counted, not listed.
export async function ordersForApp(env: Env, input: { emails?: unknown }): Promise<OrdersAnswer> {
  const raw = Array.isArray(input?.emails) ? input.emails : [];
  const emails = [...new Set(raw.map((e) => String(e ?? '').trim().toLowerCase()))].filter(
    (e) => EMAIL_RE.test(e) && e.length <= 254,
  );
  if (!emails.length || emails.length > 10) {
    return { ok: false, error: 'invalid-email', message: 'Give one to ten email addresses.' };
  }
  const all = (await Promise.all(emails.map((email) => listAllOrders(env.DB, { email })))).flat();
  const seen = new Set<string>();
  const unique = all
    .filter((o) => (seen.has(o.orderNo) ? false : (seen.add(o.orderNo), true)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const paid = unique.filter((o) => o.statusClass !== 'pending' && o.statusClass !== 'expired');
  const shown = paid.slice(0, MAX_ORDERS);
  return {
    ok: true,
    orders: await Promise.all(shown.map((o) => describeOrder(env, o))),
    unpaidCheckouts: unique.length - paid.length,
    more: paid.length > shown.length,
  };
}

export type RefundAnswer =
  | {
      ok: true;
      orderNo: string;
      installment: number | null;
      kind: 'course' | 'workshop' | 'retreat';
      product: string;
      email: string;
      // The course_registrations row, for the app to take the course away.
      courseRegistrationId: number | null;
      provider: 'stripe' | 'paypal';
      refundId: string;
      amount: string;
      currency: string;
      // Everything that was left on that charge went back.
      wholeCharge: boolean;
      // False: PayPal refunded, but the site's books did not follow. Never refund again.
      recorded: boolean;
      warning?: string;
      // This exact request was already done today: nothing moved this time.
      replayed: boolean;
    }
  | { ok: false; error: string; message: string };

type RefundInput = {
  orderNo?: unknown;
  installment?: unknown;
  amount?: unknown;
  confirm?: unknown;
  note?: unknown;
  actor?: unknown;
};

const CONFIRM_RE = /^REFUND ([RCW]-\d+)(?: #(\d+))? (\d+(?:[.,]\d{1,2})?) ([A-Z]{3})$/;

function parseConfirm(raw: string) {
  const m = CONFIRM_RE.exec(raw.trim().replace(/\s+/g, ' ').toUpperCase());
  if (!m) return null;
  return {
    orderNo: m[1],
    installment: m[2] ? parseInt(m[2], 10) : null,
    amountMinor: Math.round(Number(m[3].replace(',', '.')) * 100),
    currency: m[4],
  };
}

export function expectedConfirm(orderNo: string, installment: number | null, amountMinor: number, currency: string) {
  return `REFUND ${orderNo}${installment ? ` #${installment}` : ''} ${money(amountMinor)} ${currency}`;
}

async function requestKeyOf(parts: unknown[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `app-refund-${hex.slice(0, 32)}`;
}

const refuse = (error: string, message: string): RefundAnswer => ({ ok: false, error, message });

export async function refundFromApp(env: Env, input: RefundInput): Promise<RefundAnswer> {
  const orderNo = String(input?.orderNo ?? '').trim().toUpperCase();
  const actor = String(input?.actor ?? '').trim().slice(0, 120);
  const note = String(input?.note ?? '').trim();
  const confirmRaw = String(input?.confirm ?? '');
  if (!actor) return refuse('invalid-input', 'Who asked (actor) is missing.');
  if (!note || note.length > 500) return refuse('invalid-input', 'A note of 1 to 500 characters says why.');

  const seq = input?.installment == null ? null : Number(input.installment);
  if (seq != null && !(Number.isInteger(seq) && seq >= 1 && seq <= 120)) {
    return refuse('invalid-input', 'An installment is its number on the plan: 1, 2, 3 …');
  }
  const amountIn = input?.amount;
  const full = amountIn === 'full';
  const major = full ? null : Number(amountIn);
  if (!full && !(typeof major === 'number' && Number.isFinite(major) && major > 0)) {
    return refuse('invalid-input', 'The amount is "full" or a positive number in the charge’s currency.');
  }
  if (major != null && Math.abs(major * 100 - Math.round(major * 100)) > 1e-6) {
    return refuse('invalid-input', 'The amount has at most two decimals.');
  }
  const confirm = parseConfirm(confirmRaw);
  if (!confirm) {
    return refuse('confirm-required', 'The confirmation reads "REFUND <order> [#<installment>] <amount> <currency>", e.g. "REFUND C-12 #2 49.00 EUR". Nothing was refunded.');
  }

  // The same request again today is the same refund. Checked before anything
  // is read, so a retry is recognised even after the first call emptied the
  // charge (and the remainder it would compute has changed).
  const requestKey = await requestKeyOf([
    orderNo,
    seq,
    full ? 'full' : Math.round(major! * 100),
    expectedConfirm(confirm.orderNo, confirm.installment, confirm.amountMinor, confirm.currency),
    note,
    actor,
    brusselsToday(),
  ]);
  const done = await env.DB.prepare(`SELECT payload_json FROM events WHERE external_id = ?`)
    .bind(requestKey)
    .first<{ payload_json: string | null }>();
  if (done?.payload_json) {
    try {
      const before = JSON.parse(done.payload_json) as RefundAnswer;
      if (before.ok) return { ...before, replayed: true };
    } catch {
      /* fall through: the gateway key still makes it the same refund */
    }
  }

  const order = await findOrder(env.DB, orderNo);
  if (!order) return refuse('not-found', `There is no order ${orderNo || '(none given)'}.`);
  if (!isRefundable(order)) return refuse('not-refundable', `${order.orderNo} cannot be refunded from here: ${notRefundableWhy(order)}`);
  if (seq == null && hasInstallmentLedger(order)) {
    return refuse(
      'installment-required',
      `${order.orderNo} is a payment plan: refund it one installment at a time, naming the installment's number (list_site_orders shows them).`,
    );
  }

  const resolved = await resolveRefundTarget(env, order, { installmentSeq: seq }, 'app');
  if (!resolved.ok) return refuse('no-target', resolved.message);
  const live = await readChargeRemaining(env, order, resolved.target);
  if (!live.ok) return refuse('gateway-unreadable', live.message);
  const target = live.target;
  const cycle = cycleNote(target);
  if (target.remainingMinor <= 0) return refuse('nothing-left', `Nothing is left to refund on ${order.orderNo}${cycle}.`);

  const amountMinor = full ? target.remainingMinor : Math.round(major! * 100);
  if (amountMinor > target.remainingMinor) {
    return refuse(
      'too-much',
      `${money(amountMinor)} ${target.currency} is more than is left on ${order.orderNo}${cycle}: ${money(target.remainingMinor)} ${target.currency}. Nothing was refunded.`,
    );
  }

  const expected = expectedConfirm(order.orderNo, seq, amountMinor, target.currency);
  if (
    confirm.orderNo !== order.orderNo ||
    confirm.installment !== seq ||
    confirm.amountMinor !== amountMinor ||
    confirm.currency !== target.currency
  ) {
    return refuse(
      'confirm-mismatch',
      `This refund comes to ${money(amountMinor)} ${target.currency} on ${order.orderNo}${cycle}, and the confirmation must say exactly that: "${expected}". Nothing was refunded. Tell Jacob the amount, and call again once he agrees.`,
    );
  }

  const outcome = await issueRefund(env, order, target, amountMinor, { door: 'app', actor, note, requestKey });
  if (outcome.status === 'failed') {
    return refuse(
      'gateway-refused',
      `${outcome.provider === 'paypal' ? 'PayPal' : 'Stripe'} refused the refund, so nothing moved — ${outcome.detail}`,
    );
  }
  const answer: RefundAnswer = {
    ok: true,
    orderNo: order.orderNo,
    installment: seq,
    kind: order.source,
    product: order.productLabel,
    email: order.email,
    courseRegistrationId: order.source === 'course' ? order.rowId : null,
    provider: outcome.provider,
    refundId: outcome.refundId,
    amount: money(outcome.amountMinor),
    currency: outcome.currency,
    wholeCharge: outcome.amountMinor >= target.remainingMinor,
    recorded: outcome.status === 'refunded',
    ...(outcome.status === 'unrecorded'
      ? {
          warning: `PayPal DID refund ${money(outcome.amountMinor)} ${outcome.currency} for ${order.orderNo}${cycle} (refund ${outcome.refundId}), but recording it on the site failed, so the order page still shows the old figures. Do not refund again. ${outcome.detail}`,
        }
      : {}),
    replayed: false,
  };
  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'app.refund.done',
    source: 'app',
    external_id: requestKey,
    payload: answer,
  });
  return answer;
}
