// Workshop-side Stripe webhook handling, called from the shared endpoint
// (src/pages/api/registrations/stripe-webhook.ts). Each handler returns true
// if the event belonged to a workshop (so the shared endpoint early-returns),
// false otherwise. Idempotency is anchored on the payment_intent / payment row.

import { logEvent } from '../registrations/db';
import {
  getPaymentByIntent,
  getProductById,
  getProductBySlug,
  getRegistrationById,
  getWorkshopById,
  insertPurchase,
  purchasesExistForPayment,
  resolvePrice,
  setPaymentStatusByIntent,
  setRegistrationPaymentStatus,
  upsertPayment,
} from './db';
import { getTaxRate, netFromGross } from './quaderno';
import { retrievePaymentSettlement } from './stripe';
import { runWorkshopPaidSideEffects } from './paid-handler';
import { applyDiscountPercent } from './discount';

type Env = {
  DB: D1Database;
  STRIPE_SECRET_KEY: string;
  QUADERNO_API_KEY?: string;
  QUADERNO_ACCOUNT?: string;
  QUADERNO_SANDBOX?: string;
  DRIP_API_TOKEN?: string;
  DRIP_ACCOUNT_ID?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
  META_PIXEL_ID?: string;
  META_ACCESS_TOKEN?: string;
  PUBLIC_BASE_URL: string;
};

type StripeSession = {
  id: string;
  mode?: string;
  payment_intent: string | null;
  amount_total: number;
  currency: string;
  customer_details?: { address?: { country?: string } };
  metadata?: Record<string, string>;
};

export async function handleWorkshopCheckoutCompleted(
  env: Env,
  session: StripeSession,
  ctx?: { waitUntil?: (p: Promise<unknown>) => void },
): Promise<boolean> {
  const ridRaw = session.metadata?.workshop_registration_id;
  if (!ridRaw) return false; // not a workshop checkout

  const registrationId = parseInt(ridRaw, 10);
  const reg = await getRegistrationById(env.DB, registrationId);
  if (!reg) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.webhook.reg_missing', payload: { registration_id: ridRaw } });
    return true;
  }
  const workshop = await getWorkshopById(env.DB, reg.workshop_id);
  if (!workshop) return true;

  const paymentIntentId = session.payment_intent;
  if (!paymentIntentId) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.webhook.no_pi', payload: { registration_id: registrationId } });
    return true;
  }

  const amountMinor = session.amount_total;
  const currency = (session.currency ?? '').toUpperCase();
  const taxCountry =
    session.metadata?.country?.toUpperCase() ||
    session.customer_details?.address?.country?.toUpperCase() ||
    reg.country ||
    null;

  // Settlement / FX from the balance transaction (best-effort).
  let settlement = {
    chargeId: null as string | null,
    method: null as string | null,
    balanceTransactionId: null as string | null,
    settlementAmountMinor: null as number | null,
    settlementCurrency: null as string | null,
    fxRate: null as number | null,
  };
  try {
    settlement = await retrievePaymentSettlement(env.STRIPE_SECRET_KEY, paymentIntentId);
  } catch (err) {
    await logEvent(env.DB, { registration_id: null, kind: 'workshop.webhook.settlement_failed', payload: { registration_id: registrationId, error: String(err) } });
  }

  // Tax split via Quaderno tax-rate lookup (tax-only; invoices are created by
  // the Stripe→Quaderno connector, not here).
  let taxRate = 0;
  if (taxCountry && env.QUADERNO_API_KEY && env.QUADERNO_ACCOUNT) {
    try {
      taxRate = await getTaxRate(
        { apiKey: env.QUADERNO_API_KEY, account: env.QUADERNO_ACCOUNT, sandbox: env.QUADERNO_SANDBOX === '1' },
        taxCountry,
      );
    } catch {
      taxRate = 0;
    }
  }
  const { subtotalMinor, taxMinor } = netFromGross(amountMinor, taxRate);

  const paymentId = await upsertPayment(env.DB, {
    registration_id: registrationId,
    stripe_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
    stripe_charge_id: settlement.chargeId,
    balance_transaction_id: settlement.balanceTransactionId,
    status: 'paid',
    method: settlement.method,
    amount_minor: amountMinor,
    currency,
    settlement_amount_minor: settlement.settlementAmountMinor,
    settlement_currency: settlement.settlementCurrency,
    fx_rate: settlement.fxRate,
    tax_rate: taxRate || null,
    tax_country: taxCountry,
    subtotal_minor: subtotalMinor,
    tax_minor: taxMinor,
    raw_event: session,
  });

  // Line items: ticket + optional bump. Guarded so a re-delivered event
  // doesn't double-insert.
  if (!(await purchasesExistForPayment(env.DB, paymentId))) {
    if (workshop.main_product_id) {
      const ticket = await getProductById(env.DB, workshop.main_product_id);
      const ticketPrice = await resolvePrice(env.DB, workshop.main_product_id, currency);
      if (ticket && ticketPrice) {
        // A ticket discount (?discount / ?adiscount) reduced the ticket at
        // checkout — keep the purchase ledger in step with the amount charged.
        const discountPct = parseInt(session.metadata?.discount_pct ?? '', 10) || 0;
        await insertPurchase(env.DB, {
          registration_id: registrationId,
          payment_id: paymentId,
          product_id: ticket.id,
          product_type: ticket.type,
          amount_minor: applyDiscountPercent(ticketPrice.amountMinor, discountPct),
          currency: ticketPrice.currency,
        });
      }
    }
    const bumpSlug = session.metadata?.bump;
    if (bumpSlug) {
      const bump = await getProductBySlug(env.DB, bumpSlug);
      if (bump) {
        const bumpPrice = await resolvePrice(env.DB, bump.id, currency);
        if (bumpPrice) {
          await insertPurchase(env.DB, {
            registration_id: registrationId,
            payment_id: paymentId,
            product_id: bump.id,
            product_type: bump.type,
            amount_minor: bumpPrice.amountMinor,
            currency: bumpPrice.currency,
          });
        }
      }
    }
  }

  await setRegistrationPaymentStatus(env.DB, registrationId, 'paid');

  // Drip tag + confirmation email + Meta CAPI (best-effort, idempotent).
  const sideEffects = runWorkshopPaidSideEffects(env, {
    registrationId,
    metaEventId: session.metadata?.meta_event_id || null,
    valueMajor: amountMinor / 100,
    currency,
  });
  if (ctx?.waitUntil) ctx.waitUntil(sideEffects);
  else await sideEffects.catch(() => {});

  await logEvent(env.DB, {
    registration_id: null,
    kind: 'workshop.paid',
    external_id: `workshop-paid-${registrationId}`,
    payload: { registration_id: registrationId, payment_intent: paymentIntentId, amount_minor: amountMinor, currency },
  });
  return true;
}

