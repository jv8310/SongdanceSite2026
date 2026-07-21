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
//     fetch the buyer-country rate live from Quaderno (the same eservice
//     destination-VAT lookup the checkout uses), defaulting to Belgium for
//     EUR charges with no country on file.

import { DEFAULT_FX_TO_EUR } from './fx';
import { getTaxRate, type QuadernoTaxConfig } from '../workshops/quaderno';
import { LABEL_BY_SLUG, isJourneySlug } from '../courses/journeys';
import { selectByIdsChunked } from '../db/chunked';

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
  // Which gateway charged this order.
  provider: 'stripe' | 'paypal';
  // The specific method used (card / bancontact / ideal / sepa_debit / …).
  // Captured for workshops (workshop_payments.method); null for courses &
  // retreats, which don't store it — those show just the gateway.
  paymentMethod: string | null;
  paymentIntent: string | null; // Stripe PaymentIntent (refund target)
  stripeSubscriptionId: string | null; // set → a Stripe installment plan
  paypalCaptureId: string | null; // PayPal capture / sale id (refund target)
  paypalSubscriptionId: string | null; // set → a PayPal installment plan
  quadernoInvoiceId: string | null;
  // Installment plan shape (course orders only; 'full' / total 1 elsewhere).
  // originalAmountMinor is the WHOLE plan total; installmentsPaid/Total say how
  // far along it is, so the overview can flag "paid in installments".
  paymentPlan: string; // 'full' | '3x' | '6x' | '12x'
  installmentsPaid: number;
  installmentsTotal: number;
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
  if (COURSE_LABELS[slug]) return COURSE_LABELS[slug];
  // Journeys (asj / mmj / inner-child / bundles) carry their own friendly names
  // in the journeys module — use them so the overview never shows a raw slug.
  if (isJourneySlug(slug)) return LABEL_BY_SLUG[slug];
  return slug;
}

// Compact display name for the orders table. The full marketing titles ("Somatic
// Vocal Healing Masterclass", "Ritual of Belonging Retreat, Nov 2026") are too
// long to scan in a table column, so we abbreviate to a short two-word form
// (SVH Masterclass, Ritual Retreat). The full label is still shown on hover.
export function shortProductLabel(label: string, source: OrderSource): string {
  let s = (label ?? '').trim();
  if (!s) return s;

  // Peel a trailing "+ bump" so we shorten only the product name, then re-add it.
  let suffix = '';
  const bump = /\s*\+\s*bump\s*$/i.exec(s);
  if (bump) {
    suffix = ' + bump';
    s = s.slice(0, bump.index).trim();
  }

  // The site's core brand phrase → initials; drop a leading article.
  s = s.replace(/\bsomatic\s+vocal\s+healing\b/gi, 'SVH').replace(/^the\s+/i, '');

  // Retreats: strip a trailing date qualifier ("…, Nov 2026") and compress
  // "<Theme> Retreat" down to "<FirstWord> Retreat".
  if (source === 'retreat') {
    s = s.replace(/,.*$/, '').trim();
    const m = /^(.*?)\bretreat\b/i.exec(s);
    if (m) {
      const first = m[1].trim().split(/\s+/)[0] ?? '';
      s = first ? `${first} Retreat` : 'Retreat';
    }
  }

  return (s + suffix).trim();
}

// ── Money: FX + VAT ─────────────────────────────────────────────────────────

// Options threaded into the loaders to money-up each order:
//   fxRates  — currency→EUR rates (from the daily-refreshed fx_rates store);
//   quaderno — config for the live eservice VAT lookup used on course rows.
export type OrderMoneyOpts = {
  fxRates?: Record<string, number>;
  quaderno?: QuadernoTaxConfig;
};

// Convert a minor amount to EUR minor. Returns whether FX was applied (for the
// ≈ flag), or null when we have no rate for the currency.
function toEurMinor(
  amountMinor: number,
  currency: string,
  fxRates: Record<string, number>,
): { minor: number; fx: boolean } | null {
  const c = (currency || 'EUR').toUpperCase();
  if (c === 'EUR') return { minor: amountMinor, fx: false };
  const rate = fxRates[c];
  if (rate == null || !(rate > 0)) return null;
  return { minor: Math.round(amountMinor * rate), fx: true };
}

