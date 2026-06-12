// Statistics + ROAS for the workshop engine, plus standalone course sales.
//
// All money is reported in EUR minor units. The EUR conversion mirrors the
// legacy stats: gross EUR = the Stripe settlement amount (payout currency),
// and net-of-tax EUR = subtotal * (settlement / amount). Per-payment totals
// are split across ticket / masterclass / bump / course using the purchases
// line-item shares. Masterclass tickets are classified by the product slug
// (`svh-masterclass`) and split out of the regular ticket bucket.
//
// Standalone course sales (12-week, certification, grief) live in
// `course_registrations`, which has no Stripe settlement or tax data — those
// figures are the charged amount converted with the FX_TO_EUR fallback table
// (gross of any VAT), attributed to the day of `paid_at`.

import { FX_TO_EUR } from './currency';

export const MASTERCLASS_PRODUCT_SLUG = 'svh-masterclass';

type PaymentRow = {
  id: number;
  registration_id: number;
  status: string;
  amount_minor: number;
  currency: string;
  settlement_amount_minor: number | null;
  settlement_currency: string | null;
  fx_rate: number | null;
  subtotal_minor: number | null;
  tax_minor: number | null;
  created_at: string;
};

type PurchaseRow = {
  payment_id: number | null;
  product_type: string;
  product_id: number;
  amount_minor: number;
  slug: string | null;
};

export type StatsTotals = {
  grossEurMinor: number;
  netEurMinor: number; // tax-excluded, all product types (incl. masterclass)
  taxEurMinor: number;
  ticketNetEurMinor: number; // regular workshop tickets, masterclass excluded
  masterclassNetEurMinor: number;
  bumpNetEurMinor: number;
  courseNetEurMinor: number; // course add-ons sold through workshop checkout
  ticketCount: number;
  masterclassCount: number;
  bumpCount: number;
  courseCount: number;
  paidCount: number;
  flaggedNoTax: number; // rows where we fell back to net = gross
};

export type DailyStat = {
  date: string; // YYYY-MM-DD (UTC)
  grossEurMinor: number;
  netEurMinor: number;
  ticketNetEurMinor: number;
  masterclassNetEurMinor: number;
  bumpNetEurMinor: number;
  courseNetEurMinor: number;
  adSpendEurMinor: number;
  roas: number | null;
};

export type StatsReport = {
  totals: StatsTotals;
  daily: DailyStat[];
  adSpendEurMinor: number;
  roas: number | null;
  courseBreakdown: Array<{ product_id: number; count: number; netEurMinor: number }>;
};

// Gross EUR for a payment: prefer the EUR settlement; otherwise best-effort.
function grossEurMinor(p: PaymentRow): number {
  if (p.settlement_amount_minor != null && p.settlement_currency === 'EUR') {
    return p.settlement_amount_minor;
  }
  if (p.currency === 'EUR') return p.amount_minor;
  // Settlement in a non-EUR payout currency, or missing — fall back to the
  // charged amount. (Single-payout-currency accounts never hit this.)
  return p.settlement_amount_minor ?? p.amount_minor;
}

function netEurMinor(p: PaymentRow, grossEur: number): { net: number; flagged: boolean } {
  if (p.subtotal_minor != null && p.amount_minor > 0) {
    return { net: Math.round(p.subtotal_minor * (grossEur / p.amount_minor)), flagged: false };
  }
  return { net: grossEur, flagged: true };
}

