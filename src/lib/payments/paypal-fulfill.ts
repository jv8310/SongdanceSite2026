// Shared, idempotent fulfillment for the direct PayPal gateway. Both the return
// endpoint (synchronous, right after the buyer approves) and the webhook (async
// backstop) funnel through here, so the two paths converge without double-
// counting. Idempotency is anchored on the PayPal capture / sale / refund id in
// the `events` audit log — exactly the pattern the Stripe webhook uses.
//
// Routing: PayPal objects carry our "<kind>:<id>" custom_id, and we also store
// the order/subscription id on the row, so a payment always resolves back to the
// right table + row.

import {
  assignRoomOnPaid,
  eventExists,
  getRegistrationById as getRetreatRegById,
  logEvent,
  markBalancePaid,
  markRegistrationPaidPaypal,
  markRegistrationRefunded,
  getRegistrationByPaypalCapture,
  type Registration,
} from '../registrations/db';
import { settleWaitlistOnPaid } from '../registrations/waitlist';
import { pushPaidRegistrationToDrip, recordRetreatOrder } from '../registrations/paid-handler';
import {
  getCourseRegistrationById,
  getCourseRegistrationByPaypalCapture,
  getCourseRegistrationByPaypalSubscription,
  markCourseRegistrationCancelled,
  markCourseRegistrationPaidPaypal,
  markCourseRegistrationRefunded,
  recordPaypalInstallmentPaid,
  updateCourseSubscriptionStatusByPaypal,
  type CourseRegistration,
} from '../courses/db';
import { pushPaidCourseRegistrationToDrip } from '../courses/paid-handler';
import { enforcePaypalScheduledCancel } from '../courses/installment-cancel';
import {
  notifyCourseOrder,
  notifyRetreatOrder,
  notifyRetreatBalanceOrder,
} from '../orders/notification';
import {
  getRegistrationById as getWorkshopRegById,
  getWorkshopById,
  getProductById,
  resolvePrice,
  upsertPaypalPayment,
  purchasesExistForPayment,
  insertPurchase,
  getPaymentByPaypalCapture,
  setPaymentStatusByPaypalCapture,
  setRegistrationPaymentStatus,
} from '../workshops/db';
import { getTaxRate, netFromGross } from '../workshops/quaderno';
import { runWorkshopPaidSideEffects } from '../workshops/paid-handler';
import { normalizePaypalSubStatus, type PaypalCapture } from './paypal';
import { resolveWorkshopBumpProductId } from '../workshops/bump';

export type PaypalFulfillEnv = {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  QUADERNO_API_KEY?: string;
  QUADERNO_ACCOUNT?: string;
  QUADERNO_SANDBOX?: string;
  DRIP_API_TOKEN?: string;
  DRIP_ACCOUNT_ID?: string;
  DRIP_REGISTRATION_EVENT?: string;
  DRIP_COURSE_EVENT?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
  META_PIXEL_ID?: string;
  META_ACCESS_TOKEN?: string;
  ORDER_NOTIFICATIONS_TO?: string;
  PUBLIC_BASE_URL: string;
} & Record<string, unknown>;

// ── Courses ───────────────────────────────────────────────────────────────

// One-off (full-payment) PayPal course purchase. Idempotent on the capture id.
export async function fulfillCoursePaypalOneOff(
  env: PaypalFulfillEnv,
  courseRegId: number,
  capture: PaypalCapture,
): Promise<void> {
  if (!capture.captureId) return;
  const externalId = `paypal.course.captured.${capture.captureId}`;
  if (await eventExists(env.DB, externalId)) return;

  const reg = await getCourseRegistrationById(env.DB, courseRegId);
  if (!reg) return;

  await markCourseRegistrationPaidPaypal(env.DB, reg.id, capture.captureId);
  await logEvent(env.DB, {
    registration_id: null,
    kind: 'paypal.course.captured',
    source: 'paypal',
    external_id: externalId,
    payload: {
      course_registration_id: reg.id,
      capture_id: capture.captureId,
      order_id: capture.orderId,
      amount_minor: capture.amountMinor,
      currency: capture.currency,
    },
  });

  await pushPaidCourseRegistrationToDrip(env as any, reg.id);
  const fresh = (await getCourseRegistrationById(env.DB, reg.id)) ?? reg;
  await notifyCourseOrder(env, fresh);
}

