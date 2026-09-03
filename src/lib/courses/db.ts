// CRUD for course_registrations. Mirrors the slim subset of
// src/lib/registrations/db.ts that the course flow needs.

import type { JourneyLanguageChoice, JourneySlug } from './journeys';
import type { DeckGiftShipping } from './deck-promo';

// The thematic SVH course products. Journeys (asj/mmj/inner-child + PRO/bundle)
// are also stored on course_registrations, so the registration's product_slug
// is the union of both.
export type CourseProductSlug = 'cc-cert' | 'cc-bundle' | 'grief-course' | 'svh-12week';
// `album-<id>` = a music album bought on its own (src/lib/music/product.ts);
// the id half is the dynamic music_albums row key, hence the template type.
export type CourseRegistrationSlug = CourseProductSlug | JourneySlug | `album-${string}`;
export type ActivateChoice = 'now' | 'wait';
export type PaymentPlan = 'full' | '3x' | '6x' | '12x';

// Mirrors the Stripe Subscription `status` enum exactly. We store it
// verbatim so the admin view shows the live Stripe state without a
// translation table.
export type SubscriptionStatus =
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused';

export type CourseRegistration = {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  country: string | null;
  phone: string | null;
  phone_country: string | null;
  // IANA timezone, edge-detected (cf.timezone) at checkout. Forwarded to Drip
  // as the subscriber's native time_zone. See migration 0057.
  timezone: string | null;
  company_name: string | null;
  vat_number: string | null;
  product_slug: CourseRegistrationSlug;
  activate_choice: ActivateChoice | null;
  // Authentic Singing Journey language edition (Dutch / English / both). NULL
  // for products with no ASJ and any buyer never shown the choice — see
  // journeyDrip in ./journeys.ts.
  language_choice: JourneyLanguageChoice | null;
  source_variant: string | null;
  // Order bumps bought alongside the course, as a JSON array of
  // {slug, amount_cents} (12-week only). NULL when none — see ./bumps.ts and
  // parsePurchasedBumps below.
  bumps: string | null;
  // The Song Deck gift shipping address, collected inline while the gift window
  // is live, as a JSON DeckGiftShipping blob (see ./deck-promo.ts). NULL when no
  // address was collected — then the buyer gets the self-serve claim email
  // instead. Migration 0075.
  deck_gift_shipping: string | null;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'paid' | 'cancelled' | 'refunded' | 'expired';
  // Which gateway owns this row. 'stripe' for every legacy row (default).
  provider: 'stripe' | 'paypal';
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  stripe_subscription_id: string | null;
  // PayPal counterparts (see migration 0049). paypal_order_id is the one-off
  // Orders API order; paypal_capture_id the captured payment (refund target);
  // paypal_subscription_id the installment subscription.
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  paypal_subscription_id: string | null;
  subscription_status: SubscriptionStatus | null;
  payment_plan: PaymentPlan;
  installments_paid: number;
  installments_total: number;
  // Admin-scheduled early stop: the total number of installments that should
  // ever be charged (installments_paid + charges still allowed). NULL = run the
  // full plan. See migration 0054 + src/lib/courses/installment-cancel.ts.
  cancel_after_installment: number | null;
  consent_terms: number;
  consent_at: string | null;
  // Set only for manual bank-transfer orders — the Quaderno invoice the admin
  // flow creates itself (no Stripe payment → no native-connector invoice).
  // NULL for every Stripe/PayPal row (their invoice is made by the connector).
  quaderno_invoice_id: string | null;
  created_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  refunded_at: string | null;
  refunded_amount_cents: number;
};

export type CreatePendingCourseRegistrationInput = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  country: string | null;
  phone: string | null;
  phone_country: string | null;
  // Edge-detected IANA timezone (cf.timezone), forwarded to Drip. Optional.
  timezone?: string | null;
  company_name: string | null;
  vat_number: string | null;
  product_slug: CourseRegistrationSlug;
  activate_choice: ActivateChoice | null;
  // ASJ language edition; null/omitted for everything else (English default).
  language_choice?: JourneyLanguageChoice | null;
  source_variant: string | null;
  // Order bumps (12-week only); each {slug, amount_cents}. Omit / null for none.
  bumps?: Array<{ slug: string; amount_cents: number }> | null;
  // Song Deck gift shipping address (see ./deck-promo.ts). Omit / null for none.
  deck_gift_shipping?: DeckGiftShipping | null;
  amount_cents: number;
  currency: string;
  consent_terms: boolean;
  payment_plan: PaymentPlan;
  installments_total: number;
  // Defaults to 'stripe' when omitted (every legacy caller).
  provider?: 'stripe' | 'paypal';
};