// charge.refunded → flip workshop payment + registration to refunded.
export async function handleWorkshopRefund(
  env: Env,
  charge: { payment_intent: string | null },
): Promise<boolean> {
  if (!charge.payment_intent) return false;
  const payment = await getPaymentByIntent(env.DB, charge.payment_intent);
  if (!payment) return false;
  await setPaymentStatusByIntent(env.DB, charge.payment_intent, 'refunded');
  await setRegistrationPaymentStatus(env.DB, payment.registration_id, 'refunded');
  await logEvent(env.DB, {
    registration_id: null,
    kind: 'workshop.refunded',
    external_id: `workshop-refund-${payment.id}`,
    payload: { registration_id: payment.registration_id, payment_intent: charge.payment_intent },
  });
  return true;
}

// charge.dispute.created → flip workshop payment + registration to chargeback.
export async function handleWorkshopDispute(
  env: Env,
  dispute: { payment_intent: string | null },
): Promise<boolean> {
  if (!dispute.payment_intent) return false;
  const payment = await getPaymentByIntent(env.DB, dispute.payment_intent);
  if (!payment) return false;
  await setPaymentStatusByIntent(env.DB, dispute.payment_intent, 'chargeback');
  await setRegistrationPaymentStatus(env.DB, payment.registration_id, 'chargeback');
  await logEvent(env.DB, {
    registration_id: null,
    kind: 'workshop.chargeback',
    external_id: `workshop-dispute-${payment.id}`,
    payload: { registration_id: payment.registration_id, payment_intent: dispute.payment_intent },
  });
  return true;
}
