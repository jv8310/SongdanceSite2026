// Per-order detail for the /admin/orders/[order] page. The orders list
// (orders.ts → UnifiedOrder) is deliberately one row per order — it can't carry
// the long tail of per-order facts Jacob sometimes needs: the coupon / discount
// that brought the price down, the line-item breakdown (ticket + bump, course +
// add-ons), the gateway/charge ids, tax split, and the buyer's contact details.
//
// This module re-uses listAllOrders() for the money-exact UnifiedOrder summary
// (so a figure here always matches the list), then enriches that single order
// with the extra columns + the audit-log discount trail from its source table.
//
// Coupons/discounts are NOT stored as a literal "code" column on most orders:
//   • Workshops/courses discount via URL percentages (?discount / ?adiscount),
//     recorded as discount_pct/discount_percent in the checkout `events` rows.
//   • The one real coupon is a workshop's free_coupon → payment_status='coupon'.
//   • Retreats discount only via the cook-help role (role_discount_cents).
// We surface whichever applies as a single human-readable note.

import { formatMoney } from '../workshops/currency';
import {
  listAllOrders,
  parseOrderNo,
  type OrderMoneyOpts,
  type UnifiedOrder,
} from './orders';

// A labelled value rendered as a row in a detail card. `mono` for ids/codes;
// `href` turns the value into a link.
export type DetailField = {
  label: string;
  value: string;
  mono?: boolean;
  href?: string;
};

// A line in the price breakdown (already money-formatted).
export type DetailLine = { label: string; amount: string; note?: string };

export type OrderDetail = {
  order: UnifiedOrder;
  // Headline coupon / discount summary, or null when the order paid full price.
  couponNote: string | null;
  lineItems: DetailLine[];
  customer: DetailField[];
  payment: DetailField[];
  // Source-specific extras (dates, plan, attendance, room, …).
  extra: DetailField[];
  // Workshops only: the site-relative path to the registrant's personal
  // countdown / join page (`/workshop/success?t=<access_token>`). Null for
  // courses/retreats (they have no such page). The admin page prefixes the base
  // URL to make it shareable.
  countdownPath: string | null;
};

// Drop empty fields so a card never shows "Phone: —" for data we don't have.
function fields(rows: Array<DetailField | null | undefined>): DetailField[] {
  return rows.filter((r): r is DetailField => !!r && r.value.trim() !== '');
}

function field(
  label: string,
  value: string | number | null | undefined,
  opts: { mono?: boolean; href?: string } = {},
): DetailField | null {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  return { label, value: v, ...opts };
}