export async function createPendingCourseRegistration(
  db: D1Database,
  input: CreatePendingCourseRegistrationInput,
): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO course_registrations
       (email, first_name, last_name, country, phone, phone_country, timezone,
        company_name, vat_number,
        product_slug, activate_choice, language_choice, source_variant, bumps,
        deck_gift_shipping,
        amount_cents, currency, status, provider,
        payment_plan, installments_total,
        consent_terms, consent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.email,
      input.first_name,
      input.last_name,
      input.country,
      input.phone,
      input.phone_country,
      input.timezone ?? null,
      input.company_name,
      input.vat_number,
      input.product_slug,
      input.activate_choice,
      input.language_choice ?? null,
      input.source_variant,
      input.bumps && input.bumps.length ? JSON.stringify(input.bumps) : null,
      input.deck_gift_shipping ? JSON.stringify(input.deck_gift_shipping) : null,
      input.amount_cents,
      input.currency,
      input.provider ?? 'stripe',
      input.payment_plan,
      input.installments_total,
      input.consent_terms ? 1 : 0,
      input.consent_terms ? new Date().toISOString() : null,
    )
    .run();
  const id = res.meta?.last_row_id;
  if (typeof id !== 'number') {
    throw new Error('Failed to create course_registration: no last_row_id');
  }
  return id;
}

// Parse the JSON `bumps` column into a validated list of purchased add-ons.
// Returns [] for null / empty / malformed input, so callers (paid-handler,
// order notification) can always iterate safely.
export type PurchasedBump = { slug: string; amount_cents: number };
export function parsePurchasedBumps(
  raw: string | null | undefined,
): PurchasedBump[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (b) =>
          b &&
          typeof b.slug === 'string' &&
          Number.isFinite(b.amount_cents),
      )
      .map((b) => ({ slug: b.slug as string, amount_cents: Math.round(b.amount_cents) }));
  } catch {
    return [];
  }
}

export async function attachStripeSessionToCourse(
  db: D1Database,
  id: number,
  sessionId: string,
) {
  await db
    .prepare('UPDATE course_registrations SET stripe_session_id = ? WHERE id = ?')
    .bind(sessionId, id)
    .run();
}

// Persist the Quaderno invoice id created for a manual bank-transfer order.
export async function attachQuadernoInvoiceToCourse(
  db: D1Database,
  id: number,
  invoiceId: string,
) {
  await db
    .prepare('UPDATE course_registrations SET quaderno_invoice_id = ? WHERE id = ?')
    .bind(invoiceId, id)
    .run();
}

// Override paid_at with the real payment date. markCourseRegistrationPaid stamps
// datetime('now'); a manual bank-transfer order backdates it to the day the
// money actually landed, so the Quaderno invoice and the Drip order (which times
// itself by paid_at) both carry the true payment date. `iso` is a
// 'YYYY-MM-DD HH:MM:SS' UTC string.
export async function setCoursePaidAt(
  db: D1Database,
  id: number,
  iso: string,
) {
  await db
    .prepare("UPDATE course_registrations SET paid_at = ? WHERE id = ?")
    .bind(iso, id)
    .run();
}

export async function getCourseRegistrationById(
  db: D1Database,
  id: number,
) {
  return db
    .prepare('SELECT * FROM course_registrations WHERE id = ?')
    .bind(id)
    .first<CourseRegistration>();
}

export async function getCourseRegistrationBySession(
  db: D1Database,
  sessionId: string,
) {
  return db
    .prepare('SELECT * FROM course_registrations WHERE stripe_session_id = ?')
    .bind(sessionId)
    .first<CourseRegistration>();
}