// The country we charge eservice VAT against: the buyer's, or Belgium (home
// market) when it's an EUR charge with no country on file.
function eserviceCountry(country: string | null, currency: string): string | null {
  const c = (country ?? '').toUpperCase();
  if (c) return c;
  return (currency || '').toUpperCase() === 'EUR' ? 'BE' : null;
}

// Pre-fetch Quaderno's eservice VAT rate for each distinct country, once.
// getTaxRate caches in-process, so overlapping countries across loaders are
// free. Missing config / failed lookups simply leave a country unset (→ 0).
async function resolveEserviceRates(
  countries: Array<string | null>,
  quaderno?: QuadernoTaxConfig,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!quaderno) return map;
  const uniq = [...new Set(countries.filter((c): c is string => !!c))];
  await Promise.all(
    uniq.map(async (c) => {
      try {
        map.set(c, await getTaxRate(quaderno, c, 'eservice'));
      } catch {
        /* leave unset → treated as 0 */
      }
    }),
  );
  return map;
}

// Shared "gross in currency → EUR net" path for courses and retreats.
function netEurFrom(
  amountMinor: number,
  currency: string,
  vatRate: number,
  fxRates: Record<string, number>,
): { netEurMinor: number | null; netKind: NetKind } {
  if (amountMinor <= 0) return { netEurMinor: 0, netKind: 'exact' };
  const eur = toEurMinor(amountMinor, currency, fxRates);
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
  provider: string | null;
  stripe_payment_intent: string | null;
  paypal_capture_id: string | null;
  quaderno_invoice_id: string | null;
  created_at: string;
  paid_at: string | null;
  product_name: string | null;
  vat_rate: number | null;
};

