// "Update your card" for a Stripe course installment plan — the way back from
// a failed monthly charge.
//
// Two halves, both keyed on one course registration:
//
//   startCardUpdate  — on a click of the durable link
//                      (/courses/update-payment?t=…, see ./card-update-link.ts):
//                      mint a fresh Stripe Checkout Session in SETUP mode for the
//                      plan's customer and send the buyer to it. Nothing is
//                      charged there; Stripe only collects (and, where the bank
//                      wants it, authenticates) the new card.
//
//   applyCardUpdate  — once that session completes: make the new card the
//                      subscription's default, so every later installment uses
//                      it, and charge what the plan ALREADY owes with it, right
//                      away. The second part is the one that matters. A
//                      subscription Stripe has marked `unpaid` makes no further
//                      attempts of its own, so a card saved without it would sit
//                      there while the installment stayed open.
//
// applyCardUpdate runs from two places — the page Stripe returns the buyer to
// (so they read what the charge did) and the checkout.session.completed webhook
// (for the buyer who closes the tab) — usually within the same second. They
// converge on Stripe idempotency keys derived from the session id: the second
// caller's finalize/pay requests replay the first caller's results instead of
// acting again, so an invoice can never be charged twice. It deliberately does
// NOT record the installment itself — the invoice.paid webhook (and the hourly
// reconcile behind it) already do, and a third concurrent recorder is how an
// installment would get counted twice.

import { type CourseRegistration } from './db';
import { effectiveTotal } from './installment-forecast';
import { logEvent, logEventSafe } from '../registrations/db';
import {
  StripeApiError,
  createSetupCheckoutSession,
  finalizeInvoice,
  listOutstandingSubscriptionInvoices,
  payInvoice,
  retrieveInvoice,
  retrieveSetupCheckoutSession,
  retrieveSubscriptionWithLatestInvoice,
  setSubscriptionDefaultPaymentMethod,
  type StripeInvoiceSummary,
} from '../registrations/stripe';
import { cardUpdateUrl, CARD_UPDATE_SESSION_PARAM } from './card-update-link';
import { recordCardUpdateOnRuns } from './dunning';

export type CardUpdateEnv = {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
};

// Marks our setup sessions in their metadata, so the webhook can tell one from
// every other checkout.session.completed.
export const CARD_UPDATE_PAYMENT_KIND = 'card_update';

// Why a plan has no card to update — each reads as its own sentence on the page.
export type CardUpdateBlock =
  | 'not_a_plan' // paid in full, nothing recurring
  | 'paypal' // PayPal holds the payment method; it's changed in PayPal
  | 'no_subscription' // no Stripe subscription on the row
  | 'not_started' // the checkout never completed
  | 'closed' // cancelled or refunded
  | 'settled'; // every charge the plan will take has been taken

export function cardUpdateBlock(reg: CourseRegistration): CardUpdateBlock | null {
  if (reg.installments_total <= 1) return 'not_a_plan';
  if (reg.provider === 'paypal') return 'paypal';
  if (!reg.stripe_subscription_id) return 'no_subscription';
  if (reg.status === 'cancelled' || reg.status === 'refunded') return 'closed';
  if (reg.installments_paid >= 1 && reg.installments_paid >= effectiveTotal(reg)) {
    return 'settled';
  }
  if (reg.status !== 'paid' || reg.installments_paid < 1) return 'not_started';
  return null;
}

// ── Start: the click ──────────────────────────────────────────────────────

export type StartCardUpdateResult =
  | { ok: true; url: string }
  | { ok: false; error: 'blocked'; block: CardUpdateBlock }
  | { ok: false; error: 'closed' | 'not_configured' | 'gateway'; detail?: string };