// Flip any `pending` course rows older than 15 minutes to `expired`.
// Course checkouts have no hold/inventory, so the only reason to keep a
// pending row alive is the live Stripe Checkout session — and the user
// has almost certainly abandoned by 15 min. If they do still pay (Stripe
// sessions live up to 24h), `markCourseRegistrationPaid` will flip the
// row back to `paid` since its guard is only `status != 'paid'`.
export async function expireStaleCoursePendings(db: D1Database) {
  await db
    .prepare(
      `UPDATE course_registrations
          SET status = 'expired'
        WHERE status = 'pending'
          AND created_at < datetime('now', '-15 minutes')`,
    )
    .run();
}

export async function deleteCourseRegistration(db: D1Database, id: number) {
  await db
    .prepare('DELETE FROM course_registrations WHERE id = ?')
    .bind(id)
    .run();
}

export async function listCourseRegistrations(
  db: D1Database,
  productSlug: CourseProductSlug | string,
  statusFilter?: string,
) {
  const where = ['product_slug = ?'];
  const binds: unknown[] = [productSlug];
  if (statusFilter) {
    where.push('status = ?');
    binds.push(statusFilter);
  }
  const r = await db
    .prepare(
      `SELECT * FROM course_registrations
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC`,
    )
    .bind(...binds)
    .all<CourseRegistration>();
  return r.results ?? [];
}

export async function markCourseRegistrationPaid(
  db: D1Database,
  id: number,
  paymentIntent: string,
) {
  await db
    .prepare(
      `UPDATE course_registrations
         SET status = 'paid',
             stripe_payment_intent = ?,
             paid_at = datetime('now')
       WHERE id = ? AND status != 'paid'`,
    )
    .bind(paymentIntent, id)
    .run();
}

// Record (or clear) an admin-scheduled early stop for an installment plan.
// `n` is the TOTAL number of installments that should ever be charged
// (installments_paid + the charges still allowed); null clears the schedule and
// lets the plan run to its full length. See migration 0054 + installment-cancel.
export async function setCourseCancelAfterInstallment(
  db: D1Database,
  id: number,
  n: number | null,
) {
  await db
    .prepare(
      'UPDATE course_registrations SET cancel_after_installment = ? WHERE id = ?',
    )
    .bind(n, id)
    .run();
}

export async function attachStripeSubscriptionToCourse(
  db: D1Database,
  id: number,
  subscriptionId: string,
) {
  await db
    .prepare(
      'UPDATE course_registrations SET stripe_subscription_id = ? WHERE id = ?',
    )
    .bind(subscriptionId, id)
    .run();
}

export async function getCourseRegistrationBySubscription(
  db: D1Database,
  subscriptionId: string,
) {
  return db
    .prepare(
      'SELECT * FROM course_registrations WHERE stripe_subscription_id = ?',
    )
    .bind(subscriptionId)
    .first<CourseRegistration>();
}

// Bumps installments_paid by 1 and flips the row to 'paid' the first time
// (so the first installment grants access). Uses a single UPDATE so the
// transition is atomic with the count change.
//
// We deliberately leave 'cancelled' and 'refunded' rows alone: once an
// admin (or a later webhook) has moved the row out of the paid lane, a
// late `invoice.paid` for a still-flying invoice must not silently
// resurrect it. Stripe normally stops issuing invoices the moment a sub
// is cancelled, but there's a tiny race if invoice generation and
// cancellation overlap — this guard makes that race safe.
export async function recordInstallmentPaid(
  db: D1Database,
  id: number,
  paymentIntent: string | null,
) {
  await db
    .prepare(
      `UPDATE course_registrations
         SET installments_paid = installments_paid + 1,
             status = CASE WHEN status IN ('cancelled','refunded') THEN status ELSE 'paid' END,
             stripe_payment_intent = COALESCE(stripe_payment_intent, ?),
             paid_at = COALESCE(paid_at, datetime('now'))
       WHERE id = ?`,
    )
    .bind(paymentIntent, id)
    .run();
}