export async function computeStats(
  db: D1Database,
  opts: { from?: string | null; to?: string | null; workshopId?: number | null } = {},
): Promise<StatsReport> {
  const where: string[] = ["p.status = 'paid'"];
  const binds: unknown[] = [];
  if (opts.from) {
    where.push('p.created_at >= ?');
    binds.push(opts.from);
  }
  if (opts.to) {
    where.push('p.created_at <= ?');
    binds.push(`${opts.to} 23:59:59`);
  }
  if (opts.workshopId) {
    where.push('r.workshop_id = ?');
    binds.push(opts.workshopId);
  }

  const pRes = await db
    .prepare(
      `SELECT p.* FROM workshop_payments p
         JOIN workshop_registrations r ON r.id = p.registration_id
        WHERE ${where.join(' AND ')}`,
    )
    .bind(...binds)
    .all<PaymentRow>();
  const payments = pRes.results ?? [];

  // Purchases for those payments (with product slug, to spot masterclass
  // tickets), grouped by payment_id.
  const byPayment = new Map<number, PurchaseRow[]>();
  if (payments.length) {
    const ids = payments.map((p) => p.id);
    const placeholders = ids.map(() => '?').join(',');
    const purRes = await db
      .prepare(
        `SELECT pur.payment_id, pur.product_type, pur.product_id, pur.amount_minor, prod.slug
           FROM workshop_purchases pur
           LEFT JOIN workshop_products prod ON prod.id = pur.product_id
          WHERE pur.payment_id IN (${placeholders})`,
      )
      .bind(...ids)
      .all<PurchaseRow>();
    for (const pur of purRes.results ?? []) {
      if (pur.payment_id == null) continue;
      const arr = byPayment.get(pur.payment_id) ?? [];
      arr.push(pur);
      byPayment.set(pur.payment_id, arr);
    }
  }

  const totals: StatsTotals = {
    grossEurMinor: 0, netEurMinor: 0, taxEurMinor: 0,
    ticketNetEurMinor: 0, masterclassNetEurMinor: 0, bumpNetEurMinor: 0, courseNetEurMinor: 0,
    ticketCount: 0, masterclassCount: 0, bumpCount: 0, courseCount: 0,
    paidCount: 0, flaggedNoTax: 0,
  };
  type DayAcc = { gross: number; net: number; ticket: number; masterclass: number; bump: number; course: number };
  const dailyMap = new Map<string, DayAcc>();
  const courseMap = new Map<number, { count: number; net: number }>();

  for (const p of payments) {
    const gross = grossEurMinor(p);
    const { net, flagged } = netEurMinor(p, gross);
    totals.grossEurMinor += gross;
    totals.netEurMinor += net;
    totals.taxEurMinor += gross - net;
    totals.paidCount += 1;
    if (flagged) totals.flaggedNoTax += 1;

    const date = (p.created_at || '').slice(0, 10);
    const d = dailyMap.get(date) ?? { gross: 0, net: 0, ticket: 0, masterclass: 0, bump: 0, course: 0 };
    d.gross += gross;
    d.net += net;

    // Allocate the payment's net across its line items by charged-amount share.
    const lines = byPayment.get(p.id) ?? [];
    const lineTotal = lines.reduce((s, l) => s + l.amount_minor, 0) || p.amount_minor;
    for (const l of lines) {
      const share = lineTotal > 0 ? l.amount_minor / lineTotal : 0;
      const lineNet = Math.round(net * share);
      if (l.product_type === 'ticket') {
        if (l.slug === MASTERCLASS_PRODUCT_SLUG) {
          totals.masterclassNetEurMinor += lineNet;
          totals.masterclassCount += 1;
          d.masterclass += lineNet;
        } else {
          totals.ticketNetEurMinor += lineNet;
          totals.ticketCount += 1;
          d.ticket += lineNet;
        }
      } else if (l.product_type === 'bump') {
        totals.bumpNetEurMinor += lineNet;
        totals.bumpCount += 1;
        d.bump += lineNet;
      } else if (l.product_type === 'course') {
        totals.courseNetEurMinor += lineNet;
        totals.courseCount += 1;
        d.course += lineNet;
        const c = courseMap.get(l.product_id) ?? { count: 0, net: 0 };
        c.count += 1;
        c.net += lineNet;
        courseMap.set(l.product_id, c);
      }
    }
    dailyMap.set(date, d);
  }

  // Ad spend over the same window.
  const adWhere: string[] = [];
  const adBinds: unknown[] = [];
  if (opts.from) { adWhere.push('spend_date >= ?'); adBinds.push(opts.from); }
  if (opts.to) { adWhere.push('spend_date <= ?'); adBinds.push(opts.to); }
  const adRes = await db
    .prepare(
      `SELECT spend_date, amount_eur_minor, amount_minor, currency FROM workshop_ad_spend
        ${adWhere.length ? 'WHERE ' + adWhere.join(' AND ') : ''}`,
    )
    .bind(...adBinds)
    .all<{ spend_date: string; amount_eur_minor: number | null; amount_minor: number; currency: string }>();

  let adSpendEurMinor = 0;
  const adByDate = new Map<string, number>();
  for (const a of adRes.results ?? []) {
    const eur = a.amount_eur_minor ?? (a.currency === 'EUR' ? a.amount_minor : 0);
    adSpendEurMinor += eur;
    adByDate.set(a.spend_date, (adByDate.get(a.spend_date) ?? 0) + eur);
  }

  // Daily table merges revenue + ad spend dates.
  const allDates = new Set<string>([...dailyMap.keys(), ...adByDate.keys()]);
  const daily: DailyStat[] = [...allDates]
    .sort()
    .map((date) => {
      const rev = dailyMap.get(date) ?? { gross: 0, net: 0, ticket: 0, masterclass: 0, bump: 0, course: 0 };
      const spend = adByDate.get(date) ?? 0;
      return {
        date,
        grossEurMinor: rev.gross,
        netEurMinor: rev.net,
        ticketNetEurMinor: rev.ticket,
        masterclassNetEurMinor: rev.masterclass,
        bumpNetEurMinor: rev.bump,
        courseNetEurMinor: rev.course,
        adSpendEurMinor: spend,
        roas: spend > 0 ? rev.net / spend : null,
      };
    });

  return {
    totals,
    daily,
    adSpendEurMinor,
    roas: adSpendEurMinor > 0 ? totals.netEurMinor / adSpendEurMinor : null,
    courseBreakdown: [...courseMap.entries()].map(([product_id, v]) => ({
      product_id,
      count: v.count,
      netEurMinor: v.net,
    })),
  };
}

