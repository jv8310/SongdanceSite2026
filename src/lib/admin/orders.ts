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
import { BANK_TRANSFER, type OrderProvider } from '../payments/provider';
import { getTaxRate, type QuadernoTaxConfig } from '../workshops/quaderno';
import { LABEL_BY_SLUG, isJourneySlug } from '../courses/journeys';

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
  // Which gateway charged this order — or 'bank_transfer', which is no
  // gateway at all (a manual IBAN transfer, confirmed by hand in the admin).
  provider: OrderProvider;
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

// ── Filtering: pushed down into SQL ────────────────────────────────────────
//
// The overview used to load every row of all three stores and filter the merged
// array in memory. That is fine at a few hundred orders and ruinous at tens of
// thousands (the workshop side alone fanned out into one extra query per 90
// registrations). Source / status / search / email now compile to SQL WHERE
// fragments, so each store returns only rows that can actually show up.

type Clause = { sql: string; binds: unknown[] };

// Raw DB statuses behind each display class (mirror of statusClassOf).
const RAW_STATUS_BY_CLASS: Record<Exclude<StatusClass, 'other'>, string[]> = {
  paid: ['paid', 'coupon'],
  pending: ['pending', 'prepared'],
  refunded: ['refunded'],
  cancelled: ['cancelled', 'canceled'],
  expired: ['expired'],
};
// Everything statusClassOf() recognises; anything else classes as 'other'.
const KNOWN_RAW_STATUSES = Object.values(RAW_STATUS_BY_CLASS).flat();

function statusClause(col: string, statuses: StatusClass[]): Clause | null {
  if (!statuses.length) return null;
  const parts: string[] = [];
  const binds: unknown[] = [];
  const raws = statuses
    .filter((s): s is Exclude<StatusClass, 'other'> => s !== 'other')
    .flatMap((s) => RAW_STATUS_BY_CLASS[s]);
  if (raws.length) {
    parts.push(`LOWER(${col}) IN (${raws.map(() => '?').join(',')})`);
    binds.push(...raws);
  }
  if (statuses.includes('other')) {
    parts.push(
      `LOWER(${col}) NOT IN (${KNOWN_RAW_STATUSES.map(() => '?').join(',')})`,
    );
    binds.push(...KNOWN_RAW_STATUSES);
  }
  return { sql: `(${parts.join(' OR ')})`, binds };
}

// The search box is a plain "contains", so LIKE's own wildcards have to be
// neutralised or a stray % would match everything.
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// OR of case-insensitive "contains" over the given columns.
function likeAny(cols: string[], q: string): Clause {
  const term = likeTerm(q);
  const binds: unknown[] = [];
  const parts = cols.map((c) => {
    binds.push(term);
    return `LOWER(${c}) LIKE ? ESCAPE '\\'`;
  });
  return { sql: parts.join(' OR '), binds };
}

function andWhere(parts: Array<Clause | null>): Clause {
  const on = parts.filter((p): p is Clause => !!p && p.sql.trim() !== '');
  if (!on.length) return { sql: '', binds: [] };
  return {
    sql: `WHERE ${on.map((p) => `(${p.sql})`).join(' AND ')}`,
    binds: on.flatMap((p) => p.binds),
  };
}

function idsClause(col: string, ids: number[]): Clause {
  return { sql: `${col} IN (${ids.map(() => '?').join(',')})`, binds: ids };
}

function emailClause(col: string, email: string): Clause {
  return { sql: `LOWER(${col}) = ?`, binds: [email.trim().toLowerCase()] };
}

// The table shows "<first> <last>", so a search for a full name has to see the
// two columns joined (and NULL-safe — 'x' || NULL is NULL in SQLite).
function fullName(first: string, last: string): string {
  return `COALESCE(${first},'') || ' ' || COALESCE(${last},'')`;
}

// What a loader is allowed to return: either an explicit id list (hydrating one
// page of the index) or the user's filter.
type Scope = { ids?: number[]; filter?: OrderFilter };

