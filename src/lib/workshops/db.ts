// Data layer for the workshop engine. Raw prepared statements against D1,
// matching the style of src/lib/registrations/db.ts. All tables are
// `workshop_`-prefixed (see migrations/0021_workshops.sql).

import { BASE_CURRENCY } from './currency';

export type WorkshopProduct = {
  id: number;
  slug: string;
  name: string;
  type: 'ticket' | 'bump' | 'course';
  tax_code: string;
  active: number;
};

export type Workshop = {
  id: number;
  slug: string;
  title: string;
  teacher: string | null;
  starts_at_utc: string;
  ends_at_utc: string | null;
  display_tz: string;
  zoom_url: string | null;
  main_product_id: number | null;
  bump_product_id: number | null;
  free_coupon: string | null;
  source_tag: string | null;
  google_event_id: string | null;
  status: 'draft' | 'published' | 'cancelled';
  is_replay: number;
  created_at: string;
  updated_at: string;
  deleted: number;
};

export type WorkshopRegistration = {
  id: number;
  workshop_id: number;
  name: string | null;
  email: string;
  phone: string | null;
  country: string | null;
  currency: string | null;
  timezone: string | null;
  locale: string | null;
  wants_bump: number;
  attendance_status: 'registered' | 'attended' | 'no_show';
  joined_at_utc: string | null;
  payment_status: 'prepared' | 'paid' | 'coupon' | 'refunded' | 'chargeback' | 'failed';
  source_tag: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkshopPayment = {
  id: number;
  registration_id: number;
  provider: string;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  balance_transaction_id: string | null;
  status: string;
  method: string | null;
  amount_minor: number;
  currency: string;
  settlement_amount_minor: number | null;
  settlement_currency: string | null;
  fx_rate: number | null;
  tax_rate: number | null;
  tax_country: string | null;
  subtotal_minor: number | null;
  tax_minor: number | null;
  quaderno_invoice_id: string | null;
  quaderno_invoice_number: string | null;
  created_at: string;
  updated_at: string;
};

// ── Products & prices ───────────────────────────────────────────────────

export async function getProductById(db: D1Database, id: number) {
  return db.prepare('SELECT * FROM workshop_products WHERE id = ?').bind(id).first<WorkshopProduct>();
}

export async function getProductBySlug(db: D1Database, slug: string) {
  return db.prepare('SELECT * FROM workshop_products WHERE slug = ?').bind(slug).first<WorkshopProduct>();
}

export async function listProducts(db: D1Database) {
  const r = await db.prepare('SELECT * FROM workshop_products ORDER BY type, name').all<WorkshopProduct>();
  return r.results ?? [];
}

// Resolve the price point for a product in a currency, falling back to the
// base currency (EUR) when there's no dedicated row.
export async function resolvePrice(
  db: D1Database,
  productId: number,
  currency: string,
): Promise<{ amountMinor: number; currency: string } | null> {
  const cur = currency.toUpperCase();
  const direct = await db
    .prepare('SELECT amount_minor FROM workshop_product_prices WHERE product_id = ? AND currency = ?')
    .bind(productId, cur)
    .first<{ amount_minor: number }>();
  if (direct) return { amountMinor: direct.amount_minor, currency: cur };

  const base = await db
    .prepare('SELECT amount_minor FROM workshop_product_prices WHERE product_id = ? AND currency = ?')
    .bind(productId, BASE_CURRENCY)
    .first<{ amount_minor: number }>();
  if (base) return { amountMinor: base.amount_minor, currency: BASE_CURRENCY };
  return null;
}

export async function listPricesForProduct(db: D1Database, productId: number) {
  const r = await db
    .prepare('SELECT currency, amount_minor FROM workshop_product_prices WHERE product_id = ? ORDER BY currency')
    .bind(productId)
    .all<{ currency: string; amount_minor: number }>();
  return r.results ?? [];
}

export async function setPrice(db: D1Database, productId: number, currency: string, amountMinor: number) {
  await db
    .prepare(
      `INSERT INTO workshop_product_prices (product_id, currency, amount_minor)
       VALUES (?, ?, ?)
       ON CONFLICT(product_id, currency) DO UPDATE SET amount_minor = excluded.amount_minor`,
    )
    .bind(productId, currency.toUpperCase(), amountMinor)
    .run();
}

// ── Workshops ───────────────────────────────────────────────────────────

export async function getPublishedWorkshopBySlug(db: D1Database, slug: string) {
  return db
    .prepare("SELECT * FROM workshops WHERE slug = ? AND status = 'published' AND deleted = 0")
    .bind(slug)
    .first<Workshop>();
}

export async function getWorkshopById(db: D1Database, id: number) {
  return db.prepare('SELECT * FROM workshops WHERE id = ?').bind(id).first<Workshop>();
}

export async function listWorkshops(db: D1Database, includeDeleted = false) {
  const sql = includeDeleted
    ? 'SELECT * FROM workshops ORDER BY starts_at_utc DESC'
    : 'SELECT * FROM workshops WHERE deleted = 0 ORDER BY starts_at_utc DESC';
  const r = await db.prepare(sql).all<Workshop>();
  return r.results ?? [];
}

export type WorkshopInput = {
  slug: string;
  title: string;
  teacher: string | null;
  starts_at_utc: string;
  ends_at_utc: string | null;
  display_tz: string;
  zoom_url: string | null;
  main_product_id: number | null;
  bump_product_id: number | null;
  free_coupon: string | null;
  source_tag: string | null;
  status: 'draft' | 'published' | 'cancelled';
  is_replay: number;
};

export async function createWorkshop(db: D1Database, input: WorkshopInput): Promise<number> {
  const r = await db
    .prepare(
      `INSERT INTO workshops
        (slug, title, teacher, starts_at_utc, ends_at_utc, display_tz, zoom_url,
         main_product_id, bump_product_id, free_coupon, source_tag, status, is_replay)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      input.slug, input.title, input.teacher, input.starts_at_utc, input.ends_at_utc,
      input.display_tz, input.zoom_url, input.main_product_id, input.bump_product_id,
      input.free_coupon, input.source_tag, input.status, input.is_replay,
    )
    .first<{ id: number }>();
  if (!r) throw new Error('Failed to create workshop');
  return r.id;
}

export async function updateWorkshop(db: D1Database, id: number, input: WorkshopInput) {
  await db
    .prepare(
      `UPDATE workshops SET
         slug = ?, title = ?, teacher = ?, starts_at_utc = ?, ends_at_utc = ?,
         display_tz = ?, zoom_url = ?, main_product_id = ?, bump_product_id = ?,
         free_coupon = ?, source_tag = ?, status = ?, is_replay = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(
      input.slug, input.title, input.teacher, input.starts_at_utc, input.ends_at_utc,
      input.display_tz, input.zoom_url, input.main_product_id, input.bump_product_id,
      input.free_coupon, input.source_tag, input.status, input.is_replay, id,
    )
    .run();
}

export async function softDeleteWorkshop(db: D1Database, id: number) {
  await db.prepare("UPDATE workshops SET deleted = 1, updated_at = datetime('now') WHERE id = ?").bind(id).run();
}

// Upsert by google_event_id — used by the Google Calendar import so re-running
// updates times rather than duplicating. Returns { id, created }.
export async function upsertWorkshopFromGoogle(
  db: D1Database,
  ev: { googleEventId: string; title: string; startsAtUtc: string; endsAtUtc: string | null; displayTz: string },
): Promise<{ id: number; created: boolean }> {
  const existing = await db
    .prepare('SELECT id FROM workshops WHERE google_event_id = ?')
    .bind(ev.googleEventId)
    .first<{ id: number }>();
  if (existing) {
    await db
      .prepare(
        `UPDATE workshops SET title = ?, starts_at_utc = ?, ends_at_utc = ?, display_tz = ?,
           updated_at = datetime('now') WHERE id = ?`,
      )
      .bind(ev.title, ev.startsAtUtc, ev.endsAtUtc, ev.displayTz, existing.id)
      .run();
    return { id: existing.id, created: false };
  }
  const slug = await uniqueSlug(db, slugify(ev.title));
  const r = await db
    .prepare(
      `INSERT INTO workshops (slug, title, starts_at_utc, ends_at_utc, display_tz, google_event_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'draft') RETURNING id`,
    )
    .bind(slug, ev.title, ev.startsAtUtc, ev.endsAtUtc, ev.displayTz, ev.googleEventId)
    .first<{ id: number }>();
  if (!r) throw new Error('Failed to create workshop from Google event');
  return { id: r.id, created: true };
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'workshop';
}

async function uniqueSlug(db: D1Database, base: string): Promise<string> {
  let slug = base;
  let n = 1;
  // Loop until the slug is free. Bounded by a sane cap.
  while (n < 100) {
    const hit = await db.prepare('SELECT 1 AS one FROM workshops WHERE slug = ?').bind(slug).first();
    if (!hit) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

// ── Registrations ─────────────────────────────────────────────────────────

export async function getRegistrationById(db: D1Database, id: number) {
  return db.prepare('SELECT * FROM workshop_registrations WHERE id = ?').bind(id).first<WorkshopRegistration>();
}

export async function getRegistrationByWorkshopEmail(db: D1Database, workshopId: number, email: string) {
  return db
    .prepare('SELECT * FROM workshop_registrations WHERE workshop_id = ? AND lower(email) = lower(?)')
    .bind(workshopId, email)
    .first<WorkshopRegistration>();
}

// Upsert by (workshop_id, email), case-insensitive. Returns the row id.
export async function upsertRegistration(
  db: D1Database,
  data: {
    workshop_id: number;
    name: string | null;
    email: string;
    phone: string | null;
    country: string | null;
    currency: string | null;
    timezone: string | null;
    wants_bump: boolean;
    source_tag: string | null;
    payment_status?: WorkshopRegistration['payment_status'];
  },
): Promise<number> {
  const email = data.email.toLowerCase();
  const existing = await getRegistrationByWorkshopEmail(db, data.workshop_id, email);
  if (existing) {
    await db
      .prepare(
        `UPDATE workshop_registrations SET
           name = COALESCE(?, name), phone = COALESCE(?, phone), country = COALESCE(?, country),
           currency = COALESCE(?, currency), timezone = COALESCE(?, timezone),
           wants_bump = ?, source_tag = COALESCE(?, source_tag),
           payment_status = COALESCE(?, payment_status),
           updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(
        data.name, data.phone, data.country, data.currency, data.timezone,
        data.wants_bump ? 1 : 0, data.source_tag, data.payment_status ?? null, existing.id,
      )
      .run();
    return existing.id;
  }
  const r = await db
    .prepare(
      `INSERT INTO workshop_registrations
         (workshop_id, name, email, phone, country, currency, timezone, wants_bump, source_tag, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      data.workshop_id, data.name, email, data.phone, data.country, data.currency,
      data.timezone, data.wants_bump ? 1 : 0, data.source_tag, data.payment_status ?? 'prepared',
    )
    .first<{ id: number }>();
  if (!r) throw new Error('Failed to create registration');
  return r.id;
}

export async function setRegistrationPaymentStatus(
  db: D1Database,
  id: number,
  status: WorkshopRegistration['payment_status'],
) {
  await db
    .prepare("UPDATE workshop_registrations SET payment_status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, id)
    .run();
}

export async function markJoined(db: D1Database, id: number) {
  await db
    .prepare(
      `UPDATE workshop_registrations
         SET attendance_status = 'attended', joined_at_utc = COALESCE(joined_at_utc, datetime('now')),
             updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(id)
    .run();
}

export async function setAttendance(
  db: D1Database,
  id: number,
  status: WorkshopRegistration['attendance_status'],
) {
  await db
    .prepare("UPDATE workshop_registrations SET attendance_status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, id)
    .run();
}

export type RegistrationListRow = WorkshopRegistration & {
  amount_minor: number | null;
  pay_currency: string | null;
  settlement_amount_minor: number | null;
  has_bump: boolean;
  bought_12w: boolean;
  bought_cert: boolean;
};

// Registrant list for the admin, enriched with the paid amount and derived
// course-purchase flags (matched by email across the whole engine, so a
// course bought through any workshop checkout attributes back to the person).
export async function listRegistrationsForWorkshop(
  db: D1Database,
  workshopId: number,
): Promise<RegistrationListRow[]> {
  const regRes = await db
    .prepare('SELECT * FROM workshop_registrations WHERE workshop_id = ? ORDER BY created_at DESC')
    .bind(workshopId)
    .all<WorkshopRegistration>();
  const regs = regRes.results ?? [];
  if (!regs.length) return [];

  // Latest paid payment per registration.
  const ids = regs.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');
  const payRes = await db
    .prepare(
      `SELECT registration_id, amount_minor, currency AS pay_currency, settlement_amount_minor
         FROM workshop_payments
        WHERE registration_id IN (${ph}) AND status = 'paid'`,
    )
    .bind(...ids)
    .all<{ registration_id: number; amount_minor: number; pay_currency: string; settlement_amount_minor: number | null }>();
  const payByReg = new Map<number, { amount_minor: number; pay_currency: string; settlement_amount_minor: number | null }>();
  for (const p of payRes.results ?? []) payByReg.set(p.registration_id, p);

  // Emails that bought each course product (engine-wide, by email).
  const courseRes = await db
    .prepare(
      `SELECT lower(r.email) AS email, prod.slug AS slug
         FROM workshop_purchases pur
         JOIN workshop_registrations r ON r.id = pur.registration_id
         JOIN workshop_products prod ON prod.id = pur.product_id
        WHERE pur.product_type = 'course'`,
    )
    .all<{ email: string; slug: string }>();
  const bought12w = new Set<string>();
  const boughtCert = new Set<string>();
  for (const c of courseRes.results ?? []) {
    if (c.slug === '12w-course') bought12w.add(c.email);
    if (c.slug === 'cert-course') boughtCert.add(c.email);
  }

  // Bump flag: either intent (wants_bump) or an actual bump purchase.
  const bumpRes = await db
    .prepare(
      `SELECT DISTINCT registration_id FROM workshop_purchases
        WHERE product_type = 'bump' AND registration_id IN (${ph})`,
    )
    .bind(...ids)
    .all<{ registration_id: number }>();
  const bumpRegs = new Set<number>((bumpRes.results ?? []).map((b) => b.registration_id));

  return regs.map((r) => {
    const pay = payByReg.get(r.id);
    const email = r.email.toLowerCase();
    return {
      ...r,
      amount_minor: pay?.amount_minor ?? null,
      pay_currency: pay?.pay_currency ?? null,
      settlement_amount_minor: pay?.settlement_amount_minor ?? null,
      has_bump: bumpRegs.has(r.id) || r.wants_bump === 1,
      bought_12w: bought12w.has(email),
      bought_cert: boughtCert.has(email),
    };
  });
}

// ── Payments & purchases ────────────────────────────────────────────────

export async function getPaymentByIntent(db: D1Database, paymentIntentId: string) {
  return db
    .prepare('SELECT * FROM workshop_payments WHERE stripe_payment_intent_id = ?')
    .bind(paymentIntentId)
    .first<WorkshopPayment>();
}

export async function upsertPayment(
  db: D1Database,
  p: {
    registration_id: number;
    stripe_session_id: string | null;
    stripe_payment_intent_id: string | null;
    stripe_charge_id?: string | null;
    balance_transaction_id?: string | null;
    status: string;
    method?: string | null;
    amount_minor: number;
    currency: string;
    settlement_amount_minor?: number | null;
    settlement_currency?: string | null;
    fx_rate?: number | null;
    tax_rate?: number | null;
    tax_country?: string | null;
    subtotal_minor?: number | null;
    tax_minor?: number | null;
    raw_event?: unknown;
  },
): Promise<number> {
  const existing = p.stripe_payment_intent_id
    ? await getPaymentByIntent(db, p.stripe_payment_intent_id)
    : null;
  if (existing) {
    await db
      .prepare(
        `UPDATE workshop_payments SET
           status = ?, method = COALESCE(?, method), stripe_charge_id = COALESCE(?, stripe_charge_id),
           balance_transaction_id = COALESCE(?, balance_transaction_id),
           settlement_amount_minor = COALESCE(?, settlement_amount_minor),
           settlement_currency = COALESCE(?, settlement_currency), fx_rate = COALESCE(?, fx_rate),
           tax_rate = COALESCE(?, tax_rate), tax_country = COALESCE(?, tax_country),
           subtotal_minor = COALESCE(?, subtotal_minor), tax_minor = COALESCE(?, tax_minor),
           updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(
        p.status, p.method ?? null, p.stripe_charge_id ?? null, p.balance_transaction_id ?? null,
        p.settlement_amount_minor ?? null, p.settlement_currency ?? null, p.fx_rate ?? null,
        p.tax_rate ?? null, p.tax_country ?? null, p.subtotal_minor ?? null, p.tax_minor ?? null,
        existing.id,
      )
      .run();
    return existing.id;
  }
  const r = await db
    .prepare(
      `INSERT INTO workshop_payments
        (registration_id, stripe_session_id, stripe_payment_intent_id, stripe_charge_id,
         balance_transaction_id, status, method, amount_minor, currency,
         settlement_amount_minor, settlement_currency, fx_rate,
         tax_rate, tax_country, subtotal_minor, tax_minor, raw_event)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      p.registration_id, p.stripe_session_id, p.stripe_payment_intent_id, p.stripe_charge_id ?? null,
      p.balance_transaction_id ?? null, p.status, p.method ?? null, p.amount_minor, p.currency,
      p.settlement_amount_minor ?? null, p.settlement_currency ?? null, p.fx_rate ?? null,
      p.tax_rate ?? null, p.tax_country ?? null, p.subtotal_minor ?? null, p.tax_minor ?? null,
      p.raw_event ? JSON.stringify(p.raw_event) : null,
    )
    .first<{ id: number }>();
  if (!r) throw new Error('Failed to upsert payment');
  return r.id;
}

export async function setPaymentStatusByIntent(db: D1Database, paymentIntentId: string, status: string) {
  await db
    .prepare("UPDATE workshop_payments SET status = ?, updated_at = datetime('now') WHERE stripe_payment_intent_id = ?")
    .bind(status, paymentIntentId)
    .run();
}

export async function insertPurchase(
  db: D1Database,
  data: {
    registration_id: number | null;
    payment_id: number | null;
    product_id: number;
    product_type: string;
    amount_minor: number;
    currency: string;
  },
) {
  await db
    .prepare(
      `INSERT INTO workshop_purchases
         (registration_id, payment_id, product_id, product_type, amount_minor, currency)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.registration_id, data.payment_id, data.product_id,
      data.product_type, data.amount_minor, data.currency,
    )
    .run();
}

// Have we already recorded purchases for this payment? Guards the webhook
// against inserting duplicate line items on a re-delivered event.
export async function purchasesExistForPayment(db: D1Database, paymentId: number): Promise<boolean> {
  const r = await db
    .prepare('SELECT 1 AS one FROM workshop_purchases WHERE payment_id = ?')
    .bind(paymentId)
    .first<{ one: number }>();
  return !!r;
}

// ── Notifications (idempotent) ──────────────────────────────────────────

export async function notificationExists(db: D1Database, registrationId: number, type: string) {
  const r = await db
    .prepare('SELECT 1 AS one FROM workshop_sent_notifications WHERE registration_id = ? AND type = ?')
    .bind(registrationId, type)
    .first<{ one: number }>();
  return !!r;
}

// Atomically claim a notification slot. Returns true if THIS call inserted the
// row (so the caller should send), false if it already existed.
export async function claimNotification(db: D1Database, registrationId: number, type: string): Promise<boolean> {
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO workshop_sent_notifications (registration_id, type) VALUES (?, ?)`,
    )
    .bind(registrationId, type)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

// ── Config / Zoom ─────────────────────────────────────────────────────────

export async function getConfig(db: D1Database, key: string): Promise<string | null> {
  const r = await db.prepare('SELECT value FROM workshop_config WHERE key = ?').bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

export async function setConfig(db: D1Database, key: string, value: string) {
  await db
    .prepare('INSERT INTO workshop_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

export async function deleteConfig(db: D1Database, key: string) {
  await db.prepare('DELETE FROM workshop_config WHERE key = ?').bind(key).run();
}

// Resolution order: workshop.zoom_url → zoom_url_<teacher> → zoom_url_default.
export async function resolveZoomUrl(db: D1Database, workshop: Workshop): Promise<string | null> {
  if (workshop.zoom_url) return workshop.zoom_url;
  if (workshop.teacher) {
    const byTeacher = await getConfig(db, `zoom_url_${workshop.teacher.toLowerCase()}`);
    if (byTeacher) return byTeacher;
  }
  return getConfig(db, 'zoom_url_default');
}

// ── Verification codes ──────────────────────────────────────────────────

export async function setVerificationCode(db: D1Database, email: string, code: string, ttlMinutes = 15) {
  const expires = new Date(Date.now() + ttlMinutes * 60000).toISOString();
  await db
    .prepare(
      `INSERT INTO workshop_verification_codes (email, code, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at`,
    )
    .bind(email.toLowerCase(), code, expires)
    .run();
}

export async function checkVerificationCode(db: D1Database, email: string, code: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT code, expires_at FROM workshop_verification_codes WHERE email = ?')
    .bind(email.toLowerCase())
    .first<{ code: string; expires_at: string }>();
  if (!row) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  return row.code === code;
}

// ── Ad spend ──────────────────────────────────────────────────────────────

export async function upsertAdSpend(
  db: D1Database,
  row: { spend_date: string; channel: string; campaign: string; amount_minor: number; currency: string; amount_eur_minor: number | null },
) {
  await db
    .prepare(
      `INSERT INTO workshop_ad_spend (spend_date, channel, campaign, amount_minor, currency, amount_eur_minor)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(spend_date, channel, campaign) DO UPDATE SET
         amount_minor = excluded.amount_minor, currency = excluded.currency,
         amount_eur_minor = excluded.amount_eur_minor`,
    )
    .bind(row.spend_date, row.channel, row.campaign, row.amount_minor, row.currency, row.amount_eur_minor)
    .run();
}
