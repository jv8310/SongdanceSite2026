// Data layer for the workshop engine. Raw prepared statements against D1,
// matching the style of src/lib/registrations/db.ts. All tables are
// `workshop_`-prefixed (see migrations/0021_workshops.sql).

import { BASE_CURRENCY } from './currency';
import { selectByIdsChunked } from '../db/chunked';

export type WorkshopProduct = {
  id: number;
  slug: string;
  name: string;
  type: 'ticket' | 'bump' | 'course';
  tax_code: string;
  active: number;
  drip_tag: string | null;
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
  zoom_meeting_id: string | null;
  zoom_passcode: string | null;
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
  company_name: string | null;
  vat_number: string | null;
  wants_bump: number;
  attendance_status: 'registered' | 'attended' | 'no_show';
  joined_at_utc: string | null;
  payment_status: 'prepared' | 'paid' | 'coupon' | 'refunded' | 'chargeback' | 'failed';
  source_tag: string | null;
  audience: string | null; // door-set chosen on the page: "3", "1,3", … (3 = pro)
  signup_page: string | null; // page the checkout started on (migration 0083)
  access_token: string; // unguessable token used in all user-facing links
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
  // PayPal counterparts (see migration 0049).
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
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

// A published workshop joined with its main product's slug/name, so callers
// (e.g. the /workshop landing-page calendar) can classify an entry — a regular
// €22 workshop vs. the €44 masterclass — without a second query per row.
export type UpcomingWorkshop = Workshop & {
  product_slug: string | null;
  product_name: string | null;
};

// Upcoming published workshops: replays always count; timed ones count while
// they haven't ended yet (using ends_at_utc, or starts_at_utc when null).
// Soonest first, with on-demand replays last.
export async function listUpcomingPublishedWorkshops(
  db: D1Database,
  nowIso: string,
): Promise<UpcomingWorkshop[]> {
  const r = await db
    .prepare(
      `SELECT w.*, p.slug AS product_slug, p.name AS product_name
         FROM workshops w
         LEFT JOIN workshop_products p ON p.id = w.main_product_id
        WHERE w.status = 'published' AND w.deleted = 0
          AND (
            w.is_replay = 1
            OR (w.ends_at_utc IS NOT NULL AND w.ends_at_utc >= ?)
            OR (w.ends_at_utc IS NULL AND w.starts_at_utc >= ?)
          )
        ORDER BY w.is_replay ASC, w.starts_at_utc ASC`,
    )
    .bind(nowIso, nowIso)
    .all<UpcomingWorkshop>();
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
  zoom_meeting_id: string | null;
  zoom_passcode: string | null;
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
         zoom_meeting_id, zoom_passcode,
         main_product_id, bump_product_id, free_coupon, source_tag, status, is_replay)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      input.slug, input.title, input.teacher, input.starts_at_utc, input.ends_at_utc,
      input.display_tz, input.zoom_url, input.zoom_meeting_id, input.zoom_passcode,
      input.main_product_id, input.bump_product_id,
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
         display_tz = ?, zoom_url = ?, zoom_meeting_id = ?, zoom_passcode = ?,
         main_product_id = ?, bump_product_id = ?,
         free_coupon = ?, source_tag = ?, status = ?, is_replay = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(
      input.slug, input.title, input.teacher, input.starts_at_utc, input.ends_at_utc,
      input.display_tz, input.zoom_url, input.zoom_meeting_id, input.zoom_passcode,
      input.main_product_id, input.bump_product_id,
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

// Has a Google Calendar event already been synced into a workshop? Used by the
// calendar sync to skip events that exist (we never re-touch them).
export async function googleEventExists(db: D1Database, googleEventId: string): Promise<boolean> {
  const hit = await db
    .prepare('SELECT 1 AS one FROM workshops WHERE google_event_id = ?')
    .bind(googleEventId)
    .first();
  return !!hit;
}

// Create a workshop from a mapped calendar-sync event: assigns the ticket (and
// optional bump) product, source tag and status, keyed on google_event_id so a
// later sync recognises it as already present (and skips it). Returns the id.
export async function createSyncedWorkshop(
  db: D1Database,
  ev: {
    googleEventId: string;
    title: string;
    teacher: string | null;
    startsAtUtc: string;
    endsAtUtc: string | null;
    displayTz: string;
    mainProductId: number | null;
    bumpProductId: number | null;
    sourceTag: string | null;
    status: 'draft' | 'published' | 'cancelled';
  },
): Promise<number> {
  const slug = await uniqueSlug(db, slugify(ev.title));
  const r = await db
    .prepare(
      `INSERT INTO workshops
        (slug, title, teacher, starts_at_utc, ends_at_utc, display_tz,
         main_product_id, bump_product_id, source_tag, google_event_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      slug, ev.title, ev.teacher, ev.startsAtUtc, ev.endsAtUtc, ev.displayTz,
      ev.mainProductId, ev.bumpProductId, ev.sourceTag, ev.googleEventId, ev.status,
    )
    .first<{ id: number }>();
  if (!r) throw new Error('Failed to create workshop from calendar sync');
  return r.id;
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

// Unguessable per-registration token. It stands in for the row id in every
// user-facing link (success / join / ics / replay), so those URLs can't be
// enumerated. 128 bits of randomness as lowercase hex.
export function newAccessToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getRegistrationByAccessToken(db: D1Database, token: string) {
  return db
    .prepare('SELECT * FROM workshop_registrations WHERE access_token = ?')
    .bind(token)
    .first<WorkshopRegistration>();
}

export async function getRegistrationByWorkshopEmail(db: D1Database, workshopId: number, email: string) {
  return db
    .prepare('SELECT * FROM workshop_registrations WHERE workshop_id = ? AND lower(email) = lower(?)')
    .bind(workshopId, email)
    .first<WorkshopRegistration>();
}

export type WorkshopLinkForEmail = {
  starts_at_utc: string;
  ends_at_utc: string | null;
  country: string | null;
  name: string | null;
  // Door-set chosen on the workshop page ("3", "1,3"); 3 = pro (practitioner).
  audience: string | null;
  // 1 when the workshop's main product is a masterclass (a "pro" signal).
  is_masterclass: number;
};

// Every workshop an email holds a *secured* seat for (paid or comped), newest
// workshop first. Used by the 12-week course to auto-apply the workshop-
// attendee discount: a future workshop keeps the discount live (pre-workshop),
// and a just-passed one keeps it live for a short window after. Only seats that
// were actually secured count — abandoned/failed checkouts are excluded.
//
// Also carries the chosen audience doors + a masterclass flag so callers can
// decide whether the email belongs to a "pro" (practitioner) — see
// `emailIsProFromLinks`.
export async function listSecuredWorkshopLinksByEmail(
  db: D1Database,
  email: string,
): Promise<WorkshopLinkForEmail[]> {
  const r = await db
    .prepare(
      `SELECT w.starts_at_utc, w.ends_at_utc, r.country, r.name, r.audience,
              CASE WHEN p.slug LIKE '%masterclass%' THEN 1 ELSE 0 END AS is_masterclass
         FROM workshop_registrations r
         JOIN workshops w ON w.id = r.workshop_id
         LEFT JOIN workshop_products p ON p.id = w.main_product_id
        WHERE lower(r.email) = lower(?)
          AND w.deleted = 0
          AND r.payment_status IN ('paid', 'coupon')
        ORDER BY w.starts_at_utc DESC`,
    )
    .bind(email)
    .all<WorkshopLinkForEmail>();
  return r.results ?? [];
}

export type CountdownLinkForEmail = {
  // The per-registration token that stands in for the row id in the countdown
  // (success) URL — `/workshop/success?t=<access_token>`.
  access_token: string;
  title: string;
  slug: string;
  starts_at_utc: string;
  is_replay: number;
  is_masterclass: number;
  // The registrant's own IANA timezone (may be null → the workshop's display tz
  // is used to format the local start time).
  timezone: string | null;
  display_tz: string;
};

// Every *secured* (paid or comped) workshop/masterclass seat an email holds,
// with the token needed to deep-link into that registration's countdown page.
// Powers the pre-purchase account lookup on /access: someone who registered for
// a live session can jump straight to its countdown. Soonest first.
export async function listCountdownLinksByEmail(
  db: D1Database,
  email: string,
): Promise<CountdownLinkForEmail[]> {
  const r = await db
    .prepare(
      `SELECT r.access_token, r.timezone, w.title, w.slug, w.starts_at_utc,
              w.display_tz, w.is_replay,
              CASE WHEN p.slug LIKE '%masterclass%' THEN 1 ELSE 0 END AS is_masterclass
         FROM workshop_registrations r
         JOIN workshops w ON w.id = r.workshop_id
         LEFT JOIN workshop_products p ON p.id = w.main_product_id
        WHERE lower(r.email) = lower(?)
          AND w.deleted = 0
          AND w.status = 'published'
          AND r.payment_status IN ('paid', 'coupon')
        ORDER BY w.starts_at_utc ASC`,
    )
    .bind(email)
    .all<CountdownLinkForEmail>();
  return r.results ?? [];
}

// "Pro" intent expressed in a chosen door-set: door 3 is the practitioner door.
// The single source of truth for reading the `audience` string — used by the
// 12-week page (via emailIsProFromLinks) and the post-workshop email cron, so
// "practitioner door" means the same thing in both places.
export function audienceIsPro(audience: string | null | undefined): boolean {
  return (audience ?? '')
    .split(',')
    .map((d) => d.trim())
    .includes('3');
}

// "Pro" intent expressed on any secured workshop seat: they picked the
// practitioner door (audience door 3) or it was a masterclass. This is the
// D1-only signal the 12-week page uses to reveal the certification option
// (there is no single is_pro account column yet).
export function emailIsProFromLinks(links: WorkshopLinkForEmail[]): boolean {
  return links.some((l) => l.is_masterclass === 1 || audienceIsPro(l.audience));
}

// "Pro" on one registration: a masterclass seat, the practitioner door chosen
// on a regular workshop, or — once the pending is_pro migration lands — a
// registration flagged pro (read optionally, so this stays forward-compatible
// without the column existing). The post-workshop email cron and the replay
// page's course CTA both read it, so what someone is *mailed* and where the
// replay *sends* them can't drift apart. Re-deriving it elsewhere re-opens that.
export function registrationIsPro(
  reg: Pick<WorkshopRegistration, 'audience'> & { is_pro?: number | null },
  isMasterclass: boolean,
): boolean {
  return isMasterclass || audienceIsPro(reg.audience) || reg.is_pro === 1;
}

// Epoch-ms timestamps of every replay this email has opened. Used alongside
// the workshop time so the 48h discount window also (re)starts when someone
// watches the replay. Replay views are logged as `workshop.replay.viewed`
// events keyed by `workshop-replay-<registration id>` (see workshop/replay.astro).
export async function listReplayViewAnchorsByEmail(
  db: D1Database,
  email: string,
): Promise<number[]> {
  const r = await db
    .prepare(
      `SELECT e.created_at AS created_at
         FROM events e
         JOIN workshop_registrations r
           ON ('workshop-replay-' || r.id) = e.external_id
        WHERE e.kind = 'workshop.replay.viewed'
          AND lower(r.email) = lower(?)`,
    )
    .bind(email)
    .all<{ created_at: string }>();
  const out: number[] = [];
  for (const row of r.results ?? []) {
    // D1 stores 'YYYY-MM-DD HH:MM:SS' (UTC); normalise to ISO so Date.parse
    // doesn't read it as local time.
    const raw = String(row.created_at ?? '');
    const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) out.push(ms);
  }
  return out;
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
    company_name?: string | null;
    vat_number?: string | null;
    wants_bump: boolean;
    source_tag: string | null;
    audience?: string | null;
    payment_status?: WorkshopRegistration['payment_status'];
    // Who this registration came from, when it arrived on a "share with a
    // friend" link (src/lib/workshops/share.ts). First referral on the row
    // wins — the person who actually brought them.
    referred_by_id?: number | null;
    referral_channel?: string | null;
  },
): Promise<{ id: number; token: string }> {
  const email = data.email.toLowerCase();
  const existing = await getRegistrationByWorkshopEmail(db, data.workshop_id, email);
  if (existing) {
    await db
      .prepare(
        `UPDATE workshop_registrations SET
           name = COALESCE(?, name), phone = COALESCE(?, phone), country = COALESCE(?, country),
           currency = COALESCE(?, currency), timezone = COALESCE(?, timezone),
           company_name = COALESCE(?, company_name), vat_number = COALESCE(?, vat_number),
           wants_bump = ?, source_tag = COALESCE(?, source_tag),
           audience = COALESCE(?, audience),
           payment_status = COALESCE(?, payment_status),
           referred_by_id = COALESCE(referred_by_id, ?),
           referral_channel = COALESCE(referral_channel, ?),
           updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(
        data.name, data.phone, data.country, data.currency, data.timezone,
        data.company_name ?? null, data.vat_number ?? null,
        data.wants_bump ? 1 : 0, data.source_tag, data.audience ?? null,
        data.payment_status ?? null,
        data.referred_by_id ?? null, data.referral_channel ?? null,
        existing.id,
      )
      .run();
    // Re-registering the same person keeps their existing token (so any link
    // already in their inbox/calendar stays valid). Mint one only on the off
    // chance a legacy row predates the backfill.
    let token = existing.access_token;
    if (!token) {
      token = newAccessToken();
      await db
        .prepare('UPDATE workshop_registrations SET access_token = ? WHERE id = ?')
        .bind(token, existing.id)
        .run();
    }
    return { id: existing.id, token };
  }
  const token = newAccessToken();
  const r = await db
    .prepare(
      `INSERT INTO workshop_registrations
         (workshop_id, name, email, phone, country, currency, timezone,
          company_name, vat_number, wants_bump, source_tag, audience, payment_status, access_token,
          referred_by_id, referral_channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      data.workshop_id, data.name, email, data.phone, data.country, data.currency,
      data.timezone, data.company_name ?? null, data.vat_number ?? null,
      data.wants_bump ? 1 : 0, data.source_tag, data.audience ?? null,
      data.payment_status ?? 'prepared', token,
      data.referred_by_id ?? null, data.referral_channel ?? null,
    )
    .first<{ id: number }>();
  if (!r) throw new Error('Failed to create registration');
  return { id: r.id, token };
}

// Which page the checkout was started on ("masterclass", "workshop", "w"),
// normalized by signup-page.ts. Written on its own, after the row exists, and
// deliberately best-effort: this is analytics, and it must never be the reason
// a seat can't be booked — a preview deploy runs against the live database
// before migration 0083 has been applied there, and a checkout that 500s over
// a reporting column would be a far worse bug than a missing data point.
//
// The first page recorded on a row wins, so re-registering never rewrites
// where the person actually came from.
export async function recordSignupPage(db: D1Database, id: number, page: string | null) {
  if (!page) return;
  try {
    await db
      .prepare('UPDATE workshop_registrations SET signup_page = COALESCE(signup_page, ?) WHERE id = ?')
      .bind(page, id)
      .run();
  } catch {
    // Column not there yet (or D1 hiccuped) — nothing downstream depends on it.
  }
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

// Move an existing (secured) registration onto a different workshop date — the
// countdown-page "change my date", chosen *before* the session. Unlike the
// post-miss free rebook (which comps a brand-new seat and leaves the original
// paid row on the past date for accounting), here the single seat travels: this
// same row — its access token, payment and Drip identity — is repointed at the
// target, attendance is reset, and its reminder/confirmation claims are cleared
// so the new date gets a fresh confirmation and its own clean cadence while the
// old date stops reminding (and counting) them.
//
// Refuses to collide with an existing seat: if this email already holds a
// separate registration on the target date, nothing moves — that seat's token
// is returned (when it's a real secured seat) so the caller can point them there
// instead of merging or stealing rows.
export async function moveRegistrationToWorkshop(
  db: D1Database,
  registrationId: number,
  targetWorkshopId: number,
): Promise<
  | { ok: true; token: string }
  | { ok: false; reason: 'not_found' | 'already_on_target'; token?: string }
> {
  const reg = await getRegistrationById(db, registrationId);
  if (!reg) return { ok: false, reason: 'not_found' };
  // Already there — a no-op success on the same token (e.g. a double-submit).
  if (reg.workshop_id === targetWorkshopId) return { ok: true, token: reg.access_token };

  const existing = await getRegistrationByWorkshopEmail(db, targetWorkshopId, reg.email);
  if (existing && existing.id !== registrationId) {
    const secured = existing.payment_status === 'paid' || existing.payment_status === 'coupon';
    return { ok: false, reason: 'already_on_target', token: secured ? existing.access_token : undefined };
  }

  await db
    .prepare(
      `UPDATE workshop_registrations
          SET workshop_id = ?, attendance_status = 'registered', joined_at_utc = NULL,
              updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(targetWorkshopId, registrationId)
    .run();

  // Clear the old date's reminder/confirmation claims: the sends are date-
  // specific, so the new date must get its own confirmation and reminder cadence
  // from scratch. (Pre-session there are no post-workshop claims to preserve.)
  await db
    .prepare('DELETE FROM workshop_sent_notifications WHERE registration_id = ?')
    .bind(registrationId)
    .run();

  return { ok: true, token: reg.access_token };
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

  // Latest paid payment per registration. Chunked to stay under D1's
  // 100-bound-param cap for a big workshop (>100 registrations).
  const ids = regs.map((r) => r.id);
  const payRows = await selectByIdsChunked<{
    registration_id: number;
    amount_minor: number;
    pay_currency: string;
    settlement_amount_minor: number | null;
  }>(
    db,
    ids,
    (ph) =>
      `SELECT registration_id, amount_minor, currency AS pay_currency, settlement_amount_minor
         FROM workshop_payments
        WHERE registration_id IN (${ph}) AND status = 'paid'`,
  );
  const payByReg = new Map<number, { amount_minor: number; pay_currency: string; settlement_amount_minor: number | null }>();
  for (const p of payRows) payByReg.set(p.registration_id, p);

  // Emails that bought each course product (engine-wide, by email).
  const bought12w = new Set<string>();
  const boughtCert = new Set<string>();

  // Path 1 — course bought as an upsell *inside a workshop checkout*
  // (workshop_purchases, product_type='course').
  const courseRes = await db
    .prepare(
      `SELECT lower(r.email) AS email, prod.slug AS slug
         FROM workshop_purchases pur
         JOIN workshop_registrations r ON r.id = pur.registration_id
         JOIN workshop_products prod ON prod.id = pur.product_id
        WHERE pur.product_type = 'course'`,
    )
    .all<{ email: string; slug: string }>();
  for (const c of courseRes.results ?? []) {
    if (c.slug === '12w-course') bought12w.add(c.email);
    if (c.slug === 'cert-course') boughtCert.add(c.email);
  }

  // Path 2 — course bought through the main course checkout, which lands in
  // course_registrations (where almost every 12-week / certification sale
  // actually is). Same "real sale" filter and slug grouping the stats/reports
  // use (computeCourseSales): has a payment, not pending/expired.
  const stdRes = await db
    .prepare(
      `SELECT lower(email) AS email, product_slug AS slug
         FROM course_registrations
        WHERE paid_at IS NOT NULL AND status NOT IN ('pending','expired')`,
    )
    .all<{ email: string; slug: string }>();
  for (const c of stdRes.results ?? []) {
    if (c.slug === 'svh-12week') bought12w.add(c.email);
    if (c.slug === 'cc-cert' || c.slug === 'cc-bundle') boughtCert.add(c.email);
  }

  // Bump flag: either intent (wants_bump) or an actual bump purchase.
  const bumpRows = await selectByIdsChunked<{ registration_id: number }>(
    db,
    ids,
    (ph) =>
      `SELECT DISTINCT registration_id FROM workshop_purchases
        WHERE product_type = 'bump' AND registration_id IN (${ph})`,
  );
  const bumpRegs = new Set<number>(bumpRows.map((b) => b.registration_id));

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

// The settled payment for a registration (newest first) — used to surface the
// amount actually charged, e.g. the browser-side Meta Purchase value on the
// success page. Returns null for free/coupon registrations (no payment row).
export async function getPaidPaymentForRegistration(db: D1Database, registrationId: number) {
  return db
    .prepare(
      "SELECT * FROM workshop_payments WHERE registration_id = ? AND status = 'paid' ORDER BY id DESC LIMIT 1",
    )
    .bind(registrationId)
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

// ── PayPal workshop payments (provider='paypal') ─────────────────────────

export async function getPaymentByPaypalCapture(db: D1Database, captureId: string) {
  return db
    .prepare('SELECT * FROM workshop_payments WHERE paypal_capture_id = ?')
    .bind(captureId)
    .first<WorkshopPayment>();
}

// Insert a PayPal workshop payment, deduped on the capture id (so the return
// endpoint + webhook backstop never double-insert). Returns the row id.
export async function upsertPaypalPayment(
  db: D1Database,
  p: {
    registration_id: number;
    paypal_order_id: string | null;
    paypal_capture_id: string;
    status: string;
    amount_minor: number;
    currency: string;
    // Set only when PayPal converted the charge into the holding currency —
    // the sibling of Stripe's balance transaction. Without it the stats have
    // to convert the charged amount at the fx_rates table, which is an
    // estimate; with it the EUR figure is exact.
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
  const existing = await getPaymentByPaypalCapture(db, p.paypal_capture_id);
  if (existing) {
    await db
      .prepare(
        `UPDATE workshop_payments SET
           status = ?, paypal_order_id = COALESCE(?, paypal_order_id),
           settlement_amount_minor = COALESCE(?, settlement_amount_minor),
           settlement_currency = COALESCE(?, settlement_currency),
           fx_rate = COALESCE(?, fx_rate),
           tax_rate = COALESCE(?, tax_rate), tax_country = COALESCE(?, tax_country),
           subtotal_minor = COALESCE(?, subtotal_minor), tax_minor = COALESCE(?, tax_minor),
           updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(
        p.status, p.paypal_order_id,
        p.settlement_amount_minor ?? null, p.settlement_currency ?? null, p.fx_rate ?? null,
        p.tax_rate ?? null, p.tax_country ?? null,
        p.subtotal_minor ?? null, p.tax_minor ?? null, existing.id,
      )
      .run();
    return existing.id;
  }
  const r = await db
    .prepare(
      `INSERT INTO workshop_payments
        (registration_id, provider, paypal_order_id, paypal_capture_id,
         status, method, amount_minor, currency,
         settlement_amount_minor, settlement_currency, fx_rate,
         tax_rate, tax_country, subtotal_minor, tax_minor, raw_event)
       VALUES (?, 'paypal', ?, ?, ?, 'paypal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      p.registration_id, p.paypal_order_id, p.paypal_capture_id,
      p.status, p.amount_minor, p.currency,
      p.settlement_amount_minor ?? null, p.settlement_currency ?? null, p.fx_rate ?? null,
      p.tax_rate ?? null, p.tax_country ?? null, p.subtotal_minor ?? null, p.tax_minor ?? null,
      p.raw_event ? JSON.stringify(p.raw_event) : null,
    )
    .first<{ id: number }>();
  if (!r) throw new Error('Failed to upsert PayPal payment');
  return r.id;
}

export async function setPaymentStatusByPaypalCapture(db: D1Database, captureId: string, status: string) {
  await db
    .prepare("UPDATE workshop_payments SET status = ?, updated_at = datetime('now') WHERE paypal_capture_id = ?")
    .bind(status, captureId)
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
//
// `emailed` records whether this claim is for an email we actually send
// (the default) or merely a slot reserved to suppress a later duplicate —
// e.g. the looser reminder buckets a late registrant crosses at once. The
// admin People view only counts emailed=1 rows as mail the person received.
// Falls back to the legacy column-less insert when migration 0041 (the
// `emailed` column) hasn't been applied yet — the column defaults to 1.
export async function claimNotification(
  db: D1Database,
  registrationId: number,
  type: string,
  emailed = true,
): Promise<boolean> {
  try {
    const r = await db
      .prepare(
        `INSERT OR IGNORE INTO workshop_sent_notifications (registration_id, type, emailed) VALUES (?, ?, ?)`,
      )
      .bind(registrationId, type, emailed ? 1 : 0)
      .run();
    return (r.meta?.changes ?? 0) > 0;
  } catch {
    const r = await db
      .prepare(
        `INSERT OR IGNORE INTO workshop_sent_notifications (registration_id, type) VALUES (?, ?)`,
      )
      .bind(registrationId, type)
      .run();
    return (r.meta?.changes ?? 0) > 0;
  }
}

// Release a previously-claimed notification slot (see claimNotification).
// Used when a send fails *after* the slot was claimed, so a later cron tick can
// retry it instead of the claim permanently swallowing the email. Deletes only
// the exact (registration, type) slot; safe to call for a slot that no longer
// exists. Doesn't touch the `emailed` column, so it works pre- and post-0041.
export async function releaseNotification(
  db: D1Database,
  registrationId: number,
  type: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM workshop_sent_notifications WHERE registration_id = ? AND type = ?')
    .bind(registrationId, type)
    .run();
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

// Is this workshop a masterclass? Classified by its main product slug, the same
// way the /workshop landing-page calendar tells a €22 workshop from the €44
// masterclass. Masterclasses resolve their own Zoom defaults.
export async function workshopIsMasterclass(db: D1Database, workshop: Workshop): Promise<boolean> {
  if (!workshop.main_product_id) return false;
  const product = await getProductById(db, workshop.main_product_id);
  return (product?.slug ?? '').includes('masterclass');
}

// A typed config default: masterclasses prefer the `<key>_masterclass` value and
// fall back to the general `<key>_default` when it's blank; everything else uses
// `<key>_default` directly. (Keys: zoom_url, zoom_meeting_id, zoom_passcode.)
async function resolveTypedDefault(
  db: D1Database,
  isMasterclass: boolean,
  baseKey: string,
): Promise<string | null> {
  if (isMasterclass) {
    const masterclass = await getConfig(db, `${baseKey}_masterclass`);
    if (masterclass) return masterclass;
  }
  return getConfig(db, `${baseKey}_default`);
}

// Resolution order: workshop.zoom_url → zoom_url_<teacher> → typed default
// (zoom_url_masterclass for masterclasses, else zoom_url_default).
export async function resolveZoomUrl(
  db: D1Database,
  workshop: Workshop,
  isMasterclass: boolean,
): Promise<string | null> {
  if (workshop.zoom_url) return workshop.zoom_url;
  if (workshop.teacher) {
    const byTeacher = await getConfig(db, `zoom_url_${workshop.teacher.toLowerCase()}`);
    if (byTeacher) return byTeacher;
  }
  return resolveTypedDefault(db, isMasterclass, 'zoom_url');
}

// The full Zoom details for the "the button doesn't work for me" fallback:
// the join URL plus the raw meeting id + passcode some older clients need.
// Each falls back to its typed config default when not set on the workshop.
export async function resolveZoomDetails(
  db: D1Database,
  workshop: Workshop,
): Promise<{ url: string | null; meetingId: string | null; passcode: string | null }> {
  const isMasterclass = await workshopIsMasterclass(db, workshop);
  const url = await resolveZoomUrl(db, workshop, isMasterclass);
  const meetingId = workshop.zoom_meeting_id ?? (await resolveTypedDefault(db, isMasterclass, 'zoom_meeting_id'));
  const passcode = workshop.zoom_passcode ?? (await resolveTypedDefault(db, isMasterclass, 'zoom_passcode'));
  return { url, meetingId, passcode };
}

// The fixed replay video for a workshop, resolved per type: a masterclass
// prefers `replay_video_url_masterclass` and falls back to the workshop replay
// (`replay_video_url`) when that's blank; everything else uses the workshop
// replay. Mirrors the Zoom typed-default resolution — one video per event type,
// with the masterclass free to point elsewhere. Returns null when nothing is set.
export async function resolveReplayUrl(db: D1Database, workshop: Workshop): Promise<string | null> {
  if (await workshopIsMasterclass(db, workshop)) {
    const masterclass = await getConfig(db, 'replay_video_url_masterclass');
    if (masterclass) return masterclass;
  }
  return getConfig(db, 'replay_video_url');
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

// Replace the Meta channel's spend for a date window in one atomic batch: clear
// every existing meta row in [from, to] — any campaign, since the CSV importer
// may have left blank- or per-campaign rows there — then insert the freshly
// pulled per-campaign day rows. Making Meta authoritative for its own channel
// inside the sync window means the direct pull (src/lib/ads/meta-insights.ts)
// can never double-count against a stale CSV import, and a (day, campaign) Meta
// reports as zero-spend correctly clears. Only call this AFTER a successful
// Insights fetch — an empty `rows` from a failed fetch would otherwise wipe real
// data.
export async function replaceMetaAdSpend(
  db: D1Database,
  window: { from: string; to: string },
  rows: Array<{ spend_date: string; campaign: string; amount_minor: number; currency: string; amount_eur_minor: number | null }>,
): Promise<void> {
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `DELETE FROM workshop_ad_spend
          WHERE channel = 'meta' AND spend_date >= ? AND spend_date <= ?`,
      )
      .bind(window.from, window.to),
  ];
  for (const r of rows) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO workshop_ad_spend (spend_date, channel, campaign, amount_minor, currency, amount_eur_minor)
           VALUES (?, 'meta', ?, ?, ?, ?)`,
        )
        .bind(r.spend_date, r.campaign, r.amount_minor, r.currency, r.amount_eur_minor),
    );
  }
  await db.batch(stmts);
}