async function loadRetreatOrders(
  db: D1Database,
  opts: OrderMoneyOpts,
): Promise<UnifiedOrder[]> {
  const fxRates = opts.fxRates ?? DEFAULT_FX_TO_EUR;
  const res = await db
    .prepare(
      `SELECT r.id, r.first_name, r.last_name, r.name, r.email, r.status,
              r.amount_cents, r.currency, r.refunded_amount_cents,
              r.provider, r.stripe_payment_intent, r.paypal_capture_id,
              r.quaderno_invoice_id,
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
      fxRates,
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
      provider: r.provider === 'paypal' ? 'paypal' : 'stripe',
      paymentMethod: null,
      paymentIntent: r.stripe_payment_intent,
      stripeSubscriptionId: null,
      paypalCaptureId: r.paypal_capture_id,
      paypalSubscriptionId: null,
      quadernoInvoiceId: r.quaderno_invoice_id,
      paymentPlan: 'full',
      installmentsPaid: 0,
      installmentsTotal: 1,
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
  provider: string | null;
  stripe_payment_intent: string | null;
  stripe_subscription_id: string | null;
  paypal_capture_id: string | null;
  paypal_subscription_id: string | null;
  payment_plan: string;
  installments_paid: number;
  installments_total: number;
  product_slug: string;
  created_at: string;
  paid_at: string | null;
};

async function loadCourseOrders(
  db: D1Database,
  opts: OrderMoneyOpts,
): Promise<UnifiedOrder[]> {
  const fxRates = opts.fxRates ?? DEFAULT_FX_TO_EUR;
  const res = await db
    .prepare(
      `SELECT id, first_name, last_name, email, country, status,
              amount_cents, currency, refunded_amount_cents,
              provider, stripe_payment_intent, stripe_subscription_id,
              paypal_capture_id, paypal_subscription_id,
              payment_plan, installments_paid, installments_total,
              product_slug, created_at, paid_at
         FROM course_registrations
        ORDER BY created_at DESC`,
    )
    .all<CourseRow>();
  const rows = res.results ?? [];

  // Live destination VAT per buyer country, from Quaderno (eservice — the same
  // tax class the course checkout sends).
  const rateByCountry = await resolveEserviceRates(
    rows.map((r) => eserviceCountry(r.country, r.currency)),
    opts.quaderno,
  );

  return rows.map((r) => {
    const country = eserviceCountry(r.country, r.currency);
    const vatRate = country ? rateByCountry.get(country) ?? 0 : 0;
    const { netEurMinor, netKind } = netEurFrom(
      r.amount_cents,
      r.currency,
      vatRate,
      fxRates,
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
      provider: r.provider === 'paypal' ? 'paypal' : 'stripe',
      paymentMethod: null,
      paymentIntent: r.stripe_payment_intent,
      stripeSubscriptionId: r.stripe_subscription_id,
      paypalCaptureId: r.paypal_capture_id,
      paypalSubscriptionId: r.paypal_subscription_id,
      quadernoInvoiceId: null,
      paymentPlan: r.payment_plan || 'full',
      installmentsPaid: r.installments_paid ?? 0,
      installmentsTotal: r.installments_total ?? 1,
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
  provider: string | null;
  method: string | null;
  stripe_payment_intent_id: string | null;
  paypal_capture_id: string | null;
  quaderno_invoice_id: string | null;
  status: string;
};

async function loadWorkshopOrders(
  db: D1Database,
  opts: OrderMoneyOpts,
): Promise<UnifiedOrder[]> {
  const fxRates = opts.fxRates ?? DEFAULT_FX_TO_EUR;
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
  // Chunked by registration_id to stay under D1's 100-bound-param cap — all of a
  // registration's payments land in the same batch, so last-write-wins holds.
  const ids = regs.map((r) => r.id);
  const payRows = await selectByIdsChunked<WorkshopPayRow>(
    db,
    ids,
    (ph) =>
      `SELECT registration_id, amount_minor, currency AS pay_currency,
              settlement_amount_minor, settlement_currency, subtotal_minor,
              provider, method, stripe_payment_intent_id, paypal_capture_id,
              quaderno_invoice_id, status
         FROM workshop_payments
        WHERE registration_id IN (${ph}) AND status IN ('paid','refunded')
        ORDER BY created_at ASC`,
  );
  const payByReg = new Map<number, WorkshopPayRow>();
  for (const p of payRows) payByReg.set(p.registration_id, p);

  // Live eservice VAT for the rare paid rows with no stored tax split, so we
  // can still strip VAT from the gross instead of overstating net.
  const fallbackCountries = regs
    .filter((r) => {
      const pay = payByReg.get(r.id);
      return pay && pay.subtotal_minor == null;
    })
    .map((r) => eserviceCountry(r.country, 'EUR'));
  const rateByCountry = await resolveEserviceRates(fallbackCountries, opts.quaderno);

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
        const eur = toEurMinor(pay.amount_minor, pay.pay_currency, fxRates);
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
          // Fall back to the live buyer-country eservice VAT rate.
          const country = eserviceCountry(r.country, 'EUR');
          const vatRate = country ? rateByCountry.get(country) ?? 0 : 0;
          netEurMinor = Math.round(grossEur / (1 + vatRate));
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
      provider: pay?.provider === 'paypal' ? 'paypal' : 'stripe',
      paymentMethod: pay?.method ?? null,
      paymentIntent: pay?.stripe_payment_intent_id ?? null,
      stripeSubscriptionId: null,
      paypalCaptureId: pay?.paypal_capture_id ?? null,
      paypalSubscriptionId: null,
      quadernoInvoiceId: pay?.quaderno_invoice_id ?? null,
      paymentPlan: 'full',
      installmentsPaid: 0,
      installmentsTotal: 1,
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
// timeline honest across sources). `money` supplies the FX rates + Quaderno
// config used to compute each order's EUR net; omit it (e.g. the refund route,
// which only needs amounts in the charge currency) and net falls back to the
// seed FX table with no VAT lookups.
export async function listAllOrders(
  db: D1Database,
  filter: OrderFilter = {},
  money: OrderMoneyOpts = {},
): Promise<UnifiedOrder[]> {
  const [retreats, courses, workshops] = await Promise.all([
    loadRetreatOrders(db, money),
    loadCourseOrders(db, money),
    loadWorkshopOrders(db, money),
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

// Can this order be refunded from the admin? Needs a charge to target (a Stripe
// PaymentIntent or a PayPal capture/sale id), a positive amount, and money still
// left to give back.
export function isRefundable(o: UnifiedOrder): boolean {
  const hasTarget =
    o.provider === 'paypal' ? !!o.paypalCaptureId : !!o.paymentIntent;
  return (
    hasTarget &&
    o.originalAmountMinor > 0 &&
    refundableMinor(o) > 0 &&
    o.statusClass !== 'pending'
  );
}