export async function startCardUpdate(
  env: CardUpdateEnv,
  reg: CourseRegistration,
  token: string,
  origin: string,
): Promise<StartCardUpdateResult> {
  const block = cardUpdateBlock(reg);
  if (block) return { ok: false, error: 'blocked', block };
  if (!env.STRIPE_SECRET_KEY) return { ok: false, error: 'not_configured' };
  const subscriptionId = reg.stripe_subscription_id as string;

  try {
    const sub = await retrieveSubscriptionWithLatestInvoice(
      env.STRIPE_SECRET_KEY,
      subscriptionId,
    );
    if (sub.status === 'canceled' || sub.status === 'incomplete_expired') {
      return { ok: false, error: 'closed' };
    }
    if (!sub.customer) return { ok: false, error: 'gateway', detail: 'no customer' };

    // Stripe fills {CHECKOUT_SESSION_ID} in itself — it must reach Stripe as
    // literal braces, so it is appended after the encoded part of the URL.
    const back = cardUpdateUrl(origin, token);
    const session = await createSetupCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      customer: sub.customer,
      currency: reg.currency,
      success_url: `${back}&${CARD_UPDATE_SESSION_PARAM}={CHECKOUT_SESSION_ID}`,
      cancel_url: cardUpdateUrl(origin, token, { stay: true }),
      description: `New payment method for course plan C-${reg.id}`,
      metadata: {
        payment_kind: CARD_UPDATE_PAYMENT_KIND,
        course_registration_id: String(reg.id),
        subscription_id: subscriptionId,
      },
      // A fresh key per click. It still makes stripePostForm's transient
      // retries safe, but — unlike the hour-bucketed key the balance link
      // uses — never hands a second click the SAME session back: after a
      // declined card the buyer comes straight back to try another one, and a
      // replayed, already-completed session would meet them with Stripe's
      // "you're all done here".
      idempotency_key: `card-update-${reg.id}-${crypto.randomUUID()}`,
    });
    return { ok: true, url: session.url };
  } catch (err) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'course.card_update.start_failed',
      source: 'stripe',
      payload: { course_registration_id: reg.id, error: String(err) },
    });
    return { ok: false, error: 'gateway', detail: String(err) };
  }
}

// ── Apply: after the card is saved ────────────────────────────────────────

export type CardUpdateResult =
  | 'paid' // everything outstanding went through on the new card
  | 'nothing_owed' // card saved; nothing was outstanding to charge
  | 'processing' // a bank debit (SEPA) is on its way — takes a few days
  | 'declined' // card saved, but the bank refused the charge
  | 'needs_action' // the bank wants the buyer to confirm the charge
  | 'not_saved' // the setup never completed — no card on file
  | 'stale' // an old return link (a bookmark, a reopened tab): charges nothing
  | 'error'; // our side or Stripe's; nothing we can tell the bank about

// How long after the card is saved its return link may still charge. The page
// and the webhook both land within seconds; anything later is someone
// reopening an old tab, and a page view must not start charging a new month's
// installment weeks after the fact. (Stripe's idempotency keys also only live
// 24 hours, so past this a repeat could no longer be told from a first try.)
const APPLY_WINDOW_SECONDS = 6 * 3600;

export type CardUpdateOutcome = {
  result: CardUpdateResult;
  paidCount: number;
  paidMinor: number;
  // Still owed after this attempt (what the page asks them to settle).
  outstandingMinor: number;
  currency: string;
  // The bank's own sentence on a decline ("Your card has insufficient
  // funds."); our error text on 'error'.
  message: string | null;
  // Stripe's pay-this-invoice page, read fresh — where a bank that insists on
  // confirming the charge gets its 3-D Secure step.
  actionUrl: string | null;
  // The invoices this attempt settled, so the dunning runs chasing them close
  // at once rather than on the next hourly tick.
  paidInvoiceIds: string[];
};

function outcome(
  result: CardUpdateResult,
  currency: string,
  extra: Partial<CardUpdateOutcome> = {},
): CardUpdateOutcome {
  return {
    result,
    paidCount: 0,
    paidMinor: 0,
    outstandingMinor: 0,
    currency,
    message: null,
    actionUrl: null,
    paidInvoiceIds: [],
    ...extra,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Pay with patience for the one conflict this flow expects: the return page and
// the webhook sending the SAME idempotent pay request at the same moment.
// Stripe answers the second with 409 until the first finishes, and then
// replays its result — so waiting a few seconds turns the conflict into the
// real answer instead of an error.
async function payWithPatience(
  secretKey: string,
  invoiceId: string,
  paymentMethod: string,
  key: string,
): Promise<StripeInvoiceSummary> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await payInvoice(secretKey, invoiceId, paymentMethod, key);
    } catch (err) {
      if (err instanceof StripeApiError && err.status === 409 && attempt < 5) {
        await sleep(1000);
        continue;
      }
      throw err;
    }
  }
}

function requiresAction(err: StripeApiError): boolean {
  return (
    err.code === 'invoice_payment_intent_requires_action' ||
    err.code === 'authentication_required' ||
    err.declineCode === 'authentication_required'
  );
}

