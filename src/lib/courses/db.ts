// CRUD for course_registrations. Mirrors the slim subset of
// src/lib/registrations/db.ts that the course flow needs.

export type CourseProductSlug = 'cc-cert' | 'cc-bundle';
export type ActivateChoice = 'now' | 'wait';

export type CourseRegistration = {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  country: string | null;
  phone: string | null;
  phone_country: string | null;
  product_slug: CourseProductSlug;
  activate_choice: ActivateChoice | null;
  source_variant: string | null;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'paid' | 'cancelled' | 'refunded' | 'expired';
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
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
  product_slug: CourseProductSlug;
  activate_choice: ActivateChoice | null;
  source_variant: string | null;
  amount_cents: number;
  currency: string;
  consent_terms: boolean;
};

export async function createPendingCourseRegistration(
  db: D1Database,
  input: CreatePendingCourseRegistrationInput,
): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO course_registrations
       (email, first_name, last_name, country, phone, phone_country,
        product_slug, activate_choice, source_variant,
        amount_cents, currency, status,
        consent_terms, consent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      input.email,
      input.first_name,
      input.last_name,
      input.country,
      input.phone,
      input.phone_country,
      input.product_slug,
      input.activate_choice,
      input.source_variant,
      input.amount_cents,
      input.currency,
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