// Mirror Stripe's live `subscription.status` onto our row so the admin
// view can show "active vs canceled vs past_due" at a glance even when
// our coarse-grained `status` column is still 'paid' (e.g. cancel_at
// scheduled in the future, or sub temporarily past_due before recovery).
//
// Returns true if a row was updated — useful for distinguishing
// "subscription not yet linked" from "linked but state hasn't changed".
export async function updateCourseSubscriptionStatus(
  db: D1Database,
  subscriptionId: string,
  subscriptionStatus: SubscriptionStatus,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE course_registrations
         SET subscription_status = ?
       WHERE stripe_subscription_id = ?`,
    )
    .bind(subscriptionStatus, subscriptionId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// Flip the row to 'cancelled' (terminal — no Drip side-effects). Used by
// `customer.subscription.deleted` and as an idempotent step inside the
// `customer.subscription.updated → canceled` path. Guards against
// over-writing a 'refunded' row (refund is a stronger statement).
export async function markCourseRegistrationCancelled(
  db: D1Database,
  id: number,
) {
  await db
    .prepare(
      `UPDATE course_registrations
         SET status = 'cancelled',
             subscription_status = 'canceled',
             cancelled_at = COALESCE(cancelled_at, datetime('now'))
       WHERE id = ?
         AND status NOT IN ('refunded')`,
    )
    .bind(id)
    .run();
}

// Gross money this row has actually taken, in its own currency: an installment
// plan bills monthly, so scale the plan total (`amount_cents` is always the
// WHOLE plan) by the cycles charged, and add the order bumps, which ride the
// first charge in full. Mirrors collectedMinorOf in workshops/stats.ts — the
// two must agree, or the status below would contradict the revenue figures.
export function collectedGrossMinor(r: {
  amount_cents: number;
  installments_paid: number;
  installments_total: number;
  bumps?: string | null;
}): number {
  const cycles =
    r.installments_total > 1
      ? Math.round(
          r.amount_cents *
            (Math.max(0, Math.min(r.installments_paid, r.installments_total)) /
              r.installments_total),
        )
      : r.amount_cents;
  const bumps =
    r.installments_paid > 0 || r.installments_total <= 1
      ? parsePurchasedBumps(r.bumps ?? null).reduce(
          (sum, b) => sum + Math.max(0, b.amount_cents),
          0,
        )
      : 0;
  return cycles + bumps;
}

// Accumulate a refund on the row, and flip `status` to 'refunded' only once the
// refunds reach everything the row has actually collected.
//
// Both refund paths land here: the `charge.refunded` webhook (whichever cycle
// Stripe refunded, including one refunded by hand in the Stripe dashboard) and
// the admin's per-installment refund. Stripe fires once per refund operation,
// so we add to a running total and a sequence of partials still sums correctly.
//
// WHY NOT ALWAYS 'refunded'. It used to flip on any refund, however small. But
// `status` is not "some money went back" — the revenue stack reads it as "this
// plan has stopped": contractedMinorOf (workshops/stats.ts) counts a refunded
// row at `installments_paid` cycles instead of its contracted total, and the
// future-revenue forecast (courses/installment-forecast.ts) drops it entirely.
// So giving one installment of a six back as a goodwill gesture silently wrote
// off the four still to bill — on a plan Stripe was still happily charging.
// Below the threshold the row keeps the status it had and only
// `refunded_amount_cents` moves; every figure already nets refunds off that
// (netOfRefundMinor), so the money stays right either way.
//
// Two statements rather than one, so the threshold can reuse the shared
// collected-gross rule instead of being re-derived in SQL. Safe under
// concurrency: the increment is atomic, the total only ever grows, and the flip
// is idempotent — whichever writer reads last does it.
export async function markCourseRegistrationRefunded(
  db: D1Database,
  id: number,
  refundedAmountCents: number,
) {
  await db
    .prepare(
      `UPDATE course_registrations
         SET refunded_amount_cents = refunded_amount_cents + ?,
             refunded_at = COALESCE(refunded_at, datetime('now'))
       WHERE id = ?`,
    )
    .bind(refundedAmountCents, id)
    .run();

  const row = await db
    .prepare(
      `SELECT amount_cents, refunded_amount_cents, installments_paid,
              installments_total, bumps
         FROM course_registrations WHERE id = ?`,
    )
    .bind(id)
    .first<{
      amount_cents: number;
      refunded_amount_cents: number;
      installments_paid: number;
      installments_total: number;
      bumps: string | null;
    }>();
  if (!row) return;

  const collected = collectedGrossMinor(row);
  if (collected > 0 && (row.refunded_amount_cents ?? 0) < collected) return;

  await db
    .prepare(
      `UPDATE course_registrations SET status = 'refunded' WHERE id = ?`,
    )
    .bind(id)
    .run();
}

// Look up a course row by the first installment's PaymentIntent (the only
// one we persist on the row itself). For later installments we fall back
// to subscription lookups in the webhook.
export async function getCourseRegistrationByPaymentIntent(
  db: D1Database,
  paymentIntent: string,
) {
  return db
    .prepare(
      'SELECT * FROM course_registrations WHERE stripe_payment_intent = ?',
    )
    .bind(paymentIntent)
    .first<CourseRegistration>();
}

// ─────────────────────────────────────────────────────────────────────
//  PayPal mirrors of the Stripe helpers above. Same row, different ids;
//  the webhook / return endpoint pick the path by `provider`.
// ─────────────────────────────────────────────────────────────────────

export async function attachPaypalOrderToCourse(
  db: D1Database,
  id: number,
  orderId: string,
) {
  await db
    .prepare('UPDATE course_registrations SET paypal_order_id = ? WHERE id = ?')
    .bind(orderId, id)
    .run();
}

export async function attachPaypalSubscriptionToCourse(
  db: D1Database,
  id: number,
  subscriptionId: string,
) {
  await db
    .prepare(
      'UPDATE course_registrations SET paypal_subscription_id = ? WHERE id = ?',
    )
    .bind(subscriptionId, id)
    .run();
}

export async function getCourseRegistrationByPaypalOrder(
  db: D1Database,
  orderId: string,
) {
  return db
    .prepare('SELECT * FROM course_registrations WHERE paypal_order_id = ?')
    .bind(orderId)
    .first<CourseRegistration>();
}

export async function getCourseRegistrationByPaypalSubscription(
  db: D1Database,
  subscriptionId: string,
) {
  return db
    .prepare(
      'SELECT * FROM course_registrations WHERE paypal_subscription_id = ?',
    )
    .bind(subscriptionId)
    .first<CourseRegistration>();
}

export async function getCourseRegistrationByPaypalCapture(
  db: D1Database,
  captureId: string,
) {
  return db
    .prepare('SELECT * FROM course_registrations WHERE paypal_capture_id = ?')
    .bind(captureId)
    .first<CourseRegistration>();
}

// One-off / full-payment PayPal course paid (mirrors markCourseRegistrationPaid).
export async function markCourseRegistrationPaidPaypal(
  db: D1Database,
  id: number,
  captureId: string,
) {
  await db
    .prepare(
      `UPDATE course_registrations
         SET status = 'paid',
             paypal_capture_id = ?,
             paid_at = datetime('now')
       WHERE id = ? AND status != 'paid'`,
    )
    .bind(captureId, id)
    .run();
}

// Bump installments_paid by 1 for a PayPal subscription cycle (mirrors
// recordInstallmentPaid). Stores the first capture id as the refund anchor.
export async function recordPaypalInstallmentPaid(
  db: D1Database,
  id: number,
  captureId: string | null,
) {
  await db
    .prepare(
      `UPDATE course_registrations
         SET installments_paid = installments_paid + 1,
             status = CASE WHEN status IN ('cancelled','refunded') THEN status ELSE 'paid' END,
             paypal_capture_id = COALESCE(paypal_capture_id, ?),
             paid_at = COALESCE(paid_at, datetime('now'))
       WHERE id = ?`,
    )
    .bind(captureId, id)
    .run();
}

// Mirror a (normalised) PayPal subscription status onto the row, keyed by the
// PayPal subscription id. Status is pre-mapped to the Stripe vocabulary via
// normalizePaypalSubStatus so the forecast/badge stay provider-agnostic.
export async function updateCourseSubscriptionStatusByPaypal(
  db: D1Database,
  subscriptionId: string,
  subscriptionStatus: SubscriptionStatus,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE course_registrations
         SET subscription_status = ?
       WHERE paypal_subscription_id = ?`,
    )
    .bind(subscriptionStatus, subscriptionId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}
