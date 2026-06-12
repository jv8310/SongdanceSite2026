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
// was charged, plus an EUR **net** (tax-excluded) figure:
//   • EUR is taken 1:1; other currencies are converted at the approximate
//     display rates below and flagged ≈ (we don't store per-charge FX for
//     courses/retreats — workshops keep their exact Stripe settlement).
//   • VAT is then stripped: workshops use the exact split captured at
//     checkout; retreats use product.vat_rate (event-location VAT); courses
//     use the buyer-country standard rate (destination VAT for digital
//     services), defaulting to Belgium (21%) for EUR charges with no country.

export type OrderSource = 'retreat' | 'course' | 'workshop';

// How trustworthy the EUR figure is:
//   exact  — EUR charge with a known VAT rate (or workshop stored split)
//   approx — involved an FX conversion to EUR (flagged ≈ on the page)
//   none   — couldn't be expressed in EUR at all (no amount / unknown currency)
export type NetKind = 'exact' | 'approx' | 'none';

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

// ── Money: FX + VAT ─────────────────────────────────────────────────────────

// Approximate display rates → EUR (mid-market ballpark). We don't store a
// per-charge settlement for courses/retreats, so non-EUR rows are converted
// here for the overview and flagged ≈. Bump these if a rate drifts a lot.
const FX_TO_EUR: Record<string, number> = {
  EUR: 1,
  USD: 0.92,
  GBP: 1.17,
  CAD: 0.68,
  CHF: 1.05,
  NOK: 0.086,
  SEK: 0.088,
  DKK: 0.134,
  AUD: 0.6,
  NZD: 0.56,
};

// EU standard VAT rates, used to strip tax off digital course sales by the
// buyer's country (destination VAT for eservices). Non-EU buyers → 0.
const EU_VAT: Record<string, number> = {
  AT: 0.2, BE: 0.21, BG: 0.2, CY: 0.19, CZ: 0.21, DE: 0.19, DK: 0.25,
  EE: 0.22, ES: 0.21, FI: 0.255, FR: 0.2, GR: 0.24, HR: 0.25, HU: 0.27,
  IE: 0.23, IT: 0.22, LT: 0.21, LU: 0.17, LV: 0.21, MT: 0.18, NL: 0.21,
  PL: 0.23, PT: 0.23, RO: 0.19, SE: 0.25, SI: 0.22, SK: 0.23,
};

// Convert a minor amount to EUR minor. Returns whether FX was applied (for the
// ≈ flag), or null when the currency is one we don't have a rate for.
function toEurMinor(
  amountMinor: number,
  currency: string,
): { minor: number; fx: boolean } | null {
  const c = (currency || 'EUR').toUpperCase();
  if (c === 'EUR') return { minor: amountMinor, fx: false };
  const rate = FX_TO_EUR[c];
  if (rate == null) return null;
  return { minor: Math.round(amountMinor * rate), fx: true };
}

// Destination VAT rate for a digital course sale. Known EU country → its
// standard rate; known non-EU → 0; unknown → assume Belgium (home market) for
// EUR charges, else 0.
function courseVatRate(country: string | null, currency: string): number {
  const c = (country ?? '').toUpperCase();
  if (c) return EU_VAT[c] ?? 0;
  return (currency || '').toUpperCase() === 'EUR' ? 0.21 : 0;
}

// Shared "gross in currency → EUR net" path for courses and retreats.
function netEurFrom(
  amountMinor: number,
  currency: string,
  vatRate: number,
): { netEurMinor: number | null; netKind: NetKind } {
  if (amountMinor <= 0) return { netEurMinor: 0, netKind: 'exact' };
  const eur = toEurMinor(amountMinor, currency);
  if (!eur) return { netEurMinor: null, netKind: 'none' };
  const netEurMinor = Math.round(eur.minor / (1 + vatRate));
  return { netEurMinor, netKind: eur.fx ? 'approx' : 'exact' };
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
    const { netEurMinor, netKind } = netEurFrom(
      r.amount_cents,
      r.currency,
      r.vat_rate ?? 0,
    );
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
      netKind,
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
  country: string | null;
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
      `SELECT id, first_name, last_name, email, country, status,
              amount_cents, currency, refunded_amount_cents,
              stripe_payment_intent, product_slug, created_at, paid_at
         FROM course_registrations
        ORDER BY created_at DESC`,
    )
    .all<CourseRow>();

  return (res.results ?? []).map((r) => {
    const { netEurMinor, netKind } = netEurFrom(
      r.amount_cents,
      r.currency,
      courseVatRate(r.country, r.currency),
    );
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
      netEurMinor,
      netKind,
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
  country: string | null;
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
      `SELECT r.id, r.name, r.email, r.country, r.currency AS reg_currency,
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
      // Gross in EUR: prefer the exact EUR settlement, else convert the charge.
      let fx = false;
      let grossEur: number | null = null;
      if (pay.settlement_currency === 'EUR' && pay.settlement_amount_minor != null) {
        grossEur = pay.settlement_amount_minor;
      } else {
        const eur = toEurMinor(pay.amount_minor, pay.pay_currency);
        if (eur) {
          grossEur = eur.minor;
          fx = eur.fx;
        }
      }
      if (grossEur != null) {
        if (pay.subtotal_minor != null && pay.amount_minor > 0) {
          // Exact tax split captured at checkout, scaled to the EUR gross.
          netEurMinor = Math.round(
            pay.subtotal_minor * (grossEur / pay.amount_minor),
          );
        } else {
          // Fall back to the buyer-country VAT rate.
          netEurMinor = Math.round(
            grossEur / (1 + courseVatRate(r.country, 'EUR')),
          );
        }
        netKind = fx ? 'approx' : 'exact';
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
  // Multi-select: an order matches when its source/status is in the set (an
  // empty or absent set means "no filter on this dimension").
  sources?: OrderSource[] | null;
  statuses?: StatusClass[] | null;
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

  const sources = filter.sources ?? [];
  const statuses = filter.statuses ?? [];
  if (sources.length) all = all.filter((o) => sources.includes(o.source));
  if (statuses.length) all = all.filter((o) => statuses.includes(o.statusClass));
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