// ---------------------------------------------------------------------------
// Standalone course sales (course_registrations): 12-week, certification,
// grief. Sold outside the workshop engine, so no settlement/tax data —
// figures are charged amounts (gross of VAT) at fallback FX rates.

export type CourseGroup = 'twelve_week' | 'certification' | 'other';

const COURSE_PRODUCT_INFO: Record<string, { group: CourseGroup; label: string }> = {
  'svh-12week': { group: 'twelve_week', label: '12-Week SVH Course' },
  'cc-cert': { group: 'certification', label: 'Certification — cert only' },
  'cc-bundle': { group: 'certification', label: 'Certification — Foundation + Cert bundle' },
  'grief-course': { group: 'other', label: 'The Grief Course' },
};

export type CourseDailyStat = {
  date: string; // YYYY-MM-DD (UTC, from paid_at)
  twelveWeekEurMinor: number;
  certificationEurMinor: number;
  otherEurMinor: number;
};

export type CourseSalesReport = {
  twelveWeek: { count: number; netEurMinor: number };
  certification: { count: number; netEurMinor: number };
  other: { count: number; netEurMinor: number };
  totalCount: number;
  totalNetEurMinor: number;
  byProduct: Array<{ slug: string; label: string; group: CourseGroup; count: number; netEurMinor: number }>;
  daily: CourseDailyStat[];
  fxConverted: number; // rows converted to EUR with the fallback rate table
};

type CourseRegRow = {
  product_slug: string;
  amount_cents: number;
  currency: string;
  payment_plan: string;
  installments_paid: number;
  installments_total: number;
  refunded_amount_cents: number;
  paid_at: string;
};

