// Statistics + ROAS for the workshop engine.
//
// All money is reported in EUR minor units. The EUR conversion mirrors the
// legacy stats: gross EUR = the Stripe settlement amount (payout currency),
// and net-of-tax EUR = subtotal * (settlement / amount). Per-payment totals
// are split across ticket / bump / course using the purchases line-item shares.

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
};

export type StatsTotals = {
  grossEurMinor: number;
  netEurMinor: number; // tax-excluded, all product types
  taxEurMinor: number;
  ticketNetEurMinor: number;
  bumpNetEurMinor: number;
  courseNetEurMinor: number;
  bumpCount: number;
  ticketCount: number;
  courseCount: number;
  paidCount: number;
  flaggedNoTax: number; // rows where we fell back to net = gross
};

export type DailyStat = {
  date: string; // YYYY-MM-DD (UTC)
  grossEurMinor: number;
  netEurMinor: number;
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

  // Purchases for those payments, grouped by payment_id.
  const byPayment = new Map<number, PurchaseRow[]>();
  if (payments.length) {
    const ids = payments.map((p) => p.id);
    const placeholders = ids.map(() => '?').join(',');
    const purRes = await db
      .prepare(
        `SELECT payment_id, product_type, product_id, amount_minor
           FROM workshop_purchases WHERE payment_id IN (${placeholders})`,
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
    ticketNetEurMinor: 0, bumpNetEurMinor: 0, courseNetEurMinor: 0,
    bumpCount: 0, ticketCount: 0, courseCount: 0, paidCount: 0, flaggedNoTax: 0,
  };
  const dailyMap = new Map<string, { gross: number; net: number }>();
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
    const d = dailyMap.get(date) ?? { gross: 0, net: 0 };
    d.gross += gross;
    d.net += net;
    dailyMap.set(date, d);

    // Allocate the payment's net across its line items by charged-amount share.
    const lines = byPayment.get(p.id) ?? [];
    const lineTotal = lines.reduce((s, l) => s + l.amount_minor, 0) || p.amount_minor;
    for (const l of lines) {
      const share = lineTotal > 0 ? l.amount_minor / lineTotal : 0;
      const lineNet = Math.round(net * share);
      if (l.product_type === 'ticket') {
        totals.ticketNetEurMinor += lineNet;
        totals.ticketCount += 1;
      } else if (l.product_type === 'bump') {
        totals.bumpNetEurMinor += lineNet;
        totals.bumpCount += 1;
      } else if (l.product_type === 'course') {
        totals.courseNetEurMinor += lineNet;
        totals.courseCount += 1;
        const c = courseMap.get(l.product_id) ?? { count: 0, net: 0 };
        c.count += 1;
        c.net += lineNet;
        courseMap.set(l.product_id, c);
      }
    }
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
      const rev = dailyMap.get(date) ?? { gross: 0, net: 0 };
      const spend = adByDate.get(date) ?? 0;
      return {
        date,
        grossEurMinor: rev.gross,
        netEurMinor: rev.net,
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