// One subscription cycle (installment) settled. Idempotent on the sale id; the
// first cycle grants access (Drip + SD-ORDER notification), later ones just bump
// the counter — mirrors the Stripe invoice.paid handler.
export async function recordCoursePaypalInstallment(
  env: PaypalFulfillEnv,
  courseReg: CourseRegistration,
  saleId: string,
  captureId: string | null,
): Promise<boolean> {
  const externalId = `paypal.course.installment.${saleId}`;
  if (await eventExists(env.DB, externalId)) return false;

  const wasFirst = courseReg.installments_paid === 0;
  await recordPaypalInstallmentPaid(env.DB, courseReg.id, captureId);
  await logEvent(env.DB, {
    registration_id: null,
    kind: 'paypal.course.installment',
    source: 'paypal',
    external_id: externalId,
    payload: {
      course_registration_id: courseReg.id,
      sale_id: saleId,
      capture_id: captureId,
    },
  });
  if (wasFirst) {
    await pushPaidCourseRegistrationToDrip(env as any, courseReg.id);
    const fresh =
      (await getCourseRegistrationById(env.DB, courseReg.id)) ?? courseReg;
    await notifyCourseOrder(env, fresh);
  }
  // Enforce an admin-scheduled early stop: if this installment was the last one
  // the host chose to allow, cancel the PayPal subscription now (no-op unless a
  // partial schedule is set and reached). Re-read so installments_paid is fresh.
  const afterInc = await getCourseRegistrationById(env.DB, courseReg.id);
  if (afterInc) await enforcePaypalScheduledCancel(env as any, afterInc);
  return true;
}

// Route a settled subscription sale by its AMOUNT before counting it. A plan
// whose checkout carried order bumps charges them as the PayPal setup_fee —
// which PayPal settles as its own sale on the subscription, same
// billing_agreement_id, alongside cycle 1 (e.g. £45 grief bump + £97.50 cycle in
// the same minute). It hits both PAYMENT.SALE.COMPLETED and the subscription's
// transactions list, so counting every sale as an installment would show 2/N
// after one real cycle (wrong counter, forecast, and scheduled-cancel math —
// the money itself is right). Only a sale matching the expected monthly amount
// (amount_cents / installments_total — exact, since checkout stores
// monthly × N) bumps the counter; anything else is logged as a setup-fee charge
// under the SAME external_id namespace, so webhook and reconcile alike can
// never count it later. An unknown amount (null) falls through as an
// installment — the pre-existing behaviour.
export async function recordCoursePaypalSubscriptionSale(
  env: PaypalFulfillEnv,
  courseReg: CourseRegistration,
  saleId: string,
  captureId: string | null,
  amountMinor: number | null,
): Promise<boolean> {
  const externalId = `paypal.course.installment.${saleId}`;
  if (await eventExists(env.DB, externalId)) return false;

  const monthly =
    courseReg.installments_total > 0
      ? Math.round(courseReg.amount_cents / courseReg.installments_total)
      : null;
  if (amountMinor != null && monthly != null && monthly > 0 && amountMinor !== monthly) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'paypal.course.setup_fee',
      source: 'paypal',
      external_id: externalId,
      payload: {
        course_registration_id: courseReg.id,
        sale_id: saleId,
        amount_minor: amountMinor,
        expected_monthly_minor: monthly,
      },
    });
    return false;
  }

  return recordCoursePaypalInstallment(env, courseReg, saleId, captureId);
}

// Mirror a PayPal subscription status onto the row (normalised to the Stripe
// vocabulary so the forecast/badge stay provider-agnostic). On a terminal end
// (cancelled / completed-expired) flip the coarse status to 'cancelled' too —
// the same terminal state Stripe reaches via cancel_at.
export async function applyPaypalSubscriptionStatus(
  env: PaypalFulfillEnv,
  subscriptionId: string,
  paypalStatus: string,
): Promise<void> {
  const normalized = normalizePaypalSubStatus(paypalStatus);
  const upper = (paypalStatus || '').toUpperCase();
  if (upper === 'CANCELLED' || upper === 'EXPIRED') {
    const reg = await getCourseRegistrationByPaypalSubscription(
      env.DB,
      subscriptionId,
    );
    if (reg) await markCourseRegistrationCancelled(env.DB, reg.id);
  } else {
    await updateCourseSubscriptionStatusByPaypal(
      env.DB,
      subscriptionId,
      normalized,
    );
  }
}

// ── Retreats ────────────────────────────────────────────────────────────

