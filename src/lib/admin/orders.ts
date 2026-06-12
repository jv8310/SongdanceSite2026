// Unified order overview across every product the site sells: retreats
// (`registrations`), courses (`course_registrations`) and live workshops
// (`workshop_registrations` + `workshop_payments`). Each store has its own
// shape; this module flattens them into one `UnifiedOrder` so the
// /admin/orders page can list, money-up and act on them side by side.
//
// Order numbers are namespaced by source so they stay unique across the
// three autoincrement id spaces and so the refund endpoint can route a
// number back to the right table:
//   R-<id>  retreat / registration
//   C-<id>  course
//   W-<id>  workshop
//
// Money: every order carries the *original* amount in the currency the buyer
// was charged, plus a best-effort EUR **net** (tax-excluded) figure:
//   • workshops — exact, from the stored Stripe settlement (EUR payout) and
//     the Quaderno tax split captured at checkout (mirrors the stats module);
//   • retreats  — net = gross / (1 + product.vat_rate) when charged in EUR;
//   • courses   — digital VAT is handled by the Stripe→Quaderno connector and
//     not stored, so EUR rows are shown as gross (flagged), and non-EUR rows
//     (e.g. a $99 grief course) have no EUR figure at all.

export type OrderSource = 'retreat' | 'course' | 'workshop';

// How trustworthy the EUR figure is:
//   exact — tax-excluded net in EUR
//   gross — an EUR amount, but VAT is not separated out (course rows)
//   none  — can't be expressed in EUR (non-EUR charge, no settlement)
export type NetKind = 'exact' | 'gross' | 'none';

export type StatusClass =
  | 'paid'
  | 'pending'
  | 'refunded'
  | 'cancelled'
  | 'expired'
  | 'other';

export type UnifiedOrder = {
  source: OrderSource;
  rowId: number;
  orderNo: string;
  productLabel: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  rawStatus: string;
  statusClass: StatusClass;
  originalAmountMinor: number;
  originalCurrency: string;
  netEurMinor: number | null;
  netKind: NetKind;
  refundedMinor: number;
  paymentIntent: string | null;
  quadernoInvoiceId: string | null;
  createdAt: string;
  paidAt: string | null;
};

const SOURCE_PREFIX: Record<OrderSource, string> = {
  retreat: 'R',
  course: 'C',
  workshop: 'W',
};

export function makeOrderNo(source: OrderSource, id: number): string {
  return `${SOURCE_PREFIX[source]}-${id}`;
}

// Turn an "R-123" back into { source, id } for the refund route. Returns null
// for anything that isn't a recognised, well-formed order number.
export function parseOrderNo(
  raw: string,
): { source: OrderSource; id: number } | null {
  const m = /^([RCW])-(\d+)$/.exec(raw.trim().toUpperCase());
  if (!m) return null;
  const id = parseInt(m[2], 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  const source: OrderSource =
    m[1] === 'R' ? 'retreat' : m[1] === 'C' ? 'course' : 'workshop';
  return { source, id };
}

function statusClassOf(raw: string): StatusClass {
  const v = raw.toLowerCase();
  if (v === 'paid' || v === 'coupon') return 'paid';
  if (v === 'pending' || v === 'prepared') return 'pending';
  if (v === 'refunded') return 'refunded';
  if (v === 'cancelled' || v === 'canceled') return 'cancelled';
  if (v === 'expired') return 'expired';
  return 'other'; // failed, chargeback, …
}

// Split a single "name" column into first / last on the first space.
function splitName(name: string | null): { first: string | null; last: string | null } {
  if (!name) return { first: null, last: null };
  const trimmed = name.trim();
  if (!trimmed) return { first: null, last: null };
  const i = trimmed.indexOf(' ');
  if (i === -1) return { first: trimmed, last: null };
  return { first: trimmed.slice(0, i), last: trimmed.slice(i + 1).trim() || null };
}

const COURSE_LABELS: Record<string, string> = {
  'cc-cert': 'SVH Certification (cert only)',
  'cc-bundle': 'SVH Certification (Foundation + Cert bundle)',
  'grief-course': 'The Grief Course',
  'svh-12week': 'SVH 12-Week Course',
  'grief': 'The Grief Course',
};

function courseLabel(slug: string): string {
  return COURSE_LABELS[slug] ?? slug;
}

// ── Retreats / registrations ──────────────────────────────────────────────

type RetreatRow = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  email: string;
  status: string;
  amount_cents: number;
  currency: string;
  refunded_amount_cents: number;
  stripe_payment_intent: string | null;
  quaderno_invoice_id: string | null;
  created_at: string;
  paid_at: string | null;
  product_name: string | null;
  vat_rate: number | null;
};

