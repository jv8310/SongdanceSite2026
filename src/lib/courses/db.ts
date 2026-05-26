// CRUD for course_registrations. Mirrors the slim subset of
// src/lib/registrations/db.ts that the course flow needs.

export type CourseProductSlug = 'cc-cert' | 'cc-bundle';
export type ActivateChoice = 'now' | 'wait';
export type PaymentPlan = 'full' | '3x';

export type CourseRegistration = {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  country: string | null;
  phone: string | null;
  phone_country: string | null;
  company_name: string | null;
  vat_number: string | null;
  product_slug: CourseProductSlug;
  activate_choice: ActivateChoice | null;
  source_variant: string | null;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'paid' | 'cancelled' | 'refunded' | 'expired';
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  stripe_subscription_id: string | null;
  payment_plan: PaymentPlan;
  installments_paid: number;
  installments_total: number;
  consent_terms: number;
  consent_at: string | null;
  created_at: string;
  paid_at: string | null;
};

export type CreatePendingCourseRegistrationInput = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  country: string | null;
  phone: string | null;
  phone_country: string | null;
  company_name: string | null;
  vat_number: string | null;
  product_slug: CourseProductSlug;
  activate_choice: ActivateChoice | null;
  source_variant: string | null;
  amount_cents: number;
  currency: string;
  consent_terms: boolean;
  payment_plan: PaymentPlan;
  installments_total: number;
};

export async function createPendingCourseRegistration(
  db: D1Database,
  input: CreatePendingCourseRegistrationInput,
): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO course_registrations
       (email, first_name, last_name, country, phone, phone_country,
        company_name, vat_number,
        product_slug, activate_choice, source_variant,
        amount_cents, currency, status,
        payment_plan, installments_total,
        consent_terms, consent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    )
    .bind(
      input.email,
      input.first_name,
      input.last_name,
      input.country,
      input.phone,
      input.phone_country,
      input.company_name,
      input.vat_number,
      input.product_slug,
      input.activate_choice,
      input.source_variant,
      input.amount_cents,
      input.currency,
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
export async function recordInstallmentPaid(
  db: D1Database,
  id: number,
  paymentIntent: string | null,
) {
  await db
    .prepare(
      `UPDATE course_registrations
         SET installments_paid = installments_paid + 1,
             status = CASE WHEN status = 'paid' THEN 'paid' ELSE 'paid' END,
             stripe_payment_intent = COALESCE(stripe_payment_intent, ?),
             paid_at = COALESCE(paid_at, datetime('now'))
       WHERE id = ?`,
    )
    .bind(paymentIntent, id)
    .run();
}