function scopeQuery(scope: Scope): string | null {
  const q = (scope.filter?.query ?? '').trim().toLowerCase();
  return q || null;
}

function run<T>(db: D1Database, sql: string, binds: unknown[]) {
  const stmt = db.prepare(sql);
  return (binds.length ? stmt.bind(...binds) : stmt).all<T>();
}

// ── Retreats / registrations ──────────────────────────────────────────────

const RETREAT_FROM = `FROM registrations r
         LEFT JOIN products p ON p.id = r.product_id`;

// Columns every retreat path needs to money-up a row.
const RETREAT_MONEY_COLS = `r.id, r.created_at, r.status,
              r.amount_cents, r.currency, r.refunded_amount_cents,
              p.vat_rate AS vat_rate`;

type RetreatMoneyRow = {
  id: number;
  created_at: string;
  status: string;
  amount_cents: number;
  currency: string;
  refunded_amount_cents: number;
  vat_rate: number | null;
};

type RetreatRow = RetreatMoneyRow & {
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  email: string;
  provider: string | null;
  stripe_payment_intent: string | null;
  paypal_capture_id: string | null;
  quaderno_invoice_id: string | null;
  paid_at: string | null;
  product_name: string | null;
};

function retreatWhere(scope: Scope): Clause {
  if (scope.ids) return andWhere([idsClause('r.id', scope.ids)]);
  const f = scope.filter ?? {};
  const q = scopeQuery(scope);
  return andWhere([
    statusClause('r.status', f.statuses ?? []),
    f.email ? emailClause('r.email', f.email) : null,
    q
      ? likeAny(
          [
            'r.email',
            fullName('r.first_name', 'r.last_name'),
            'r.name',
            'p.name',
            `'r-' || r.id`,
          ],
          q,
        )
      : null,
  ]);
}

async function loadRetreatIndex(
  db: D1Database,
  opts: OrderMoneyOpts,
  scope: Scope,
): Promise<OrderIndexRow[]> {
  const fxRates = opts.fxRates ?? DEFAULT_FX_TO_EUR;
  const w = retreatWhere(scope);
  const res = await run<RetreatMoneyRow>(
    db,
    `SELECT ${RETREAT_MONEY_COLS} ${RETREAT_FROM} ${w.sql}`,
    w.binds,
  );
  return (res.results ?? []).map((r) => ({
    source: 'retreat' as const,
    rowId: r.id,
    createdAt: r.created_at,
    statusClass: statusClassOf(r.status),
    netEurMinor: netEurFrom(r.amount_cents, r.currency, r.vat_rate ?? 0, fxRates)
      .netEurMinor,
    refundedMinor: r.refunded_amount_cents ?? 0,
  }));
}