async function loadRetreatOrders(db: D1Database): Promise<UnifiedOrder[]> {
  const res = await db
    .prepare(
      `SELECT r.id, r.first_name, r.last_name, r.name, r.email, r.status,
              r.amount_cents, r.currency, r.refunded_amount_cents,
              r.stripe_payment_intent, r.quaderno_invoice_id,
              r.created_at, r.paid_at,
              p.name AS product_name, p.vat_rate AS vat_rate
         FROM registrations r
         LEFT JOIN products p ON p.id = r.product_id
        ORDER BY r.created_at DESC`,
    )
    .all<RetreatRow>();

  return (res.results ?? []).map((r) => {
    const fallback = splitName(r.name);
    const isEur = (r.currency || '').toUpperCase() === 'EUR';
    const vat = r.vat_rate ?? 0;
    const netEurMinor = isEur ? Math.round(r.amount_cents / (1 + vat)) : null;
    return {
      source: 'retreat' as const,
      rowId: r.id,
      orderNo: makeOrderNo('retreat', r.id),
      productLabel: r.product_name ?? 'Retreat',
      firstName: r.first_name ?? fallback.first,
      lastName: r.last_name ?? fallback.last,
      email: r.email,
      rawStatus: r.status,
      statusClass: statusClassOf(r.status),
      originalAmountMinor: r.amount_cents,
      originalCurrency: (r.currency || 'EUR').toUpperCase(),
      netEurMinor,
      netKind: isEur ? ('exact' as const) : ('none' as const),
      refundedMinor: r.refunded_amount_cents ?? 0,
      paymentIntent: r.stripe_payment_intent,
      quadernoInvoiceId: r.quaderno_invoice_id,
      createdAt: r.created_at,
      paidAt: r.paid_at,
    };
  });
}

// ── Courses ────────────────────────────────────────────────────────────────

type CourseRow = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  status: string;
  amount_cents: number;
  currency: string;
  refunded_amount_cents: number;
  stripe_payment_intent: string | null;
  product_slug: string;
  created_at: string;
  paid_at: string | null;
};

async function loadCourseOrders(db: D1Database): Promise<UnifiedOrder[]> {
  const res = await db
    .prepare(
      `SELECT id, first_name, last_name, email, status,
              amount_cents, currency, refunded_amount_cents,
              stripe_payment_intent, product_slug, created_at, paid_at
         FROM course_registrations
        ORDER BY created_at DESC`,
    )
    .all<CourseRow>();

  return (res.results ?? []).map((r) => {
    const isEur = (r.currency || '').toUpperCase() === 'EUR';
    return {
      source: 'course' as const,
      rowId: r.id,
      orderNo: makeOrderNo('course', r.id),
      productLabel: courseLabel(r.product_slug),
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      rawStatus: r.status,
      statusClass: statusClassOf(r.status),
      originalAmountMinor: r.amount_cents,
      originalCurrency: (r.currency || 'EUR').toUpperCase(),
      // Digital VAT is split by the Quaderno↔Stripe connector and not stored,
      // so EUR rows read as gross; non-EUR rows have no EUR figure.
      netEurMinor: isEur ? r.amount_cents : null,
      netKind: isEur ? ('gross' as const) : ('none' as const),
      refundedMinor: r.refunded_amount_cents ?? 0,
      paymentIntent: r.stripe_payment_intent,
      quadernoInvoiceId: null,
      createdAt: r.created_at,
      paidAt: r.paid_at,
    };
  });
}

// ── Workshops ────────────────────────────────────────────────────────────

type WorkshopRegRow = {
  id: number;
  name: string | null;
  email: string;
  reg_currency: string | null;
  payment_status: string;
  wants_bump: number;
  created_at: string;
  workshop_title: string | null;
};

type WorkshopPayRow = {
  registration_id: number;
  amount_minor: number;
  pay_currency: string;
  settlement_amount_minor: number | null;
  settlement_currency: string | null;
  subtotal_minor: number | null;
  stripe_payment_intent_id: string | null;
  quaderno_invoice_id: string | null;
  status: string;
};