// Results that describe what happened to the money, and so are worth keeping
// for the other caller and for a refresh. A 'not_saved' / 'stale' / 'error'
// is not stored: a refresh (or the other caller) should try again.
const DEFINITIVE: ReadonlySet<CardUpdateResult> = new Set([
  'paid',
  'nothing_owed',
  'processing',
  'declined',
  'needs_action',
]);

const appliedId = (sessionId: string) => `card-update-${sessionId}`;
const claimId = (sessionId: string) => `card-update-${sessionId}-claim`;

// What the first caller for this session recorded, if it has finished.
async function readAppliedOutcome(
  db: D1Database,
  sessionId: string,
): Promise<CardUpdateOutcome | null> {
  try {
    const row = await db
      .prepare(`SELECT payload_json FROM events WHERE external_id = ?`)
      .bind(appliedId(sessionId))
      .first<{ payload_json: string | null }>();
    if (!row?.payload_json) return null;
    const p = JSON.parse(row.payload_json) as Partial<CardUpdateOutcome>;
    if (!p.result || !DEFINITIVE.has(p.result)) return null;
    return outcome(p.result, p.currency ?? 'EUR', {
      paidCount: p.paidCount ?? 0,
      paidMinor: p.paidMinor ?? 0,
      outstandingMinor: p.outstandingMinor ?? 0,
      message: p.message ?? null,
      actionUrl: p.actionUrl ?? null,
      paidInvoiceIds: p.paidInvoiceIds ?? [],
    });
  } catch {
    return null;
  }
}

export async function applyCardUpdate(
  env: CardUpdateEnv,
  reg: CourseRegistration,
  sessionId: string,
): Promise<CardUpdateOutcome> {
  const currency = (reg.currency || 'EUR').toUpperCase();
  const key = env.STRIPE_SECRET_KEY;
  if (!key || !reg.stripe_subscription_id) {
    return outcome('error', currency, { message: 'Stripe is not configured.' });
  }
  const subscriptionId = reg.stripe_subscription_id;

  // Done already (a refresh, or the second of page + webhook): say what
  // happened then. Re-running would find the invoices paid and report
  // "nothing owed" to someone whose payment just went through.
  const prior = await readAppliedOutcome(env.DB, sessionId);
  if (prior) return prior;

  // The other caller is mid-way: wait for its answer rather than racing it.
  // If it never finishes (a worker cut short), do the work ourselves — the
  // idempotency keys make that safe.
  let claimed = true;
  try {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'course.card_update.claimed',
      source: 'stripe',
      external_id: claimId(sessionId),
      payload: { course_registration_id: reg.id, session_id: sessionId },
    });
  } catch {
    claimed = false;
  }
  if (!claimed) {
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      const done = await readAppliedOutcome(env.DB, sessionId);
      if (done) return done;
    }
  }

  let result: CardUpdateOutcome;
  try {
    result = await applyInner(env, key, reg, subscriptionId, sessionId, currency);
  } catch (err) {
    result = outcome('error', currency, { message: String(err) });
  }

  // Leave the trail: on the dunning runs (the admin list and the support
  // hand-off both say what the buyer tried), and once in the events log —
  // which is also what the other caller and any refresh read back.
  if (DEFINITIVE.has(result.result) || result.result === 'error') {
    await recordCardUpdateOnRuns(env.DB, reg.id, result).catch(() => {});
  }
  if (DEFINITIVE.has(result.result)) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'course.card_update.applied',
      source: 'stripe',
      external_id: appliedId(sessionId),
      payload: {
        course_registration_id: reg.id,
        subscription_id: subscriptionId,
        session_id: sessionId,
        ...result,
      },
    });
  } else {
    if (result.result === 'error') {
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'course.card_update.error',
        source: 'stripe',
        payload: { course_registration_id: reg.id, session_id: sessionId, error: result.message },
      });
    }
    // Nothing final to hand back — let a refresh start straight away rather
    // than wait out a claim nobody will complete.
    await env.DB.prepare(`DELETE FROM events WHERE external_id = ?`)
      .bind(claimId(sessionId))
      .run()
      .catch(() => {});
  }
  return result;
}

