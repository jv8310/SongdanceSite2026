export type Product = {
  id: number;
  slug: string;
  type: 'retreat' | 'course' | 'workshop' | 'digital';
  name: string;
  description: string | null;
  currency: string;
  vat_rate: number;
  starts_at: string | null;
  ends_at: string | null;
  drip_tag: string | null;
  active: number;
};

export type Tier = {
  id: number;
  product_id: number;
  slug: string;
  name: string;
  description: string | null;
  price_cents: number;
  capacity: number;
  sort_order: number;
  active: number;
};

export type InventoryUnit = {
  id: number;
  tier_id: number;
  name: string;
  capacity: number;
  notes: string | null;
  status: 'available' | 'reserved' | 'inactive';
  sort_order: number;
};

export type Registration = {
  id: number;
  product_id: number;
  tier_id: number;
  inventory_unit_id: number | null;
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
  roommate_pref: string | null;
  dietary: string | null;
  notes: string | null;
  status:
    | 'pending'
    | 'paid'
    | 'cancelled'
    | 'refunded'
    | 'waitlist'
    | 'expired';
  amount_cents: number;
  currency: string;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  quaderno_invoice_id: string | null;
  hold_expires_at: string | null;
  created_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
};

export async function getProductBySlug(db: D1Database, slug: string) {
  return db
    .prepare('SELECT * FROM products WHERE slug = ? AND active = 1')
    .bind(slug)
    .first<Product>();
}

export async function getTiersForProduct(db: D1Database, productId: number) {
  const r = await db
    .prepare(
      'SELECT * FROM tiers WHERE product_id = ? AND active = 1 ORDER BY sort_order, id',
    )
    .bind(productId)
    .all<Tier>();
  return r.results ?? [];
}

export async function getTierBySlug(
  db: D1Database,
  productId: number,
  slug: string,
) {
  return db
    .prepare(
      'SELECT * FROM tiers WHERE product_id = ? AND slug = ? AND active = 1',
    )
    .bind(productId, slug)
    .first<Tier>();
}

export async function getTierAvailability(db: D1Database, tierId: number) {
  const tier = await db
    .prepare('SELECT capacity FROM tiers WHERE id = ?')
    .bind(tierId)
    .first<{ capacity: number }>();
  if (!tier) return { capacity: 0, taken: 0, remaining: 0 };

  const counted = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM registrations
        WHERE tier_id = ?
          AND status IN ('paid','pending')
          AND (status = 'paid' OR hold_expires_at IS NULL OR hold_expires_at > datetime('now'))`,
    )
    .bind(tierId)
    .first<{ n: number }>();
  const taken = counted?.n ?? 0;
  return {
    capacity: tier.capacity,
    taken,
    remaining: Math.max(0, tier.capacity - taken),
  };
}

export async function createPendingRegistration(
  db: D1Database,
  data: {
    product_id: number;
    tier_id: number;
    name: string;
    email: string;
    phone: string | null;
    country: string | null;
    roommate_pref: string | null;
    dietary: string | null;
    notes: string | null;
    amount_cents: number;
    currency: string;
    hold_minutes: number;
  },
) {
  const holdExpires = new Date(
    Date.now() + data.hold_minutes * 60 * 1000,
  ).toISOString();
  const r = await db
    .prepare(
      `INSERT INTO registrations
        (product_id, tier_id, name, email, phone, country,
         roommate_pref, dietary, notes,
         status, amount_cents, currency, hold_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      data.product_id,
      data.tier_id,
      data.name,
      data.email,
      data.phone,
      data.country,
      data.roommate_pref,
      data.dietary,
      data.notes,
      data.amount_cents,
      data.currency,
      holdExpires,
    )
    .first<{ id: number }>();
  if (!r) throw new Error('Failed to create registration');
  return r.id;
}

export async function attachStripeSession(
  db: D1Database,
  registrationId: number,
  sessionId: string,
) {
  await db
    .prepare(
      'UPDATE registrations SET stripe_session_id = ? WHERE id = ?',
    )
    .bind(sessionId, registrationId)
    .run();
}

export async function markRegistrationPaid(
  db: D1Database,
  registrationId: number,
  paymentIntent: string,
) {
  await db
    .prepare(
      `UPDATE registrations
          SET status = 'paid',
              stripe_payment_intent = ?,
              paid_at = datetime('now'),
              hold_expires_at = NULL
        WHERE id = ?
          AND status IN ('pending','expired')`,
    )
    .bind(paymentIntent, registrationId)
    .run();
}

export async function setQuadernoInvoice(
  db: D1Database,
  registrationId: number,
  invoiceId: string,
) {
  await db
    .prepare(
      'UPDATE registrations SET quaderno_invoice_id = ? WHERE id = ?',
    )
    .bind(invoiceId, registrationId)
    .run();
}

export async function getRegistrationBySession(
  db: D1Database,
  sessionId: string,
) {
  return db
    .prepare('SELECT * FROM registrations WHERE stripe_session_id = ?')
    .bind(sessionId)
    .first<Registration>();
}

export async function getRegistrationById(db: D1Database, id: number) {
  return db
    .prepare('SELECT * FROM registrations WHERE id = ?')
    .bind(id)
    .first<Registration>();
}

export async function logEvent(
  db: D1Database,
  data: {
    registration_id: number | null;
    kind: string;
    source?: string;
    external_id?: string | null;
    payload?: unknown;
  },
) {
  await db
    .prepare(
      `INSERT INTO events (registration_id, kind, source, external_id, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      data.registration_id,
      data.kind,
      data.source ?? 'system',
      data.external_id ?? null,
      data.payload ? JSON.stringify(data.payload) : null,
    )
    .run();
}

export async function eventExists(db: D1Database, externalId: string) {
  const r = await db
    .prepare('SELECT 1 AS one FROM events WHERE external_id = ?')
    .bind(externalId)
    .first<{ one: number }>();
  return !!r;
}