export async function fulfillRetreatPaypalOneOff(
  env: PaypalFulfillEnv,
  registrationId: number,
  capture: PaypalCapture,
): Promise<void> {
  if (!capture.captureId) return;
  const externalId = `paypal.retreat.captured.${capture.captureId}`;
  if (await eventExists(env.DB, externalId)) return;

  const reg = await getRetreatRegById(env.DB, registrationId);
  if (!reg) return;

  await markRegistrationPaidPaypal(env.DB, reg.id, capture.captureId);
  // Place the guest in a cabin now they've paid (no-op if already assigned).
  await assignRoomOnPaid(env.DB, reg.id);
  // If this booking came off the waiting list, close that entry (and release
  // the place it was holding). No-op for an ordinary booking.
  await settleWaitlistOnPaid(env.DB, reg.id);
  await logEvent(env.DB, {
    registration_id: reg.id,
    kind: 'paypal.retreat.captured',
    source: 'paypal',
    external_id: externalId,
    payload: {
      registration_id: reg.id,
      capture_id: capture.captureId,
      order_id: capture.orderId,
      amount_minor: capture.amountMinor,
      currency: capture.currency,
    },
  });

  await pushPaidRegistrationToDrip(env as any, reg.id);
  const fresh = (await getRetreatRegById(env.DB, reg.id)) ?? reg;
  await notifyRetreatOrder(env, fresh);
}

// Settle the deposit balance. The registration is already 'paid', so the
// "Completed registration" Drip event is NOT re-fired — but the idempotent Drip
// ecommerce order is re-emitted so its grand total rises from deposit to full.
export async function fulfillBalancePaypal(
  env: PaypalFulfillEnv,
  registrationId: number,
  capture: PaypalCapture,
): Promise<void> {
  if (!capture.captureId) return;
  const externalId = `paypal.balance.captured.${capture.captureId}`;
  if (await eventExists(env.DB, externalId)) return;

  const reg = await getRetreatRegById(env.DB, registrationId);
  if (!reg) return;

  const balanceCents = reg.balance_due_cents ?? 0;
  await markBalancePaid(env.DB, reg.id);
  // Lift the Drip order to the now-full amount_cents (idempotent; no event).
  await recordRetreatOrder(env, reg.id);
  // Its own SD-ORDER — money landing weeks after the booking is its own line
  // in the ops inbox. (No Quaderno invoice from us on a gateway payment; see
  // lib/orders/retreat-invoice.ts.)
  const settled = (await getRetreatRegById(env.DB, reg.id)) ?? reg;
  await notifyRetreatBalanceOrder(env, settled, {
    amountCents: balanceCents,
    provider: 'paypal',
  });
  await logEvent(env.DB, {
    registration_id: reg.id,
    kind: 'paypal.balance.paid',
    source: 'paypal',
    external_id: externalId,
    payload: {
      registration_id: reg.id,
      capture_id: capture.captureId,
      order_id: capture.orderId,
      amount_minor: capture.amountMinor,
      currency: capture.currency,
    },
  });
}

// ── Workshops ─────────────────────────────────────────────────────────────

// Record a paid PayPal workshop ticket: payment row, purchase ledger lines
// (ticket + optional bump, reconstructed from the captured total minus the bump
// price — no need for the discount_pct the Stripe path reads from metadata),
// flip the registration to paid, and run the side effects (Drip / email / Meta).
export async function fulfillWorkshopPaypalCapture(
  env: PaypalFulfillEnv,
  registrationId: number,
  capture: PaypalCapture,
  ctx?: { waitUntil?: (p: Promise<unknown>) => void },
): Promise<void> {
  if (!capture.captureId) return;
  if (await getPaymentByPaypalCapture(env.DB, capture.captureId)) return;

  const reg = await getWorkshopRegById(env.DB, registrationId);
  if (!reg) return;
  const workshop = await getWorkshopById(env.DB, reg.workshop_id);
  if (!workshop) return;

  const amountMinor = capture.amountMinor ?? 0;
  const currency = (capture.currency ?? reg.currency ?? 'EUR').toUpperCase();
  const taxCountry = (reg.country ?? '').toUpperCase() || null;

  // Resolve the bump (only when the buyer opted in) to split ticket vs bump in
  // the purchase ledger: ticket = captured total − bump price. wants_bump is
  // only 1 when register.ts actually resolved + charged a bump, so resolving it
  // through the SAME shared helper reconstructs exactly what was charged — and
  // records the ledger line against the product the buyer actually bought.
  const bumpProductId = await resolveWorkshopBumpProductId(env.DB, workshop);
  let bumpProduct = null;
  let bumpPrice = null;
  if (reg.wants_bump === 1 && bumpProductId) {
    bumpProduct = await getProductById(env.DB, bumpProductId);
    bumpPrice = await resolvePrice(env.DB, bumpProductId, currency);
  }
  const realBump = !!(bumpProduct && bumpPrice);
  const bumpMinor = realBump ? bumpPrice!.amountMinor : 0;
  const ticketMinor = Math.max(0, amountMinor - bumpMinor);

  // Tax split via Quaderno tax-rate lookup (tax only; the invoice itself is
  // created by the PayPal→Quaderno connector).
  let taxRate = 0;
  if (taxCountry && env.QUADERNO_API_KEY && env.QUADERNO_ACCOUNT) {
    try {
      taxRate = await getTaxRate(
        {
          apiKey: env.QUADERNO_API_KEY,
          account: env.QUADERNO_ACCOUNT,
          sandbox: env.QUADERNO_SANDBOX === '1',
        },
        taxCountry,
      );
    } catch {
      taxRate = 0;
    }
  }
  const { subtotalMinor, taxMinor } = netFromGross(amountMinor, taxRate);

  const paymentId = await upsertPaypalPayment(env.DB, {
    registration_id: registrationId,
    paypal_order_id: capture.orderId,
    paypal_capture_id: capture.captureId,
    status: 'paid',
    amount_minor: amountMinor,
    currency,
    settlement_amount_minor: capture.settlementAmountMinor,
    settlement_currency: capture.settlementCurrency,
    fx_rate: capture.fxRate,
    tax_rate: taxRate || null,
    tax_country: taxCountry,
    subtotal_minor: subtotalMinor,
    tax_minor: taxMinor,
    raw_event: capture,
  });

  if (!(await purchasesExistForPayment(env.DB, paymentId))) {
    if (workshop.main_product_id) {
      const ticket = await getProductById(env.DB, workshop.main_product_id);
      if (ticket) {
        await insertPurchase(env.DB, {
          registration_id: registrationId,
          payment_id: paymentId,
          product_id: ticket.id,
          product_type: ticket.type,
          amount_minor: ticketMinor,
          currency,
        });
      }
    }
    if (realBump) {
      await insertPurchase(env.DB, {
        registration_id: registrationId,
        payment_id: paymentId,
        product_id: bumpProduct!.id,
        product_type: bumpProduct!.type,
        amount_minor: bumpMinor,
        currency,
      });
    }
  }

  await setRegistrationPaymentStatus(env.DB, registrationId, 'paid');

  const sideEffects = runWorkshopPaidSideEffects(env as any, {
    registrationId,
    valueMajor: amountMinor / 100,
    currency,
  });
  if (ctx?.waitUntil) ctx.waitUntil(sideEffects);
  else await sideEffects.catch(() => {});

  await logEvent(env.DB, {
    registration_id: null,
    kind: 'paypal.workshop.paid',
    source: 'paypal',
    external_id: `paypal.workshop.paid.${capture.captureId}`,
    payload: {
      registration_id: registrationId,
      capture_id: capture.captureId,
      amount_minor: amountMinor,
      currency,
    },
  });
}