async function applyInner(
  env: CardUpdateEnv,
  key: string,
  reg: CourseRegistration,
  subscriptionId: string,
  sessionId: string,
  currency: string,
): Promise<CardUpdateOutcome> {
  const session = await retrieveSetupCheckoutSession(key, sessionId);
  // The session must be ours, and for THIS plan — the token says which plan the
  // page is for, the session's metadata says which plan the card was saved for.
  if (
    session.metadata.payment_kind !== CARD_UPDATE_PAYMENT_KIND ||
    session.metadata.course_registration_id !== String(reg.id)
  ) {
    return outcome('error', currency, { message: 'This checkout does not belong to this plan.' });
  }
  const pm = session.setup_intent?.payment_method ?? null;
  if (session.status !== 'complete' || session.setup_intent?.status !== 'succeeded' || !pm) {
    return outcome('not_saved', currency);
  }
  if (Date.now() / 1000 - session.created > APPLY_WINDOW_SECONDS) {
    return outcome('stale', currency);
  }

  const block = cardUpdateBlock(reg);
  if (block === 'settled') return outcome('nothing_owed', currency);
  if (block) {
    return outcome('error', currency, { message: `Plan is not open (${block}).` });
  }

  // 1. Every later installment uses the new card. A failure here doesn't stop
  //    us charging what's owed now — the buyer just saved this card for that.
  try {
    await setSubscriptionDefaultPaymentMethod(
      key,
      subscriptionId,
      pm,
      `sd-card-${sessionId}-sub`,
    );
  } catch (err) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'course.card_update.default_failed',
      source: 'stripe',
      payload: { course_registration_id: reg.id, session_id: sessionId, error: String(err) },
    });
  }

  // 2. What the plan already owes, oldest first — never more invoices than the
  //    plan has charges left to take (an admin early stop included).
  const allowed = Math.max(0, effectiveTotal(reg) - reg.installments_paid);
  const owed = (await listOutstandingSubscriptionInvoices(key, subscriptionId)).slice(
    0,
    allowed,
  );
  if (owed.length === 0) return outcome('nothing_owed', currency);
  const cur = owed[0].currency || currency;
  const owedMinor = (inv: StripeInvoiceSummary) =>
    inv.status === 'draft' ? inv.amount_due : inv.amount_remaining;

  let paidCount = 0;
  let paidMinor = 0;
  let processing = false;
  const paidInvoiceIds: string[] = [];
  const outstandingFrom = (i: number) =>
    owed.slice(i).reduce((s, inv) => s + owedMinor(inv), 0);

  for (let i = 0; i < owed.length; i++) {
    const inv = owed[i];
    const due = owedMinor(inv);
    try {
      if (inv.status === 'draft') {
        await finalizeInvoice(key, inv.id, `sd-card-${sessionId}-fin-${inv.id}`);
      }
      const after = await payWithPatience(key, inv.id, pm, `sd-card-${sessionId}-pay-${inv.id}`);
      if (after.status === 'paid') {
        paidCount++;
        paidMinor += due;
        paidInvoiceIds.push(inv.id);
      } else {
        // No error and still open: a bank debit on its way (SEPA). The next
        // one can go the same way.
        processing = true;
      }
    } catch (err) {
      // Whatever went wrong, the invoice's own state is the truth — the other
      // caller (page or webhook) may have paid it a moment ago.
      const now = await retrieveInvoice(key, inv.id).catch(() => null);
      if (now?.status === 'paid') {
        paidCount++;
        paidMinor += due;
        paidInvoiceIds.push(inv.id);
        continue;
      }
      const base = {
        paidCount,
        paidMinor,
        paidInvoiceIds,
        outstandingMinor: outstandingFrom(i),
      };
      if (err instanceof StripeApiError && requiresAction(err)) {
        return outcome('needs_action', cur, {
          ...base,
          actionUrl: now?.hosted_invoice_url ?? inv.hosted_invoice_url,
        });
      }
      if (err instanceof StripeApiError && (err.type === 'card_error' || err.code === 'card_declined')) {
        // Stop at the first refusal: one decline is enough to tell the buyer,
        // and hammering the same card with the next invoice only earns more.
        return outcome('declined', cur, { ...base, message: err.stripeMessage });
      }
      return outcome('error', cur, { ...base, message: String(err) });
    }
  }

  const unpaid = owed
    .filter((inv) => !paidInvoiceIds.includes(inv.id))
    .reduce((s, inv) => s + owedMinor(inv), 0);
  return outcome(processing ? 'processing' : 'paid', cur, {
    paidCount,
    paidMinor,
    paidInvoiceIds,
    outstandingMinor: unpaid,
  });
}
