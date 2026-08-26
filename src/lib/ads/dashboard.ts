// Data for the ads-manager dashboard (/ads). A single read-only snapshot for a
// date window, composed from the same figures the admin stats pages use so
// numbers reconcile with /admin/stats and /admin/workshops/performance:
//
//   • computeStats           — workshop-engine revenue (tickets, masterclass,
//                              order bumps, course add-ons) + ad spend + ROAS.
//   • computeCourseSales     — standalone 12-week / certification / other sales.
//   • computeWorkshopPerformance — the per-workshop funnel: registrations →
//                              attendance → course/cert conversion, plus the
//                              day-by-day allocated Meta cost + the
//                              cost-per-registration each workshop actually paid.
//   • mergeDailyStreams      — per-day revenue streams + ad spend for the charts.
//
// Plus two ads-specific extras this file adds: the 12-week checkout order bumps
// (the `bumps` JSON on course_registrations) and a per-day registration count
// (for the acquisition + cost-per-registration charts).

import {
  computeStats,
  computeCourseSales,
  computeWorkshopPerformance,
  mergeDailyStreams,
  type WorkshopPerformanceRow,
  type AudienceAcquisition,
  type StreamDay,
} from '../workshops/stats';
import { FX_TO_EUR } from '../workshops/currency';
import { parsePurchasedBumps } from '../courses/db';
import { BUMPS, isBumpSlug } from '../courses/bumps';

export type AcquisitionDay = {
  date: string; // YYYY-MM-DD
  registrations: number;
  adSpendEurMinor: number; // all campaigns
  acquisitionSpendEurMinor: number; // prospecting (TOF) campaigns only
  revenueEurMinor: number;
  // Prospecting spend ÷ registrations that day — the price each of that day's
  // registrations is charged at in the per-workshop cost allocation.
  cpaEurMinor: number | null;
};

export type BumpLabel = { label: string; count: number; eurMinor: number };

export type AdsDashboard = {
  from: string | null;
  to: string | null;

  // Headline (ads-manager KPIs) ------------------------------------------
  adSpendEurMinor: number; // all campaigns
  acquisitionSpendEurMinor: number; // prospecting (TOF) campaigns
  retargetingSpendEurMinor: number; // everything else
  registrations: number;
  costPerRegistrationEurMinor: number | null; // prospecting spend ÷ registrations (window average, both products)
  // The same figure per product: the workshop campaigns' money against workshop
  // registrations, the masterclass campaigns' against masterclass ones. The
  // blended figure above mixes two products bought at different prices.
  audiences: { workshop: AudienceAcquisition; masterclass: AudienceAcquisition };
  // Prospecting spend by campaigns naming neither product (charged across both).
  generalAcquisitionSpendEurMinor: number;
  // Prospecting spend on days that produced no registration of the product its
  // campaign names: it can't be priced day-by-day, so it's spread evenly over
  // that product's registrations in the window instead.
  unattributedAcquisitionSpendEurMinor: number;
  // Prospecting spend whose product took no registration at all in the window —
  // charged to nothing rather than to the other product's seats.
  unallocatedAcquisitionSpendEurMinor: number;
  attendedLive: number;
  replayViews: number;
  noShows: number;
  attendancePct: number | null; // (live + replay) ÷ registrations
  courseBuyers: number; // distinct 12-week buyers, summed per workshop
  certBuyers: number; // distinct certification buyers, summed per workshop
  conversionPct: number | null; // (course + cert buyers) ÷ registrations
  conversionPerAttendeePct: number | null; // (course + cert buyers) ÷ attendees (live + replay)
  totalRevenueEurMinor: number; // engine net + standalone course sales
  blendedRoas: number | null; // total revenue ÷ ad spend (all campaigns)
  // Workshop-only ROAS: income traceable to workshop registrants (engine net +
  // standalone course revenue from those emails, distinct) ÷ prospecting (TOF)
  // spend. The acquisition-true return on the workshop funnel.
  workshopRevenueEurMinor: number;
  workshopRoas: number | null;

  // Focus products -------------------------------------------------------
  workshops: { ticketCount: number; netEurMinor: number };
  masterclass: { count: number; netEurMinor: number };
  twelveWeek: { count: number; netEurMinor: number };
  certification: { count: number; netEurMinor: number };
  otherCourses: { count: number; netEurMinor: number };

  // Bump offers ----------------------------------------------------------
  workshopBumps: { count: number; netEurMinor: number };
  courseBumps: { count: number; eurMinor: number; byLabel: BumpLabel[] };
  bumpTakeRatePct: number | null; // workshop order bumps ÷ workshop tickets

  // Per-workshop results -------------------------------------------------
  workshopRows: WorkshopPerformanceRow[];

  // Revenue streams (sum to totalRevenueEurMinor) ------------------------
  streams: Array<{ name: string; count: number; eurMinor: number }>;

  // Charts ---------------------------------------------------------------
  dailyStreams: StreamDay[];
  acquisition: AcquisitionDay[];

  // Data-quality flags ---------------------------------------------------
  flaggedNoTax: number;
  fxConverted: number;
  hasAdSpend: boolean;
};