async function loadWorkshopOrders(db: D1Database): Promise<UnifiedOrder[]> {
  const regRes = await db
    .prepare(
      `SELECT r.id, r.name, r.email, r.currency AS reg_currency,
              r.payment_status, r.wants_bump, r.created_at,
              w.title AS workshop_title
         FROM workshop_registrations r
         LEFT JOIN workshops w ON w.id = r.workshop_id
        ORDER BY r.created_at DESC`,
    )
    .all<WorkshopRegRow>();
  const regs = regRes.results ?? [];
  if (!regs.length) return [];

  // Latest paid/refunded payment per registration (ASC so the last write wins).
  const ids = regs.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');
  const payRes = await db
    .prepare(
      `SELECT registration_id, amount_minor, currency AS pay_currency,
              settlement_amount_minor, settlement_currency, subtotal_minor,
              stripe_payment_intent_id, quaderno_invoice_id, status
         FROM workshop_payments
        WHERE registration_id IN (${ph}) AND status IN ('paid','refunded')
        ORDER BY created_at ASC`,
    )
    .bind(...ids)
    .all<WorkshopPayRow>();
  const payByReg = new Map<number, WorkshopPayRow>();
  for (const p of payRes.results ?? []) payByReg.set(p.registration_id, p);

  return regs.map((r) => {
    const pay = payByReg.get(r.id);
    const { first, last } = splitName(r.name);
    const label =
      (r.workshop_title ?? 'Workshop') + (r.wants_bump === 1 ? ' + bump' : '');

    let originalAmountMinor = 0;
    let originalCurrency = (r.reg_currency || 'EUR').toUpperCase();
    let netEurMinor: number | null = null;
    let netKind: NetKind = 'none';
    let refundedMinor = 0;

    if (pay) {
      originalAmountMinor = pay.amount_minor;
      originalCurrency = (pay.pay_currency || originalCurrency).toUpperCase();
      // Gross in EUR: prefer the EUR settlement, else the charge if it was EUR.
      const grossEur =
        pay.settlement_currency === 'EUR' && pay.settlement_amount_minor != null
          ? pay.settlement_amount_minor
          : pay.pay_currency?.toUpperCase() === 'EUR'
            ? pay.amount_minor
            : null;
      if (grossEur != null) {
        if (pay.subtotal_minor != null && pay.amount_minor > 0) {
          netEurMinor = Math.round(
            pay.subtotal_minor * (grossEur / pay.amount_minor),
          );
          netKind = 'exact';
        } else {
          netEurMinor = grossEur;
          netKind = 'gross';
        }
      }
      // We don't store a partial-refund figure for workshops — a refunded
      // payment is treated as fully refunded for the running total.
      if (pay.status === 'refunded') refundedMinor = pay.amount_minor;
    }

    return {
      source: 'workshop' as const,
      rowId: r.id,
      orderNo: makeOrderNo('workshop', r.id),
      productLabel: label,
      firstName: first,
      lastName: last,
      email: r.email,
      rawStatus: r.payment_status,
      statusClass: statusClassOf(r.payment_status),
      originalAmountMinor,
      originalCurrency,
      netEurMinor,
      netKind,
      refundedMinor,
      paymentIntent: pay?.stripe_payment_intent_id ?? null,
      quadernoInvoiceId: pay?.quaderno_invoice_id ?? null,
      createdAt: r.created_at,
      paidAt: null,
    };
  });
}

// ── Public loader ──────────────────────────────────────────────────────────

export type OrderFilter = {
  source?: OrderSource | null;
  status?: StatusClass | null;
  query?: string | null;
};

// Every order across the three stores, newest first. Filtering is applied in
// memory (the merged set is small at this stage and a single sort keeps the
// timeline honest across sources).
export async function listAllOrders(
  db: D1Database,
  filter: OrderFilter = {},
): Promise<UnifiedOrder[]> {
  const [retreats, courses, workshops] = await Promise.all([
    loadRetreatOrders(db),
    loadCourseOrders(db),
    loadWorkshopOrders(db),
  ]);
  let all = [...retreats, ...courses, ...workshops].sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || ''),
  );

  if (filter.source) all = all.filter((o) => o.source === filter.source);
  if (filter.status) all = all.filter((o) => o.statusClass === filter.status);
  if (filter.query) {
    const q = filter.query.trim().toLowerCase();
    if (q) {
      all = all.filter((o) => {
        const name = `${o.firstName ?? ''} ${o.lastName ?? ''}`.toLowerCase();
        return (
          o.email.toLowerCase().includes(q) ||
          name.includes(q) ||
          o.orderNo.toLowerCase().includes(q) ||
          o.productLabel.toLowerCase().includes(q)
        );
      });
    }
  }
  return all;
}

// Remaining refundable amount (minor units, in the order's own currency).
export function refundableMinor(o: UnifiedOrder): number {
  return Math.max(0, o.originalAmountMinor - o.refundedMinor);
}

// Can this order be refunded from the admin? Needs a PaymentIntent to target,
// a positive charge, and money still left to give back.
export function isRefundable(o: UnifiedOrder): boolean {
  return (
    !!o.paymentIntent &&
    o.originalAmountMinor > 0 &&
    refundableMinor(o) > 0 &&
    o.statusClass !== 'pending'
  );
}