// ── Refunds ─────────────────────────────────────────────────────────────

// Record a PayPal refund against whichever row owns the capture. Idempotent on
// the refund id, so the admin endpoint (which has the refund response in hand)
// and the webhook can both call this without double-counting. PayPal sends the
// individual refund amount (the delta), so partials accumulate correctly.
export async function recordPaypalRefund(
  env: PaypalFulfillEnv,
  args: {
    refundId: string;
    captureId: string;
    amountMinor: number | null;
    currency: string | null;
  },
): Promise<'retreat' | 'course' | 'workshop' | 'none'> {
  const externalId = `paypal.refund.recorded.${args.refundId}`;
  if (await eventExists(env.DB, externalId)) {
    // Already recorded — report which kind it was for the caller's response.
    return 'none';
  }

  const delta = args.amountMinor ?? 0;

  // 1. Retreat
  const retreat = await getRegistrationByPaypalCapture(env.DB, args.captureId);
  if (retreat) {
    await markRegistrationRefunded(env.DB, retreat.id, delta);
    await logEvent(env.DB, {
      registration_id: retreat.id,
      kind: 'paypal.retreat.refunded',
      source: 'paypal',
      external_id: externalId,
      payload: { ...args },
    });
    return 'retreat';
  }

  // 2. Course (one-off first installment / full payment)
  const course = await getCourseRegistrationByPaypalCapture(
    env.DB,
    args.captureId,
  );
  if (course) {
    await markCourseRegistrationRefunded(env.DB, course.id, delta);
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'paypal.course.refunded',
      source: 'paypal',
      external_id: externalId,
      payload: { course_registration_id: course.id, ...args },
    });
    return 'course';
  }

  // 3. Workshop
  const wpay = await getPaymentByPaypalCapture(env.DB, args.captureId);
  if (wpay) {
    await setPaymentStatusByPaypalCapture(env.DB, args.captureId, 'refunded');
    await setRegistrationPaymentStatus(env.DB, wpay.registration_id, 'refunded');
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'paypal.workshop.refunded',
      source: 'paypal',
      external_id: externalId,
      payload: { registration_id: wpay.registration_id, ...args },
    });
    return 'workshop';
  }

  await logEvent(env.DB, {
    registration_id: null,
    kind: 'paypal.refund.unmatched',
    source: 'paypal',
    external_id: externalId,
    payload: { ...args },
  });
  return 'none';
}

export type { Registration, CourseRegistration };
