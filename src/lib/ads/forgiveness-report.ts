// The Forgiveness box on /ads and /admin/stats (November 2026): how the
// Forgiveness Course is doing against its own ads.
//
// Its campaigns are told apart by name (isForgivenessCampaign, lib/ads/
// campaigns.ts — "Forgiveness" in the campaign name) and charged to no workshop
// session; this is where their money is measured instead, against the course's
// own orders (computeCourseProductOrders: net of VAT, live FX, refunds off, the
// order bumps bought on its checkout included).
//
// Two readings, because the course is a campaign with a start and an end:
//   • the whole run — every order and every Forgiveness ad euro since sales
//     opened, whatever window the page is on; the question "how is it doing";
//   • the page's window, when it is not all time — "and in the period I'm
//     looking at".
//
// ROAS here is all of the course's sales ÷ its ad spend. Nothing on an order
// says whether it came from an ad, a broadcast or word of mouth, so this is the
// blended figure, and the box says so. Profit is after ad spend only.
//
// New vs returning customers (forgiveness-buyers.ts): every order is read
// against the buyer's earlier orders on the site and their product tags in
// Drip. The ads' job is the new ones, so the box also prints ad spend per new
// customer — all of the spend over the new customers, whoever the ads reached.

import { isAcquisitionCampaign, isForgivenessCampaign } from './campaigns';
import {
  computeCourseProductOrders,
  ROAS_TARGET,
  type CourseProductOrder,
  type MoneyOpts,
} from '../workshops/stats';
import { brusselsToday, shiftDays } from '../workshops/periods';
import { classifyForgivenessBuyers, type BuyerVerdict } from './forgiveness-buyers';
import type { DripConfig } from '../registrations/drip';
import {
  FORGIVENESS_PRODUCT_SLUG,
  FORGIVENESS_SESSIONS,
  forgivenessRegistrationOpen,
  upcomingForgivenessSessions,
} from '../courses/forgiveness';

export type ForgivenessFigures = {
  sales: number; // orders that took money and stand (not refunded in full)
  free: number; // free places (took no money)
  refunded: number; // orders refunded in full
  courseEurMinor: number;
  bumpsEurMinor: number;
  bumpCount: number;
  revenueEurMinor: number; // course + bumps, net of VAT, refunds off
  spendEurMinor: number;
  prospectingEurMinor: number; // Forgiveness campaigns with TOF in the name
  retargetingEurMinor: number; // the rest of them
  profitEurMinor: number; // revenue − ad spend
  roas: number | null; // revenue ÷ ad spend
  costPerSaleEurMinor: number | null; // ad spend ÷ sales
  avgOrderEurMinor: number | null; // revenue ÷ sales
  // >0 = revenue still needed to reach ROAS_TARGET on this spend; ≤0 = past it.
  gapToTargetEurMinor: number | null;
  // New vs returning customers. Counts are of `sales`; the two revenues add up
  // to `revenueEurMinor`.
  newSales: number;
  newOnListSales: number; // of newSales: already on the email list before
  newRevenueEurMinor: number;
  returningSales: number;
  returningViaDripSales: number; // of returningSales: known from Drip's tags only
  returningRevenueEurMinor: number;
  costPerNewCustomerEurMinor: number | null; // ad spend ÷ new customers
};

export type ForgivenessDay = {
  date: string;
  sales: number;
  revenueEurMinor: number;
  spendEurMinor: number;
};

export type ForgivenessReport = {
  show: boolean;
  registrationOpen: boolean;
  firstSessionUtc: string;
  lastSessionEndUtc: string;
  sessionsAhead: number; // of 4
  daysToFirstSession: number | null; // null once it has started
  run: ForgivenessFigures; // since sales opened
  runFrom: string | null; // first day with an order or Forgiveness spend
  today: ForgivenessFigures;
  last7: ForgivenessFigures;
  todayDate: string; // Brussels
  last7From: string;
  window: ForgivenessFigures | null; // null when the page shows all time
  windowFrom: string | null;
  windowTo: string | null;
  campaigns: Array<{ campaign: string; eurMinor: number; prospecting: boolean }>; // whole run
  // Orders whose buyer Drip could not be asked about (yet): read on the site's
  // own data and the contact list alone.
  dripUnread: number;
  days: ForgivenessDay[]; // runFrom → today, every day
};