export async function computeCourseSales(
  db: D1Database,
  opts: { from?: string | null; to?: string | null } = {},
): Promise<CourseSalesReport> {
  // Anything that ever collected money: paid, plus refunded/cancelled rows
  // (a cancelled 3x sub keeps the installments it already collected; the
  // refunded amount is subtracted below).
  const where: string[] = ['paid_at IS NOT NULL', "status NOT IN ('pending','expired')"];
  const binds: unknown[] = [];
  if (opts.from) { where.push('paid_at >= ?'); binds.push(opts.from); }
  if (opts.to) { where.push('paid_at <= ?'); binds.push(`${opts.to} 23:59:59`); }

  const res = await db
    .prepare(
      `SELECT product_slug, amount_cents, currency, payment_plan,
              installments_paid, installments_total, refunded_amount_cents, paid_at
         FROM course_registrations
        WHERE ${where.join(' AND ')}`,
    )
    .bind(...binds)
    .all<CourseRegRow>();

  const report: CourseSalesReport = {
    twelveWeek: { count: 0, netEurMinor: 0 },
    certification: { count: 0, netEurMinor: 0 },
    other: { count: 0, netEurMinor: 0 },
    totalCount: 0,
    totalNetEurMinor: 0,
    byProduct: [],
    daily: [],
    fxConverted: 0,
  };
  const productMap = new Map<string, { count: number; net: number }>();
  const dailyMap = new Map<string, { tw: number; cert: number; other: number }>();

  for (const r of res.results ?? []) {
    // Amount actually collected: 3x plans bill monthly, so scale the total by
    // installments paid; one-off plans collected the full amount. Refunds
    // (full or partial) come straight off.
    const expected =
      r.payment_plan === '3x' && r.installments_total > 0
        ? Math.round(r.amount_cents * (r.installments_paid / r.installments_total))
        : r.amount_cents;
    const collected = Math.max(0, expected - (r.refunded_amount_cents ?? 0));

    const cur = (r.currency || 'EUR').toUpperCase();
    const rate = FX_TO_EUR[cur] ?? 1;
    if (cur !== 'EUR') report.fxConverted += 1;
    const eurMinor = Math.round(collected * rate);

    const info = COURSE_PRODUCT_INFO[r.product_slug] ?? { group: 'other' as const, label: r.product_slug };
    const bucket =
      info.group === 'twelve_week' ? report.twelveWeek :
      info.group === 'certification' ? report.certification : report.other;
    bucket.count += 1;
    bucket.netEurMinor += eurMinor;
    report.totalCount += 1;
    report.totalNetEurMinor += eurMinor;

    const p = productMap.get(r.product_slug) ?? { count: 0, net: 0 };
    p.count += 1;
    p.net += eurMinor;
    productMap.set(r.product_slug, p);

    const date = (r.paid_at || '').slice(0, 10);
    const d = dailyMap.get(date) ?? { tw: 0, cert: 0, other: 0 };
    if (info.group === 'twelve_week') d.tw += eurMinor;
    else if (info.group === 'certification') d.cert += eurMinor;
    else d.other += eurMinor;
    dailyMap.set(date, d);
  }

  report.byProduct = [...productMap.entries()]
    .map(([slug, v]) => {
      const info = COURSE_PRODUCT_INFO[slug] ?? { group: 'other' as const, label: slug };
      return { slug, label: info.label, group: info.group, count: v.count, netEurMinor: v.net };
    })
    .sort((a, b) => b.netEurMinor - a.netEurMinor);

  report.daily = [...dailyMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({
      date,
      twelveWeekEurMinor: v.tw,
      certificationEurMinor: v.cert,
      otherEurMinor: v.other,
    }));

  return report;
}

// ---------------------------------------------------------------------------
// Per-workshop performance: the registration → attendance → course-purchase
// funnel, one row per workshop. Course/cert purchases are attributed by email
// (engine add-ons through any workshop checkout, plus standalone
// course_registrations), so a buyer who registered for several workshops
// counts toward each of them.

export type WorkshopPerformanceRow = {
  workshopId: number;
  title: string;
  startsAtUtc: string;
  isReplay: boolean;
  status: string;
  registrations: number; // paid or coupon
  attendedLive: number;
  replayViews: number;
  noShows: number;
  attendancePct: number | null;
  bumpBuys: number;
  courseBuys: number; // 12-week (engine add-on + standalone, distinct emails)
  certBuys: number; // certification path (engine cert add-on + standalone cc-*)
  engineNetEurMinor: number; // tickets + bumps + add-ons through this workshop
  attributedCourseEurMinor: number; // standalone 12-week/cert revenue by registrant email
  totalEurMinor: number;
  metaCostEurMinor: number | null;
  conversionPct: number | null; // distinct course/cert buyers ÷ registrations
};

export type WorkshopPerformanceReport = {
  rows: WorkshopPerformanceRow[];
  adSpendEurMinor: number;
  totalRegistrations: number;
  costPerRegistrationEurMinor: number | null;
};

// Stored datetimes come in two shapes: ISO with "Z" (workshop times) and
// SQLite's "YYYY-MM-DD HH:MM:SS" (row timestamps, also UTC).
function parseUtcMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const ms = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? ms : null;
}