function toEnd(to: string): string {
  return `${to} 23:59:59`;
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// 12-week checkout order bumps for paid course rows in the window, converted to
// EUR with the fallback table (the bump's currency is the course row's), grouped
// by product label. Mirrors the SD-REPORT digest so the figures match.
async function computeCourseBumps(
  db: D1Database,
  from: string | null,
  to: string | null,
): Promise<{ count: number; eurMinor: number; byLabel: BumpLabel[] }> {
  const where: string[] = [
    'paid_at IS NOT NULL',
    "status NOT IN ('pending','expired')",
    'bumps IS NOT NULL',
  ];
  const binds: unknown[] = [];
  if (from) {
    where.push('paid_at >= ?');
    binds.push(from);
  }
  if (to) {
    where.push('paid_at <= ?');
    binds.push(toEnd(to));
  }
  const res = await db
    .prepare(`SELECT bumps, currency FROM course_registrations WHERE ${where.join(' AND ')}`)
    .bind(...binds)
    .all<{ bumps: string; currency: string }>();

  const map = new Map<string, { count: number; eurMinor: number }>();
  let count = 0;
  let eurMinor = 0;
  for (const row of res.results ?? []) {
    const rate = FX_TO_EUR[(row.currency || 'EUR').toUpperCase()] ?? 1;
    for (const b of parsePurchasedBumps(row.bumps)) {
      const eur = Math.round(b.amount_cents * rate);
      const label = isBumpSlug(b.slug) ? BUMPS[b.slug].label : b.slug;
      const e = map.get(label) ?? { count: 0, eurMinor: 0 };
      e.count += 1;
      e.eurMinor += eur;
      map.set(label, e);
      count += 1;
      eurMinor += eur;
    }
  }
  const byLabel = [...map.entries()]
    .map(([label, v]) => ({ label, count: v.count, eurMinor: v.eurMinor }))
    .sort((a, b) => b.eurMinor - a.eurMinor);
  return { count, eurMinor, byLabel };
}

// Completed (paid/coupon) registrations per calendar day (UTC), keyed
// YYYY-MM-DD off created_at — the acquisition volume the ad spend bought.
async function computeDailyRegistrations(
  db: D1Database,
  from: string | null,
  to: string | null,
): Promise<Map<string, number>> {
  const where: string[] = ["payment_status IN ('paid','coupon')"];
  const binds: unknown[] = [];
  if (from) {
    where.push('created_at >= ?');
    binds.push(from);
  }
  if (to) {
    where.push('created_at <= ?');
    binds.push(toEnd(to));
  }
  const res = await db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS n
         FROM workshop_registrations
        WHERE ${where.join(' AND ')}
        GROUP BY substr(created_at, 1, 10)`,
    )
    .bind(...binds)
    .all<{ d: string; n: number }>();
  const m = new Map<string, number>();
  for (const r of res.results ?? []) m.set(r.d, r.n);
  return m;
}

export async function computeAdsDashboard(
  db: D1Database,
  opts: { from?: string | null; to?: string | null } = {},
): Promise<AdsDashboard> {
  const from = opts.from ?? null;
  const to = opts.to ?? null;

  const [stats, courses, perf, courseBumps, dailyRegs] = await Promise.all([
    computeStats(db, { from, to }),
    computeCourseSales(db, { from, to }),
    computeWorkshopPerformance(db, { from, to }),
    computeCourseBumps(db, from, to),
    computeDailyRegistrations(db, from, to),
  ]);

  const dailyStreams = mergeDailyStreams(stats, courses, from, to);

  // Funnel totals mirror the per-workshop performance page's total row: summed
  // across rows, with attendance/conversion recomputed from the sums.
  const rows = perf.rows;
  const sum = (f: (r: WorkshopPerformanceRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const registrations = perf.totalRegistrations;
  const attendedLive = sum((r) => r.attendedLive);
  const replayViews = sum((r) => r.replayViews);
  const noShows = sum((r) => r.noShows);
  const attended = attendedLive + replayViews;
  const courseBuyers = sum((r) => r.courseBuys);
  const certBuyers = sum((r) => r.certBuys);

  const t = stats.totals;
  const totalRevenueEurMinor = t.netEurMinor + courses.totalNetEurMinor;
  const adSpendEurMinor = stats.adSpendEurMinor;

  // Acquisition series: registrations vs ad spend vs revenue, per day, plus the
  // derived daily cost-per-registration. Built over the same continuous range
  // mergeDailyStreams fills; days with a registration but no revenue/spend are
  // folded in too.
  const streamByDate = new Map(dailyStreams.map((d) => [d.date, d]));
  let dates: string[];
  if (from && to && from <= to) {
    dates = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      dates.push(d);
      if (dates.length > 3700) break; // ~10y cap
    }
  } else {
    dates = [...new Set([...streamByDate.keys(), ...dailyRegs.keys()])].sort();
  }
  const acquisition: AcquisitionDay[] = dates.map((date) => {
    const s = streamByDate.get(date);
    const regs = dailyRegs.get(date) ?? 0;
    const spend = s?.adSpendEurMinor ?? 0;
    const acqSpend = s?.acquisitionAdSpendEurMinor ?? 0;
    const rev = s?.totalEurMinor ?? 0;
    return {
      date,
      registrations: regs,
      adSpendEurMinor: spend,
      acquisitionSpendEurMinor: acqSpend,
      revenueEurMinor: rev,
      // Cost per registration = prospecting (TOF) spend ÷ registrations.
      cpaEurMinor: regs > 0 && acqSpend > 0 ? Math.round(acqSpend / regs) : null,
    };
  });

  // Revenue streams — the seven line-item buckets that sum to
  // totalRevenueEurMinor (engine net + standalone course sales). Course order
  // bumps are deliberately NOT here (they sit outside both totals); they live in
  // the bumps section instead, so this table always reconciles.
  const streams = [
    { name: 'Workshop tickets', count: t.ticketCount, eurMinor: t.ticketNetEurMinor },
    { name: 'Order bumps (workshop checkout)', count: t.bumpCount, eurMinor: t.bumpNetEurMinor },
    { name: 'Course add-ons (workshop checkout)', count: t.courseCount, eurMinor: t.courseNetEurMinor },
    { name: 'Masterclass tickets', count: t.masterclassCount, eurMinor: t.masterclassNetEurMinor },
    { name: '12-Week Course', count: courses.twelveWeek.count, eurMinor: courses.twelveWeek.netEurMinor },
    { name: 'Certification Course', count: courses.certification.count, eurMinor: courses.certification.netEurMinor },
    ...(courses.other.count > 0
      ? [{ name: 'Other courses', count: courses.other.count, eurMinor: courses.other.netEurMinor }]
      : []),
  ];

  return {
    from,
    to,

    adSpendEurMinor,
    acquisitionSpendEurMinor: perf.acquisitionSpendEurMinor,
    retargetingSpendEurMinor: perf.retargetingSpendEurMinor,
    registrations,
    costPerRegistrationEurMinor: perf.costPerRegistrationEurMinor,
    audiences: perf.audiences,
    generalAcquisitionSpendEurMinor: perf.generalAcquisitionSpendEurMinor,
    unattributedAcquisitionSpendEurMinor: perf.unattributedAcquisitionSpendEurMinor,
    unallocatedAcquisitionSpendEurMinor: perf.unallocatedAcquisitionSpendEurMinor,
    attendedLive,
    replayViews,
    noShows,
    attendancePct: registrations > 0 ? (attended / registrations) * 100 : null,
    courseBuyers,
    certBuyers,
    conversionPct: registrations > 0 ? ((courseBuyers + certBuyers) / registrations) * 100 : null,
    conversionPerAttendeePct: attended > 0 ? ((courseBuyers + certBuyers) / attended) * 100 : null,
    totalRevenueEurMinor,
    blendedRoas: adSpendEurMinor > 0 ? totalRevenueEurMinor / adSpendEurMinor : null,
    workshopRevenueEurMinor: perf.workshopRevenueEurMinor,
    workshopRoas: perf.workshopRoas,

    workshops: { ticketCount: t.ticketCount, netEurMinor: t.ticketNetEurMinor },
    masterclass: { count: t.masterclassCount, netEurMinor: t.masterclassNetEurMinor },
    twelveWeek: { count: courses.twelveWeek.count, netEurMinor: courses.twelveWeek.netEurMinor },
    certification: { count: courses.certification.count, netEurMinor: courses.certification.netEurMinor },
    otherCourses: { count: courses.other.count, netEurMinor: courses.other.netEurMinor },

    workshopBumps: { count: t.bumpCount, netEurMinor: t.bumpNetEurMinor },
    courseBumps,
    bumpTakeRatePct: t.ticketCount > 0 ? (t.bumpCount / t.ticketCount) * 100 : null,

    workshopRows: rows,
    streams,

    dailyStreams,
    acquisition,

    flaggedNoTax: t.flaggedNoTax,
    fxConverted: courses.fxConverted,
    hasAdSpend: adSpendEurMinor > 0,
  };
}