async function loadRetreatOrders(
  db: D1Database,
  opts: OrderMoneyOpts,
  scope: Scope,
): Promise<UnifiedOrder[]> {
  const fxRates = opts.fxRates ?? DEFAULT_FX_TO_EUR;
  const w = retreatWhere(scope);
  const res = await run<RetreatRow>(
    db,
    `SELECT ${RETREAT_MONEY_COLS},
              r.first_name, r.last_name, r.name, r.email,
              r.provider, r.stripe_payment_intent, r.paypal_capture_id,
              r.quaderno_invoice_id, r.paid_at,
              p.name AS product_name
         ${RETREAT_FROM} ${w.sql}`,
    w.binds,
  );

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
      provider: orderProviderOf(r.provider),
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

// Columns every course path needs to money-up a row.
const COURSE_MONEY_COLS = `id, created_at, status, country,
              amount_cents, currency, refunded_amount_cents`;

type CourseMoneyRow = {
  id: number;
  created_at: string;
  status: string;
  country: string | null;
  amount_cents: number;
  currency: string;
  refunded_amount_cents: number;
};

type CourseRow = CourseMoneyRow & {
  first_name: string | null;
  last_name: string | null;
  email: string;
  provider: string | null;
  stripe_payment_intent: string | null;
  stripe_subscription_id: string | null;
  paypal_capture_id: string | null;
  paypal_subscription_id: string | null;
  payment_plan: string;
  installments_paid: number;
  installments_total: number;
  product_slug: string;
  paid_at: string | null;
};

// A course row stores a slug; the table shows the friendly label courseLabel()
// derives from it. So a product search has to translate back: any known slug
// whose label contains the term matches, plus a plain slug LIKE for the ones
// that show their slug verbatim (albums, unmapped products).
const KNOWN_COURSE_SLUGS = [
  ...new Set([...Object.keys(COURSE_LABELS), ...Object.keys(LABEL_BY_SLUG)]),
];
function courseSlugsMatching(q: string): string[] {
  return KNOWN_COURSE_SLUGS.filter((s) => courseLabel(s).toLowerCase().includes(q));
}

function courseWhere(scope: Scope): Clause {
  if (scope.ids) return andWhere([idsClause('id', scope.ids)]);
  const f = scope.filter ?? {};
  const q = scopeQuery(scope);
  let search: Clause | null = null;
  if (q) {
    search = likeAny(
      [
        'email',
        fullName('first_name', 'last_name'),
        'product_slug',
        `'c-' || id`,
      ],
      q,
    );
    const slugs = courseSlugsMatching(q);
    if (slugs.length) {
      search = {
        sql: `${search.sql} OR product_slug IN (${slugs.map(() => '?').join(',')})`,
        binds: [...search.binds, ...slugs],
      };
    }
  }
  return andWhere([
    statusClause('status', f.statuses ?? []),
    f.email ? emailClause('email', f.email) : null,
    search,
  ]);
}

// Live destination VAT per buyer country, from Quaderno (eservice — the same
// tax class the course checkout sends).
function courseRates(rows: CourseMoneyRow[], opts: OrderMoneyOpts) {
  return resolveEserviceRates(
    rows.map((r) => eserviceCountry(r.country, r.currency)),
    opts.quaderno,
  );
}

async function loadCourseIndex(
  db: D1Database,
  opts: OrderMoneyOpts,
  scope: Scope,
): Promise<OrderIndexRow[]> {
  const fxRates = opts.fxRates ?? DEFAULT_FX_TO_EUR;
  const w = courseWhere(scope);
  const res = await run<CourseMoneyRow>(
    db,
    `SELECT ${COURSE_MONEY_COLS} FROM course_registrations ${w.sql}`,
    w.binds,
  );
  const rows = res.results ?? [];
  const rateByCountry = await courseRates(rows, opts);
  return rows.map((r) => {
    const country = eserviceCountry(r.country, r.currency);
    const vatRate = country ? rateByCountry.get(country) ?? 0 : 0;
    return {
      source: 'course' as const,
      rowId: r.id,
      createdAt: r.created_at,
      statusClass: statusClassOf(r.status),
      netEurMinor: netEurFrom(r.amount_cents, r.currency, vatRate, fxRates)
        .netEurMinor,
      refundedMinor: r.refunded_amount_cents ?? 0,
    };
  });
}

async function loadCourseOrders(
  db: D1Database,
  opts: OrderMoneyOpts,
  scope: Scope,
): Promise<UnifiedOrder[]> {
  const fxRates = opts.fxRates ?? DEFAULT_FX_TO_EUR;
  const w = courseWhere(scope);
  const res = await run<CourseRow>(
    db,
    `SELECT ${COURSE_MONEY_COLS},
              first_name, last_name, email,
              provider, stripe_payment_intent, stripe_subscription_id,
              paypal_capture_id, paypal_subscription_id,
              payment_plan, installments_paid, installments_total,
              product_slug, paid_at
         FROM course_registrations ${w.sql}`,
    w.binds,
  );
  const rows = res.results ?? [];
  const rateByCountry = await courseRates(rows, opts);

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

// The registration's money lives on its latest paid/refunded payment row. That
// used to be a second query per 90 registrations (D1's bound-parameter cap),
// i.e. dozens of sequential round-trips on a busy account — the single biggest
// cost of the old overview. One window-function join replaces the lot: rank the
// payments per registration and keep the newest.
const WORKSHOP_FROM = `FROM workshop_registrations r
         LEFT JOIN workshops w ON w.id = r.workshop_id
         LEFT JOIN (
           SELECT registration_id, amount_minor, currency AS pay_currency,
                  settlement_amount_minor, settlement_currency, subtotal_minor,
                  provider, method, stripe_payment_intent_id, paypal_capture_id,
                  quaderno_invoice_id, status AS pay_status,
                  ROW_NUMBER() OVER (
                    PARTITION BY registration_id
                    ORDER BY created_at DESC, id DESC
                  ) AS rn
             FROM workshop_payments
            WHERE status IN ('paid','refunded')
         ) p ON p.registration_id = r.id AND p.rn = 1`;

// Columns every workshop path needs to money-up a row.
const WORKSHOP_MONEY_COLS = `r.id, r.created_at, r.payment_status, r.country,
              r.currency AS reg_currency,
              p.amount_minor, p.pay_currency, p.settlement_amount_minor,
              p.settlement_currency, p.subtotal_minor, p.pay_status`;

type WorkshopMoneyRow = {
  id: number;
  created_at: string;
  payment_status: string;
  country: string | null;
  reg_currency: string | null;
  // Joined payment (all null when the registration never paid).
  amount_minor: number | null;
  pay_currency: string | null;
  settlement_amount_minor: number | null;
  settlement_currency: string | null;
  subtotal_minor: number | null;
  pay_status: string | null;
};

type WorkshopRow = WorkshopMoneyRow & {
  name: string | null;
  email: string;
  wants_bump: number;
  workshop_title: string | null;
  provider: string | null;
  method: string | null;
  stripe_payment_intent_id: string | null;
  paypal_capture_id: string | null;
  quaderno_invoice_id: string | null;
};

function workshopWhere(scope: Scope): Clause {
  if (scope.ids) return andWhere([idsClause('r.id', scope.ids)]);
  const f = scope.filter ?? {};
  const q = scopeQuery(scope);
  let search: Clause | null = null;
  if (q) {
    search = likeAny(['r.email', 'r.name', 'w.title', `'w-' || r.id`], q);
    // The label a bump order shows is "<title> + bump", which exists only in JS.
    if ('+ bump'.includes(q)) search = { sql: `${search.sql} OR r.wants_bump = 1`, binds: search.binds };
  }
  return andWhere([
    statusClause('r.payment_status', f.statuses ?? []),
    f.email ? emailClause('r.email', f.email) : null,
    search,
  ]);
}

// Live eservice VAT for the rare paid rows with no stored tax split, so we can
// still strip VAT from the gross instead of overstating net.
function workshopRates(rows: WorkshopMoneyRow[], opts: OrderMoneyOpts) {
  return resolveEserviceRates(
    rows
      .filter((r) => r.pay_status != null && r.subtotal_minor == null)
      .map((r) => eserviceCountry(r.country, 'EUR')),
    opts.quaderno,
  );
}

// Gross → EUR net for one workshop row, shared by the index + full loaders.
function workshopMoney(
  r: WorkshopMoneyRow,
  rateByCountry: Map<string, number>,
  fxRates: Record<string, number>,
): {
  originalAmountMinor: number;
  originalCurrency: string;
  netEurMinor: number | null;
  netKind: NetKind;
  refundedMinor: number;
} {
  let originalAmountMinor = 0;
  let originalCurrency = (r.reg_currency || 'EUR').toUpperCase();
  let netEurMinor: number | null = null;
  let netKind: NetKind = 'none';
  let refundedMinor = 0;

  if (r.pay_status != null) {
    const amountMinor = r.amount_minor ?? 0;
    originalAmountMinor = amountMinor;
    originalCurrency = (r.pay_currency || originalCurrency).toUpperCase();
    // Gross in EUR: prefer the exact EUR settlement, else convert the charge.
    let fx = false;
    let grossEur: number | null = null;
    if (r.settlement_currency === 'EUR' && r.settlement_amount_minor != null) {
      grossEur = r.settlement_amount_minor;
    } else {
      const eur = toEurMinor(amountMinor, r.pay_currency ?? 'EUR', fxRates);
      if (eur) {
        grossEur = eur.minor;
        fx = eur.fx;
      }
    }
    if (grossEur != null) {
      if (r.subtotal_minor != null && amountMinor > 0) {
        // Exact tax split captured at checkout, scaled to the EUR gross.
        netEurMinor = Math.round(r.subtotal_minor * (grossEur / amountMinor));
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
    if (r.pay_status === 'refunded') refundedMinor = amountMinor;
  }

  return { originalAmountMinor, originalCurrency, netEurMinor, netKind, refundedMinor };
}

async function loadWorkshopIndex(
  db: D1Database,
  opts: OrderMoneyOpts,
  scope: Scope,
): Promise<OrderIndexRow[]> {
  const fxRates = opts.fxRates ?? DEFAULT_FX_TO_EUR;
  const w = workshopWhere(scope);
  const res = await run<WorkshopMoneyRow>(
    db,
    `SELECT ${WORKSHOP_MONEY_COLS} ${WORKSHOP_FROM} ${w.sql}`,
    w.binds,
  );
  const rows = res.results ?? [];
  const rateByCountry = await workshopRates(rows, opts);
  return rows.map((r) => {
    const money = workshopMoney(r, rateByCountry, fxRates);
    return {
      source: 'workshop' as const,
      rowId: r.id,
      createdAt: r.created_at,
      statusClass: statusClassOf(r.payment_status),
      netEurMinor: money.netEurMinor,
      refundedMinor: money.refundedMinor,
    };
  });
}

async function loadWorkshopOrders(
  db: D1Database,
  opts: OrderMoneyOpts,
  scope: Scope,
): Promise<UnifiedOrder[]> {
  const fxRates = opts.fxRates ?? DEFAULT_FX_TO_EUR;
  const w = workshopWhere(scope);
  const res = await run<WorkshopRow>(
    db,
    `SELECT ${WORKSHOP_MONEY_COLS},
              r.name, r.email, r.wants_bump, w.title AS workshop_title,
              p.provider, p.method, p.stripe_payment_intent_id,
              p.paypal_capture_id, p.quaderno_invoice_id
         ${WORKSHOP_FROM} ${w.sql}`,
    w.binds,
  );
  const regs = res.results ?? [];
  if (!regs.length) return [];
  const rateByCountry = await workshopRates(regs, opts);

  return regs.map((r) => {
    const { first, last } = splitName(r.name);
    const label =
      (r.workshop_title ?? 'Workshop') + (r.wants_bump === 1 ? ' + bump' : '');
    const { originalAmountMinor, originalCurrency, netEurMinor, netKind, refundedMinor } =
      workshopMoney(r, rateByCountry, fxRates);

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
      provider: r.provider === 'paypal' ? 'paypal' : 'stripe',
      paymentMethod: r.method ?? null,
      paymentIntent: r.stripe_payment_intent_id ?? null,
      stripeSubscriptionId: null,
      paypalCaptureId: r.paypal_capture_id ?? null,
      paypalSubscriptionId: null,
      quadernoInvoiceId: r.quaderno_invoice_id ?? null,
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
  // Exact (case-insensitive) buyer address — the /admin/people view.
  email?: string | null;
};

// One row per matching order, carrying only what the overview needs to sort,
// count and money-total it. Cheap enough to pull for the whole filtered set;
// the page then hydrates just the slice it renders.
export type OrderIndexRow = {
  source: OrderSource;
  rowId: number;
  createdAt: string;
  statusClass: StatusClass;
  netEurMinor: number | null;
  refundedMinor: number;
};

const ALL_SOURCES: OrderSource[] = ['retreat', 'course', 'workshop'];

function sourcesOf(filter: OrderFilter): OrderSource[] {
  const wanted = filter.sources ?? [];
  return wanted.length ? ALL_SOURCES.filter((s) => wanted.includes(s)) : ALL_SOURCES;
}

// Newest first, with a stable tie-break so page boundaries can't wobble between
// requests when two orders share a timestamp.
function byNewest(
  a: { createdAt: string; source: OrderSource; rowId: number },
  b: { createdAt: string; source: OrderSource; rowId: number },
): number {
  const t = (b.createdAt || '').localeCompare(a.createdAt || '');
  if (t !== 0) return t;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  return b.rowId - a.rowId;
}

const INDEX_LOADERS: Record<
  OrderSource,
  (db: D1Database, opts: OrderMoneyOpts, scope: Scope) => Promise<OrderIndexRow[]>
> = {
  retreat: loadRetreatIndex,
  course: loadCourseIndex,
  workshop: loadWorkshopIndex,
};

const FULL_LOADERS: Record<
  OrderSource,
  (db: D1Database, opts: OrderMoneyOpts, scope: Scope) => Promise<UnifiedOrder[]>
> = {
  retreat: loadRetreatOrders,
  course: loadCourseOrders,
  workshop: loadWorkshopOrders,
};

// D1 caps a statement at 100 bound parameters, so hydrate ids in batches.
const ID_CHUNK = 90;

async function hydrate(
  db: D1Database,
  source: OrderSource,
  ids: number[],
  money: OrderMoneyOpts,
): Promise<UnifiedOrder[]> {
  const out: UnifiedOrder[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    out.push(
      ...(await FULL_LOADERS[source](db, money, { ids: ids.slice(i, i + ID_CHUNK) })),
    );
  }
  return out;
}

export type OrdersPage = {
  // Just the requested page, newest first.
  orders: UnifiedOrder[];
  page: number;
  perPage: number;
  pageCount: number;
  // Totals over the WHOLE filtered set, not the page — so the summary tiles
  // keep meaning what they always meant.
  total: number;
  paidCount: number;
  netEurPaidMinor: number;
  refundedMinor: number;
};

export const ORDERS_PER_PAGE_OPTIONS = [25, 50, 100, 200] as const;
export const DEFAULT_ORDERS_PER_PAGE = 50;

// One page of the order overview. Two passes: a narrow index over every
// matching row (for the count, the sort and the money totals), then a full
// hydration of only the rows on this page — instead of loading, mapping and
// rendering every order the site has ever taken.
export async function listOrdersPage(
  db: D1Database,
  filter: OrderFilter = {},
  money: OrderMoneyOpts = {},
  paging: { page?: number; perPage?: number } = {},
): Promise<OrdersPage> {
  const perPage = Math.min(
    200,
    Math.max(10, Math.floor(paging.perPage ?? DEFAULT_ORDERS_PER_PAGE)),
  );
  const sources = sourcesOf(filter);
  const index = (
    await Promise.all(
      sources.map((s) => INDEX_LOADERS[s](db, money, { filter })),
    )
  ).flat();
  index.sort(byNewest);

  const total = index.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(pageCount, Math.max(1, Math.floor(paging.page ?? 1)));
  const slice = index.slice((page - 1) * perPage, page * perPage);

  const idsBySource = new Map<OrderSource, number[]>();
  for (const row of slice) {
    const list = idsBySource.get(row.source);
    if (list) list.push(row.rowId);
    else idsBySource.set(row.source, [row.rowId]);
  }
  const hydrated = (
    await Promise.all(
      [...idsBySource].map(([source, ids]) => hydrate(db, source, ids, money)),
    )
  ).flat();
  const bySourceId = new Map(hydrated.map((o) => [`${o.source}:${o.rowId}`, o]));

  return {
    orders: slice
      .map((r) => bySourceId.get(`${r.source}:${r.rowId}`))
      .filter((o): o is UnifiedOrder => !!o),
    page,
    perPage,
    pageCount,
    total,
    paidCount: index.filter((r) => r.statusClass === 'paid').length,
    netEurPaidMinor: index.reduce(
      (s, r) => s + (r.statusClass === 'paid' ? r.netEurMinor ?? 0 : 0),
      0,
    ),
    refundedMinor: index.reduce((s, r) => s + r.refundedMinor, 0),
  };
}

// Every matching order across the three stores, newest first. Filtering happens
// in SQL; `money` supplies the FX rates + Quaderno config used to compute each
// order's EUR net — omit it (e.g. the refund route, which only needs amounts in
// the charge currency) and net falls back to the seed FX table with no VAT
// lookups. Prefer `listOrdersPage` for anything user-facing: this walks the
// whole result set.
export async function listAllOrders(
  db: D1Database,
  filter: OrderFilter = {},
  money: OrderMoneyOpts = {},
): Promise<UnifiedOrder[]> {
  const loaded = await Promise.all(
    sourcesOf(filter).map((s) => FULL_LOADERS[s](db, money, { filter })),
  );
  return loaded.flat().sort(byNewest);
}

// A single order by its "R-12" / "C-7" / "W-90" number — one indexed row read,
// never the whole table.
export async function findOrder(
  db: D1Database,
  orderNo: string,
  money: OrderMoneyOpts = {},
): Promise<UnifiedOrder | null> {
  const parsed = parseOrderNo(orderNo);
  if (!parsed) return null;
  const rows = await FULL_LOADERS[parsed.source](db, money, { ids: [parsed.id] });
  return rows[0] ?? null;
}

// Normalise the stored provider string. Only the retreat checkouts write
// 'bank_transfer'; anything unrecognised stays Stripe, as it always did.
function orderProviderOf(raw: string | null | undefined): OrderProvider {
  if (raw === 'paypal') return 'paypal';
  if (raw === BANK_TRANSFER) return BANK_TRANSFER;
  return 'stripe';
}

// Remaining refundable amount (minor units, in the order's own currency).
export function refundableMinor(o: UnifiedOrder): number {
  return Math.max(0, o.originalAmountMinor - o.refundedMinor);
}

// Can this order be refunded from the admin? Needs a charge to target (a Stripe
// PaymentIntent or a PayPal capture/sale id), a positive amount, and money still
// left to give back.
export function isRefundable(o: UnifiedOrder): boolean {
  // A manual IBAN transfer has no charge to reverse — the refund goes back
  // out of the bank account by hand, not through this button. (Its
  // payment_intent is the synthetic `manual-<id>` the admin mark-paid
  // stamps, which no gateway would recognise.)
  if (o.provider === BANK_TRANSFER) return false;
  // An installment plan's charges live at the gateway, keyed by its
  // subscription — the row only ever stores the first one (and sometimes not
  // even that, when Stripe's invoice shape hid the PaymentIntent). The
  // subscription id is target enough: lib/admin/installments.ts enumerates the
  // cycles from it, and each one is refundable on its own. Kept inline rather
  // than importing hasInstallmentLedger, so this module stays leaf-level.
  const hasPlan =
    o.source === 'course' &&
    o.installmentsTotal > 1 &&
    !!(o.stripeSubscriptionId || o.paypalSubscriptionId);
  const hasTarget =
    hasPlan || (o.provider === 'paypal' ? !!o.paypalCaptureId : !!o.paymentIntent);
  return (
    hasTarget &&
    o.originalAmountMinor > 0 &&
    refundableMinor(o) > 0 &&
    o.statusClass !== 'pending'
  );
}