export async function computeWorkshopPerformance(
  db: D1Database,
  opts: { from?: string | null; to?: string | null } = {},
): Promise<WorkshopPerformanceReport> {
  const winFrom = opts.from ?? null;
  const winTo = opts.to ? `${opts.to} 23:59:59` : null;
  const win = (col: string, binds: unknown[]): string => {
    const parts: string[] = [];
    if (winFrom) { parts.push(`${col} >= ?`); binds.push(winFrom); }
    if (winTo) { parts.push(`${col} <= ?`); binds.push(winTo); }
    return parts.length ? ' AND ' + parts.join(' AND ') : '';
  };

  const wRes = await db
    .prepare(
      `SELECT id, title, starts_at_utc, ends_at_utc, is_replay, status
         FROM workshops WHERE deleted = 0 ORDER BY starts_at_utc DESC`,
    )
    .all<{ id: number; title: string; starts_at_utc: string; ends_at_utc: string | null; is_replay: number; status: string }>();
  const workshopRows = wRes.results ?? [];

  // Completed registrations (paid or coupon) in the window.
  const regBinds: unknown[] = [];
  const regRes = await db
    .prepare(
      `SELECT workshop_id, lower(email) AS email, attendance_status, joined_at_utc
         FROM workshop_registrations
        WHERE payment_status IN ('paid','coupon')${win('created_at', regBinds)}`,
    )
    .bind(...regBinds)
    .all<{ workshop_id: number; email: string; attendance_status: string; joined_at_utc: string | null }>();

  // Bump purchases (paid) per workshop.
  const bumpBinds: unknown[] = [];
  const bumpRes = await db
    .prepare(
      `SELECT r.workshop_id, COUNT(DISTINCT pur.registration_id) AS n
         FROM workshop_purchases pur
         JOIN workshop_payments p ON p.id = pur.payment_id AND p.status = 'paid'
         JOIN workshop_registrations r ON r.id = pur.registration_id
        WHERE pur.product_type = 'bump'${win('p.created_at', bumpBinds)}
        GROUP BY r.workshop_id`,
    )
    .bind(...bumpBinds)
    .all<{ workshop_id: number; n: number }>();
  const bumpByWorkshop = new Map((bumpRes.results ?? []).map((b) => [b.workshop_id, b.n]));

  // Engine course add-on buyers (paid) with slug, per workshop.
  const addonBinds: unknown[] = [];
  const addonRes = await db
    .prepare(
      `SELECT r.workshop_id, lower(r.email) AS email, prod.slug AS slug
         FROM workshop_purchases pur
         JOIN workshop_payments p ON p.id = pur.payment_id AND p.status = 'paid'
         JOIN workshop_registrations r ON r.id = pur.registration_id
         JOIN workshop_products prod ON prod.id = pur.product_id
        WHERE pur.product_type = 'course'${win('p.created_at', addonBinds)}`,
    )
    .bind(...addonBinds)
    .all<{ workshop_id: number; email: string; slug: string }>();

  // Engine revenue (net EUR) per workshop.
  const payBinds: unknown[] = [];
  const payRes = await db
    .prepare(
      `SELECT r.workshop_id, p.amount_minor, p.currency, p.settlement_amount_minor,
              p.settlement_currency, p.subtotal_minor
         FROM workshop_payments p
         JOIN workshop_registrations r ON r.id = p.registration_id
        WHERE p.status = 'paid'${win('p.created_at', payBinds)}`,
    )
    .bind(...payBinds)
    .all<{
      workshop_id: number; amount_minor: number; currency: string;
      settlement_amount_minor: number | null; settlement_currency: string | null;
      subtotal_minor: number | null;
    }>();

  // Standalone course buyers by email: 12-week + certification path, with
  // collected EUR (installments paid only, refunds off, fallback FX).
  const crsBinds: unknown[] = [];
  const crsRes = await db
    .prepare(
      `SELECT lower(email) AS email, product_slug, amount_cents, currency, payment_plan,
              installments_paid, installments_total, refunded_amount_cents
         FROM course_registrations
        WHERE paid_at IS NOT NULL AND status NOT IN ('pending','expired')${win('paid_at', crsBinds)}`,
    )
    .bind(...crsBinds)
    .all<CourseRegRow & { email: string }>();
  const standalone = new Map<string, { tw: boolean; cert: boolean; eurMinor: number }>();
  for (const r of crsRes.results ?? []) {
    const isTw = r.product_slug === 'svh-12week';
    const isCert = r.product_slug === 'cc-cert' || r.product_slug === 'cc-bundle';
    if (!isTw && !isCert) continue;
    const expected =
      r.payment_plan === '3x' && r.installments_total > 0
        ? Math.round(r.amount_cents * (r.installments_paid / r.installments_total))
        : r.amount_cents;
    const collected = Math.max(0, expected - (r.refunded_amount_cents ?? 0));
    const eurMinor = Math.round(collected * (FX_TO_EUR[(r.currency || 'EUR').toUpperCase()] ?? 1));
    const s = standalone.get(r.email) ?? { tw: false, cert: false, eurMinor: 0 };
    if (isTw) s.tw = true;
    if (isCert) s.cert = true;
    s.eurMinor += eurMinor;
    standalone.set(r.email, s);
  }

  // Ad spend over the window → average cost per completed registration.
  const adBinds: unknown[] = [];
  const adWhere: string[] = [];
  if (opts.from) { adWhere.push('spend_date >= ?'); adBinds.push(opts.from); }
  if (opts.to) { adWhere.push('spend_date <= ?'); adBinds.push(opts.to); }
  const adRes = await db
    .prepare(
      `SELECT amount_eur_minor, amount_minor, currency FROM workshop_ad_spend
        ${adWhere.length ? 'WHERE ' + adWhere.join(' AND ') : ''}`,
    )
    .bind(...adBinds)
    .all<{ amount_eur_minor: number | null; amount_minor: number; currency: string }>();
  let adSpendEurMinor = 0;
  for (const a of adRes.results ?? []) {
    adSpendEurMinor += a.amount_eur_minor ?? (a.currency === 'EUR' ? a.amount_minor : 0);
  }

  // ---- Aggregate per workshop ----
  type Acc = {
    regs: number; emails: Set<string>;
    live: number; replay: number; noShow: number;
    engineTw: Set<string>; engineCert: Set<string>;
    netEurMinor: number;
  };
  const accs = new Map<number, Acc>();
  const acc = (id: number): Acc => {
    let a = accs.get(id);
    if (!a) {
      a = { regs: 0, emails: new Set(), live: 0, replay: 0, noShow: 0, engineTw: new Set(), engineCert: new Set(), netEurMinor: 0 };
      accs.set(id, a);
    }
    return a;
  };
  const endMsByWorkshop = new Map<number, { endMs: number | null; isReplay: boolean }>();
  for (const w of workshopRows) {
    const startMs = parseUtcMs(w.starts_at_utc);
    const endMs = parseUtcMs(w.ends_at_utc) ?? (startMs != null ? startMs + 3600_000 : null);
    endMsByWorkshop.set(w.id, { endMs, isReplay: w.is_replay === 1 });
  }

  for (const r of regRes.results ?? []) {
    const a = acc(r.workshop_id);
    a.regs += 1;
    a.emails.add(r.email);
    if (r.attendance_status === 'no_show') {
      a.noShow += 1;
    } else if (r.attendance_status === 'attended') {
      const w = endMsByWorkshop.get(r.workshop_id);
      const joinedMs = parseUtcMs(r.joined_at_utc);
      // Replay view: an on-demand workshop, or a join after the live slot
      // ended. Admin-marked attendance with no join time counts as live.
      const isReplayView = w?.isReplay || (joinedMs != null && w?.endMs != null && joinedMs > w.endMs);
      if (isReplayView) a.replay += 1;
      else a.live += 1;
    }
  }
  for (const c of addonRes.results ?? []) {
    const a = acc(c.workshop_id);
    if (c.slug === '12w-course') a.engineTw.add(c.email);
    if (c.slug === 'cert-course') a.engineCert.add(c.email);
  }
  for (const p of payRes.results ?? []) {
    const slim = p as unknown as PaymentRow;
    const gross = grossEurMinor(slim);
    acc(p.workshop_id).netEurMinor += netEurMinor(slim, gross).net;
  }

  const totalRegistrations = [...accs.values()].reduce((s, a) => s + a.regs, 0);
  const costPerRegistrationEurMinor =
    adSpendEurMinor > 0 && totalRegistrations > 0 ? adSpendEurMinor / totalRegistrations : null;

  // One row per non-deleted workshop — including those with no activity yet,
  // so the page mirrors the workshop list rather than hiding empty ones.
  const emptyAcc: Acc = { regs: 0, emails: new Set(), live: 0, replay: 0, noShow: 0, engineTw: new Set(), engineCert: new Set(), netEurMinor: 0 };
  const rows: WorkshopPerformanceRow[] = workshopRows.map((w) => {
    const a = accs.get(w.id) ?? emptyAcc;
    const courseBuyers = new Set(a.engineTw);
    const certBuyers = new Set(a.engineCert);
    let attributedEur = 0;
    for (const email of a.emails) {
      const s = standalone.get(email);
      if (!s) continue;
      if (s.tw) courseBuyers.add(email);
      if (s.cert) certBuyers.add(email);
      attributedEur += s.eurMinor;
    }
    const buyers = new Set([...courseBuyers, ...certBuyers]);
    const attended = a.live + a.replay;
    return {
      workshopId: w.id,
      title: w.title,
      startsAtUtc: w.starts_at_utc,
      isReplay: w.is_replay === 1,
      status: w.status,
      registrations: a.regs,
      attendedLive: a.live,
      replayViews: a.replay,
      noShows: a.noShow,
      attendancePct: a.regs > 0 ? (attended / a.regs) * 100 : null,
      bumpBuys: bumpByWorkshop.get(w.id) ?? 0,
      courseBuys: courseBuyers.size,
      certBuys: certBuyers.size,
      engineNetEurMinor: a.netEurMinor,
      attributedCourseEurMinor: attributedEur,
      totalEurMinor: a.netEurMinor + attributedEur,
      metaCostEurMinor:
        costPerRegistrationEurMinor != null ? Math.round(costPerRegistrationEurMinor * a.regs) : null,
      conversionPct: a.regs > 0 ? (buyers.size / a.regs) * 100 : null,
    };
  });

  return { rows, adSpendEurMinor, totalRegistrations, costPerRegistrationEurMinor };
}