type SpendRow = { spend_date: string; campaign: string; eur: number };

type Order = CourseProductOrder & { buyer: BuyerVerdict };

function figures(orders: Order[], spend: SpendRow[]): ForgivenessFigures {
  let sales = 0;
  let free = 0;
  let refunded = 0;
  let courseEurMinor = 0;
  let bumpsEurMinor = 0;
  let bumpCount = 0;
  let newSales = 0;
  let newOnListSales = 0;
  let newRevenueEurMinor = 0;
  let returningSales = 0;
  let returningViaDripSales = 0;
  let returningRevenueEurMinor = 0;
  for (const o of orders) {
    courseEurMinor += o.courseEurMinor;
    bumpsEurMinor += o.bumpsEurMinor;
    const isNew = o.buyer.kind === 'new';
    if (isNew) newRevenueEurMinor += o.courseEurMinor + o.bumpsEurMinor;
    else returningRevenueEurMinor += o.courseEurMinor + o.bumpsEurMinor;
    if (o.refunded) refunded += 1;
    else if (o.free) free += 1;
    else {
      sales += 1;
      bumpCount += o.bumpCount;
      if (isNew) {
        newSales += 1;
        if (o.buyer.onList) newOnListSales += 1;
      } else {
        returningSales += 1;
        if (o.buyer.via === 'drip') returningViaDripSales += 1;
      }
    }
  }
  let spendEurMinor = 0;
  let prospectingEurMinor = 0;
  for (const s of spend) {
    spendEurMinor += s.eur;
    if (isAcquisitionCampaign(s.campaign)) prospectingEurMinor += s.eur;
  }
  const revenueEurMinor = courseEurMinor + bumpsEurMinor;
  return {
    sales,
    free,
    refunded,
    courseEurMinor,
    bumpsEurMinor,
    bumpCount,
    revenueEurMinor,
    spendEurMinor,
    prospectingEurMinor,
    retargetingEurMinor: spendEurMinor - prospectingEurMinor,
    profitEurMinor: revenueEurMinor - spendEurMinor,
    roas: spendEurMinor > 0 ? revenueEurMinor / spendEurMinor : null,
    costPerSaleEurMinor: spendEurMinor > 0 && sales > 0 ? Math.round(spendEurMinor / sales) : null,
    avgOrderEurMinor: sales > 0 ? Math.round(revenueEurMinor / sales) : null,
    gapToTargetEurMinor: spendEurMinor > 0 ? ROAS_TARGET * spendEurMinor - revenueEurMinor : null,
    newSales,
    newOnListSales,
    newRevenueEurMinor,
    returningSales,
    returningViaDripSales,
    returningRevenueEurMinor,
    costPerNewCustomerEurMinor:
      spendEurMinor > 0 && newSales > 0 ? Math.round(spendEurMinor / newSales) : null,
  };
}

const inRange = (day: string, from: string | null, to: string | null) =>
  (!from || day >= from) && (!to || day <= to);