// D1 stores 'YYYY-MM-DD HH:MM:SS' in UTC; normalise to a readable UTC stamp.
function fmtTs(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const raw = String(ts).trim();
  if (!raw) return null;
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function yesNo(v: number | null | undefined): string {
  return v ? 'Yes' : 'No';
}

// ── Public entry ────────────────────────────────────────────────────────────

export async function getOrderDetail(
  db: D1Database,
  orderNo: string,
  money: OrderMoneyOpts = {},
): Promise<OrderDetail | null> {
  const parsed = parseOrderNo(orderNo);
  if (!parsed) return null;

  const all = await listAllOrders(db, {}, money);
  const order = all.find(
    (o) => o.source === parsed.source && o.rowId === parsed.id,
  );
  if (!order) return null;

  switch (parsed.source) {
    case 'workshop':
      return enrichWorkshop(db, order, parsed.id);
    case 'course':
      return enrichCourse(db, order, parsed.id);
    case 'retreat':
      return enrichRetreat(db, order, parsed.id);
  }
}

// Pull a discount percentage out of one of an order's checkout `events` rows.
async function discountPctFromEvents(
  db: D1Database,
  externalIds: string[],
  key: 'discount_pct' | 'discount_percent',
): Promise<{ pct: number; kind: string | null }> {
  const ids = externalIds.filter(Boolean);
  if (!ids.length) return { pct: 0, kind: null };
  const ph = ids.map(() => '?').join(',');
  const res = await db
    .prepare(`SELECT payload_json FROM events WHERE external_id IN (${ph})`)
    .bind(...ids)
    .all<{ payload_json: string | null }>();
  let pct = 0;
  let kind: string | null = null;
  for (const row of res.results ?? []) {
    try {
      const p = JSON.parse(row.payload_json ?? '{}');
      const n = Number(p[key]);
      if (Number.isFinite(n) && n > pct) pct = n;
      if (typeof p.discount_kind === 'string' && p.discount_kind) {
        kind = p.discount_kind;
      }
    } catch {
      /* ignore malformed payloads */
    }
  }
  return { pct, kind };
}

// ── Workshops ────────────────────────────────────────────────────────────

type WReg = {
  name: string | null;
  email: string;
  access_token: string | null;
  phone: string | null;
  country: string | null;
  currency: string | null;
  timezone: string | null;
  locale: string | null;
  company_name: string | null;
  vat_number: string | null;
  wants_bump: number;
  attendance_status: string;
  joined_at_utc: string | null;
  payment_status: string;
  source_tag: string | null;
  audience: string | null;
  created_at: string;
  workshop_title: string | null;
  starts_at_utc: string | null;
  free_coupon: string | null;
};

type WPay = {
  provider: string | null;
  method: string | null;
  status: string;
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
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
};

async function enrichWorkshop(
  db: D1Database,
  order: UnifiedOrder,
  id: number,
): Promise<OrderDetail> {
  const reg = await db
    .prepare(
      `SELECT r.name, r.email, r.access_token, r.phone, r.country, r.currency, r.timezone, r.locale,
              r.company_name, r.vat_number, r.wants_bump, r.attendance_status,
              r.joined_at_utc, r.payment_status, r.source_tag, r.audience, r.created_at,
              w.title AS workshop_title, w.starts_at_utc, w.free_coupon
         FROM workshop_registrations r
         LEFT JOIN workshops w ON w.id = r.workshop_id
        WHERE r.id = ?`,
    )
    .bind(id)
    .first<WReg>();

  const pay = await db
    .prepare(
      `SELECT provider, method, status, amount_minor, currency,
              settlement_amount_minor, settlement_currency, fx_rate,
              tax_rate, tax_country, subtotal_minor, tax_minor,
              quaderno_invoice_id, quaderno_invoice_number,
              stripe_payment_intent_id, stripe_charge_id,
              paypal_order_id, paypal_capture_id
         FROM workshop_payments
        WHERE registration_id = ? AND status IN ('paid','refunded')
        ORDER BY id DESC LIMIT 1`,
    )
    .bind(id)
    .first<WPay>();

  const purRes = await db
    .prepare(
      `SELECT pur.product_type, pur.amount_minor, pur.currency, prod.name AS product_name
         FROM workshop_purchases pur
         LEFT JOIN workshop_products prod ON prod.id = pur.product_id
        WHERE pur.registration_id = ?
        ORDER BY pur.id`,
    )
    .bind(id)
    .all<{ product_type: string; amount_minor: number; currency: string; product_name: string | null }>();
  const purchases = purRes.results ?? [];

  // Coupon / discount note.
  const { pct } = await discountPctFromEvents(
    db,
    [`workshop-checkout-${id}`, `workshop-checkout-pp-${id}`],
    'discount_pct',
  );
  let couponNote: string | null = null;
  if (reg?.payment_status === 'coupon') {
    couponNote = reg.free_coupon
      ? `Free coupon redeemed — code “${reg.free_coupon}”`
      : 'Free coupon redeemed';
  } else if (pct > 0) {
    couponNote = `${pct}% ticket discount applied`;
  }

  // Line items: the recorded purchases, else fall back to the charged total.
  const lineItems: DetailLine[] = [];
  for (const p of purchases) {
    const label =
      p.product_name ??
      (p.product_type === 'bump'
        ? 'Order bump'
        : p.product_type === 'ticket'
          ? 'Workshop ticket'
          : p.product_type);
    lineItems.push({ label, amount: formatMoney(p.amount_minor, p.currency) });
  }
  if (!lineItems.length) {
    if (reg?.payment_status === 'coupon') {
      lineItems.push({ label: 'Workshop ticket', amount: 'Free (coupon)' });
    } else if (order.originalAmountMinor > 0) {
      lineItems.push({
        label: 'Workshop ticket',
        amount: formatMoney(order.originalAmountMinor, order.originalCurrency),
      });
    }
  }
  const customer = fields([
    field('Phone', reg?.phone),
    field('Country', reg?.country),
    field('Currency', reg?.currency),
    field('Timezone', reg?.timezone),
    field('Locale', reg?.locale),
    field('Company', reg?.company_name),
    field('VAT number', reg?.vat_number, { mono: true }),
    field(
      'Audience doors',
      reg?.audience
        ? reg.audience + (reg.audience.split(',').includes('3') ? ' (pro)' : '')
        : null,
    ),
    field('Source tag', reg?.source_tag, { mono: true }),
  ]);

  const settlement =
    pay?.settlement_amount_minor != null && pay?.settlement_currency
      ? `${formatMoney(pay.settlement_amount_minor, pay.settlement_currency)}${
          pay.fx_rate ? ` @ ${pay.fx_rate}` : ''
        }`
      : null;

  const taxValue =
    pay?.tax_minor != null
      ? `${formatMoney(pay.tax_minor, pay.currency)}${pay.tax_country ? ` · ${pay.tax_country}` : ''}${
          pay.tax_rate != null ? ` · ${Math.round(pay.tax_rate * 100)}%` : ''
        }`
      : null;

  const payment = fields([
    field('Gateway', order.provider === 'paypal' ? 'PayPal' : 'Stripe'),
    field('Method', pay?.method),
    field('Payment status', pay?.status ?? reg?.payment_status),
    field(
      'Subtotal (excl. tax)',
      pay?.subtotal_minor != null ? formatMoney(pay.subtotal_minor, pay.currency) : null,
    ),
    field('Tax', taxValue),
    field('Settlement', settlement),
    field('Stripe PaymentIntent', pay?.stripe_payment_intent_id, { mono: true }),
    field('Stripe charge', pay?.stripe_charge_id, { mono: true }),
    field('PayPal order', pay?.paypal_order_id, { mono: true }),
    field('PayPal capture', pay?.paypal_capture_id, { mono: true }),
    field('Quaderno invoice', pay?.quaderno_invoice_number ?? pay?.quaderno_invoice_id, {
      mono: true,
    }),
  ]);

  const extra = fields([
    field('Workshop date', fmtTs(reg?.starts_at_utc)),
    field('Attendance', reg?.attendance_status),
    field('Joined at', fmtTs(reg?.joined_at_utc)),
    field('Wants bump', yesNo(reg?.wants_bump)),
    field('Registered', fmtTs(reg?.created_at ?? order.createdAt)),
  ]);

  // The registrant's personal countdown / join page — the same link the
  // confirmation + reminder emails carry, so the admin can re-share it.
  const countdownPath = reg?.access_token
    ? `/workshop/success?t=${reg.access_token}`
    : null;

  return { order, couponNote, lineItems, customer, payment, extra, countdownPath };
}

// ── Courses ────────────────────────────────────────────────────────────────

type CReg = {
  first_name: string | null;
  last_name: string | null;
  email: string;
  country: string | null;
  phone: string | null;
  phone_country: string | null;
  product_slug: string;
  activate_choice: string | null;
  source_variant: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  payment_plan: string;
  installments_paid: number;
  installments_total: number;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  stripe_subscription_id: string | null;
  paypal_capture_id: string | null;
  paypal_subscription_id: string | null;
  consent_terms: number;
  consent_at: string | null;
  created_at: string;
  paid_at: string | null;
  bumps: string | null;
  language_choice: string | null;
};

async function enrichCourse(
  db: D1Database,
  order: UnifiedOrder,
  id: number,
): Promise<OrderDetail> {
  const reg = await db
    .prepare(
      `SELECT first_name, last_name, email, country, phone, phone_country,
              product_slug, activate_choice, source_variant, amount_cents, currency,
              status, payment_plan, installments_paid, installments_total,
              stripe_session_id, stripe_payment_intent, stripe_subscription_id,
              paypal_capture_id, paypal_subscription_id,
              consent_terms, consent_at, created_at, paid_at, bumps, language_choice
         FROM course_registrations WHERE id = ?`,
    )
    .bind(id)
    .first<CReg>();

  const plan = reg?.payment_plan || 'full';
  const { pct, kind } = await discountPctFromEvents(
    db,
    [
      `local-course-${id}`,
      `local-course-${id}-${plan}`,
      `local-course-pp-${id}`,
      `local-course-pp-${id}-${plan}`,
    ],
    'discount_percent',
  );
  let couponNote: string | null = null;
  if (pct >= 100) {
    couponNote = 'Free checkout — 100% comp (secret link)';
  } else if (pct > 0) {
    couponNote = `${pct}% discount applied${kind ? ` (${kind})` : ''}`;
  }

  const lineItems: DetailLine[] = [];
  if (order.originalAmountMinor > 0 || pct >= 100) {
    lineItems.push({
      label: order.productLabel,
      amount:
        order.originalAmountMinor > 0
          ? formatMoney(order.originalAmountMinor, order.originalCurrency)
          : 'Free (comp)',
    });
  }
  // Order bumps recorded as a JSON array of {slug, amount_cents}.
  if (reg?.bumps) {
    try {
      const bumps = JSON.parse(reg.bumps) as Array<{ slug: string; amount_cents: number }>;
      for (const b of bumps) {
        lineItems.push({
          label: `Bump · ${b.slug}`,
          amount: formatMoney(b.amount_cents, reg.currency || order.originalCurrency),
        });
      }
    } catch {
      /* ignore malformed bumps */
    }
  }

  const name = `${reg?.first_name ?? ''} ${reg?.last_name ?? ''}`.trim();
  const customer = fields([
    field('Phone', reg?.phone ? `${reg.phone}${reg.phone_country ? ` (${reg.phone_country})` : ''}` : null),
    field('Country', reg?.country),
    field('Currency', reg?.currency),
    field('Language', reg?.language_choice),
    field('Source variant', reg?.source_variant, { mono: true }),
    field('Activation', reg?.activate_choice),
    field('Terms consent', reg?.consent_terms ? `Yes${reg.consent_at ? ` · ${fmtTs(reg.consent_at)}` : ''}` : null),
  ]);

  const planLabel =
    reg && reg.installments_total > 1
      ? `${plan} · ${reg.installments_paid}/${reg.installments_total} charged`
      : plan;
  const payment = fields([
    field('Gateway', order.provider === 'paypal' ? 'PayPal' : 'Stripe'),
    field('Plan', planLabel),
    field('Payment status', reg?.status),
    field('Stripe session', reg?.stripe_session_id, { mono: true }),
    field('Stripe PaymentIntent', reg?.stripe_payment_intent, { mono: true }),
    field('Stripe subscription', reg?.stripe_subscription_id, { mono: true }),
    field('PayPal capture', reg?.paypal_capture_id, { mono: true }),
    field('PayPal subscription', reg?.paypal_subscription_id, { mono: true }),
  ]);

  const extra = fields([
    field('Product slug', reg?.product_slug, { mono: true }),
    field('Registered', fmtTs(reg?.created_at ?? order.createdAt)),
    field('Paid at', fmtTs(reg?.paid_at ?? order.paidAt)),
  ]);

  return { order, couponNote, lineItems, customer, payment, extra, countdownPath: null };
}

// ── Retreats ────────────────────────────────────────────────────────────────

type RReg = {
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  email: string;
  phone: string | null;
  phone_country: string | null;
  country: string | null;
  company_name: string | null;
  vat_number: string | null;
  address: string | null;
  roommate_pref: string | null;
  dietary: string | null;
  notes: string | null;
  status: string;
  amount_cents: number;
  currency: string;
  role: string | null;
  role_discount_cents: number;
  provider: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  paypal_capture_id: string | null;
  quaderno_invoice_id: string | null;
  created_at: string;
  paid_at: string | null;
  product_name: string | null;
  tier_name: string | null;
  room_name: string | null;
};

async function enrichRetreat(
  db: D1Database,
  order: UnifiedOrder,
  id: number,
): Promise<OrderDetail> {
  const reg = await db
    .prepare(
      `SELECT r.first_name, r.last_name, r.name, r.email, r.phone, r.phone_country,
              r.country, r.company_name, r.vat_number, r.address, r.roommate_pref,
              r.dietary, r.notes, r.status, r.amount_cents, r.currency,
              r.role, r.role_discount_cents, r.provider,
              r.stripe_session_id, r.stripe_payment_intent, r.paypal_capture_id,
              r.quaderno_invoice_id, r.created_at, r.paid_at,
              p.name AS product_name, t.name AS tier_name, iu.name AS room_name
         FROM registrations r
         LEFT JOIN products p ON p.id = r.product_id
         LEFT JOIN tiers t ON t.id = r.tier_id
         LEFT JOIN inventory_units iu ON iu.id = r.inventory_unit_id
        WHERE r.id = ?`,
    )
    .bind(id)
    .first<RReg>();

  let couponNote: string | null = null;
  if (reg && reg.role_discount_cents > 0) {
    couponNote = `${reg.role === 'cook_help' ? 'Cook-help role' : 'Role'} discount — ${formatMoney(
      reg.role_discount_cents,
      reg.currency || order.originalCurrency,
    )} off`;
  }

  const lineItems: DetailLine[] = [];
  if (order.originalAmountMinor > 0) {
    lineItems.push({
      label: reg?.tier_name ? `${order.productLabel} · ${reg.tier_name}` : order.productLabel,
      amount: formatMoney(order.originalAmountMinor, order.originalCurrency),
    });
  }

  const customer = fields([
    field('Phone', reg?.phone ? `${reg.phone}${reg.phone_country ? ` (${reg.phone_country})` : ''}` : null),
    field('Country', reg?.country),
    field('Company', reg?.company_name),
    field('VAT number', reg?.vat_number, { mono: true }),
    field('Address', reg?.address),
    field('Roommate pref', reg?.roommate_pref),
    field('Dietary', reg?.dietary),
    field('Notes', reg?.notes),
  ]);

  const payment = fields([
    field('Gateway', order.provider === 'paypal' ? 'PayPal' : 'Stripe'),
    field('Payment status', reg?.status),
    field('Stripe session', reg?.stripe_session_id, { mono: true }),
    field('Stripe PaymentIntent', reg?.stripe_payment_intent, { mono: true }),
    field('PayPal capture', reg?.paypal_capture_id, { mono: true }),
    field('Quaderno invoice', reg?.quaderno_invoice_id, { mono: true }),
  ]);

  const extra = fields([
    field('Tier', reg?.tier_name),
    field('Room', reg?.room_name),
    field('Role', reg?.role),
    field('Registered', fmtTs(reg?.created_at ?? order.createdAt)),
    field('Paid at', fmtTs(reg?.paid_at ?? order.paidAt)),
  ]);

  return { order, couponNote, lineItems, customer, payment, extra, countdownPath: null };
}