// ---------------------------------------------------------------------------
// Merged per-day revenue streams for charts / tables / CSV. Fills every day
// between `from` and `to` (or the observed data range) so line charts have a
// continuous x-axis.

export type StreamDay = {
  date: string;
  workshopsEurMinor: number; // workshop engine net minus masterclass share
  masterclassEurMinor: number;
  twelveWeekEurMinor: number;
  certificationEurMinor: number;
  otherCoursesEurMinor: number;
  totalEurMinor: number;
  adSpendEurMinor: number;
};

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function mergeDailyStreams(
  workshops: StatsReport,
  courses: CourseSalesReport,
  from?: string | null,
  to?: string | null,
): StreamDay[] {
  const wk = new Map(workshops.daily.map((d) => [d.date, d]));
  const cr = new Map(courses.daily.map((d) => [d.date, d]));
  const dates = [...wk.keys(), ...cr.keys()].sort();
  const start = from ?? dates[0];
  const end = to ?? dates[dates.length - 1];
  if (!start || !end || start > end) return [];

  const out: StreamDay[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const w = wk.get(date);
    const c = cr.get(date);
    const masterclass = w?.masterclassNetEurMinor ?? 0;
    const workshopsNet = (w?.netEurMinor ?? 0) - masterclass;
    const tw = c?.twelveWeekEurMinor ?? 0;
    const cert = c?.certificationEurMinor ?? 0;
    const other = c?.otherEurMinor ?? 0;
    out.push({
      date,
      workshopsEurMinor: workshopsNet,
      masterclassEurMinor: masterclass,
      twelveWeekEurMinor: tw,
      certificationEurMinor: cert,
      otherCoursesEurMinor: other,
      totalEurMinor: workshopsNet + masterclass + tw + cert + other,
      adSpendEurMinor: w?.adSpendEurMinor ?? 0,
    });
    if (out.length > 3700) break; // hard cap ≈ 10 years; keeps "all time" sane
  }
  return out;
}