export async function computeForgivenessReport(
  db: D1Database,
  opts: {
    from?: string | null;
    to?: string | null;
    money?: MoneyOpts;
    nowMs?: number;
    // Drip credentials, for the new / returning split. Without them the split
    // rests on the site's orders and the contact list.
    drip?: DripConfig | null;
  } = {},
): Promise<ForgivenessReport> {
  const nowMs = opts.nowMs ?? Date.now();
  const from = opts.from ?? null;
  const to = opts.to ?? null;

  const [plainOrders, spendRes] = await Promise.all([
    computeCourseProductOrders(db, FORGIVENESS_PRODUCT_SLUG, { money: opts.money }),
    // LIKE narrows the read (case-insensitive for ASCII in SQLite); the JS test
    // below is the rule, the same one that keeps these euros off the workshops.
    db
      .prepare(
        `SELECT spend_date, campaign, amount_eur_minor, amount_minor, currency
           FROM workshop_ad_spend WHERE campaign LIKE '%forgiv%'`,
      )
      .all<{ spend_date: string; campaign: string; amount_eur_minor: number | null; amount_minor: number; currency: string }>(),
  ]);
  const spend: SpendRow[] = (spendRes.results ?? [])
    .filter((a) => isForgivenessCampaign(a.campaign))
    .map((a) => ({
      spend_date: a.spend_date,
      campaign: (a.campaign ?? '').trim(),
      eur: a.amount_eur_minor ?? (a.currency === 'EUR' ? a.amount_minor : 0),
    }));

  const buyers = await classifyForgivenessBuyers(db, plainOrders, { drip: opts.drip });
  const orders: Order[] = plainOrders.map((o) => ({
    ...o,
    buyer: buyers.verdicts.get(o.id) ?? { kind: 'new', via: null, onList: false },
  }));

  const today = brusselsToday();
  const weekFrom = shiftDays(today, -6);
  const pick = (f: string | null, t: string | null) =>
    figures(
      orders.filter((o) => inRange(o.day, f, t)),
      spend.filter((s) => inRange(s.spend_date, f, t)),
    );

  const firstDays = [
    ...orders.filter((o) => !o.free).map((o) => o.day),
    ...spend.filter((s) => s.eur > 0).map((s) => s.spend_date),
  ].sort();
  const runFrom = firstDays[0] ?? null;

  const days: ForgivenessDay[] = [];
  if (runFrom) {
    const byDay = new Map<string, ForgivenessDay>();
    for (let d = runFrom; d <= today; d = shiftDays(d, 1)) {
      const day = { date: d, sales: 0, revenueEurMinor: 0, spendEurMinor: 0 };
      byDay.set(d, day);
      days.push(day);
      if (days.length > 400) break;
    }
    for (const o of orders) {
      const day = byDay.get(o.day);
      if (!day) continue;
      day.revenueEurMinor += o.courseEurMinor + o.bumpsEurMinor;
      if (!o.free && !o.refunded) day.sales += 1;
    }
    for (const s of spend) {
      const day = byDay.get(s.spend_date);
      if (day) day.spendEurMinor += s.eur;
    }
  }

  const byCampaign = new Map<string, number>();
  for (const s of spend) byCampaign.set(s.campaign, (byCampaign.get(s.campaign) ?? 0) + s.eur);
  const campaigns = [...byCampaign.entries()]
    .map(([campaign, eurMinor]) => ({ campaign, eurMinor, prospecting: isAcquisitionCampaign(campaign) }))
    .sort((a, b) => b.eurMinor - a.eurMinor);

  const windowed = from || to ? pick(from, to) : null;
  const registrationOpen = forgivenessRegistrationOpen(nowMs);
  const first = FORGIVENESS_SESSIONS[0];
  const last = FORGIVENESS_SESSIONS[FORGIVENESS_SESSIONS.length - 1];
  const startMs = Date.parse(first.startsAtUtc);
  const daysToFirstSession =
    nowMs < startMs ? Math.max(0, Math.ceil((startMs - nowMs) / 86_400_000)) : null;

  return {
    // On while the course is on sale; afterwards only on a window that saw it
    // sell or spend.
    show:
      registrationOpen ||
      (windowed != null && (windowed.sales > 0 || windowed.spendEurMinor > 0)),
    registrationOpen,
    firstSessionUtc: first.startsAtUtc,
    lastSessionEndUtc: last.endsAtUtc,
    sessionsAhead: upcomingForgivenessSessions(nowMs).length,
    daysToFirstSession,
    run: figures(orders, spend),
    runFrom,
    today: pick(today, today),
    last7: pick(weekFrom, today),
    todayDate: today,
    last7From: weekFrom,
    window: windowed,
    windowFrom: from,
    windowTo: to,
    campaigns,
    dripUnread: buyers.dripUnread,
    days,
  };
}
