// The "share with a friend" funnel, as a number: how many registrants were
// shown the panel, how many pressed a button, how many friends opened a link,
// and how many of them registered (and paid). Rendered on
// /admin/workshops/performance beside the ad economics — the same question,
// asked of the channel that costs nothing.
//
// Kept out of share.ts because that module is imported by the middleware (it
// captures the referral on every shared link), and the middleware has no
// business pulling the stats module — and its Quaderno/FX dependencies — into
// every request.

import { grossEurMinor } from './stats';
import { normalizeChannel, type ShareChannel } from './share';


export type ShareChannelStats = {
  channel: ShareChannel;
  shares: number; // buttons pressed
  visits: number; // friends who opened a link from that button
  registrations: number; // registrations that followed
  secured: number; // …that are paid or comped
  revenueEurMinor: number;
};

export type ShareSharerStats = {
  registrationId: number;
  name: string | null;
  email: string;
  workshopTitle: string | null;
  shares: number;
  visits: number;
  registrations: number;
  secured: number;
  revenueEurMinor: number;
};

export type ShareReport = {
  panelViews: number; // people shown the share panel
  shareClicks: number; // share buttons pressed, in total
  sharers: number; // …by this many different people
  visits: number; // friends who opened a shared link
  registrations: number; // registrations that came from one
  secured: number; // …paid or comped
  revenueEurMinor: number; // gross, converted (see grossEurMinor)
  byChannel: ShareChannelStats[];
  topSharers: ShareSharerStats[];
};

type EventGroupRow = { kind: string; channel: string | null; n: number; people: number };
type AttributedRow = {
  referred_by_id: number;
  channel: string | null;
  payment_status: string;
  amount_minor: number | null;
  currency: string | null;
  settlement_amount_minor: number | null;
  settlement_currency: string | null;
};

const SECURED = new Set(['paid', 'coupon']);

// The whole referral funnel for a window, for /admin/workshops/performance.
// `from`/`to` are YYYY-MM-DD (inclusive), matching the stats pages' presets.
//
// Money goes through `grossEurMinor` like every other euro figure on those
// pages — a 239 kr ticket is ~€21, never €239.
export async function computeShareReport(
  db: D1Database,
  opts: { from?: string | null; to?: string | null; money?: { fxRates?: Record<string, number> } } = {},
): Promise<ShareReport> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.from) { where.push('created_at >= ?'); binds.push(opts.from); }
  if (opts.to) { where.push('created_at <= ?'); binds.push(`${opts.to} 23:59:59`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const fxRates = opts.money?.fxRates;

  const empty: ShareReport = {
    panelViews: 0, shareClicks: 0, sharers: 0, visits: 0,
    registrations: 0, secured: 0, revenueEurMinor: 0,
    byChannel: [], topSharers: [],
  };

  // The share panel is young: on a database that predates migration 0082 every
  // query here is a missing-table error, and the page must still render.
  let grouped: EventGroupRow[] = [];
  let attributed: AttributedRow[] = [];
  let perSharer: Array<{ registration_id: number; kind: string; n: number }> = [];
  try {
    const [g, a, s] = await Promise.all([
      db
        .prepare(
          `SELECT kind, channel, COUNT(*) AS n, COUNT(DISTINCT registration_id) AS people
             FROM workshop_share_events ${clause}
            GROUP BY kind, channel`,
        )
        .bind(...binds)
        .all<EventGroupRow>(),
      // Registrations that arrived on a shared link, each with its latest paid
      // payment — the same "one row per registration" join /admin/orders uses,
      // so no id list is bound and D1's 100-param cap is never in play.
      db
        .prepare(
          `SELECT r.referred_by_id AS referred_by_id, r.referral_channel AS channel,
                  r.payment_status AS payment_status,
                  p.amount_minor, p.currency, p.settlement_amount_minor, p.settlement_currency
             FROM workshop_registrations r
             LEFT JOIN (
               SELECT registration_id, amount_minor, currency,
                      settlement_amount_minor, settlement_currency,
                      ROW_NUMBER() OVER (PARTITION BY registration_id ORDER BY id DESC) AS rn
                 FROM workshop_payments WHERE status = 'paid'
             ) p ON p.registration_id = r.id AND p.rn = 1
            WHERE r.referred_by_id IS NOT NULL
              ${where.length ? `AND ${where.map((w) => `r.${w}`).join(' AND ')}` : ''}`,
        )
        .bind(...binds)
        .all<AttributedRow>(),
      db
        .prepare(
          `SELECT registration_id, kind, COUNT(*) AS n
             FROM workshop_share_events
            WHERE registration_id IS NOT NULL ${where.length ? `AND ${where.join(' AND ')}` : ''}
            GROUP BY registration_id, kind`,
        )
        .bind(...binds)
        .all<{ registration_id: number; kind: string; n: number }>(),
    ]);
    grouped = g.results ?? [];
    attributed = a.results ?? [];
    perSharer = s.results ?? [];
  } catch (err) {
    console.error(`computeShareReport: ${String(err)}`);
    return empty;
  }

  const report: ShareReport = { ...empty, byChannel: [], topSharers: [] };
  const channels = new Map<ShareChannel, ShareChannelStats>();
  const chan = (c: ShareChannel): ShareChannelStats => {
    let row = channels.get(c);
    if (!row) {
      row = { channel: c, shares: 0, visits: 0, registrations: 0, secured: 0, revenueEurMinor: 0 };
      channels.set(c, row);
    }
    return row;
  };

  for (const g of grouped) {
    if (g.kind === 'view') {
      report.panelViews += g.n;
    } else if (g.kind === 'share') {
      report.shareClicks += g.n;
      chan(normalizeChannel(g.channel)).shares += g.n;
    } else if (g.kind === 'visit') {
      report.visits += g.n;
      chan(normalizeChannel(g.channel)).visits += g.n;
    }
  }
  // Distinct sharers across all channels — summing the per-channel `people`
  // would count somebody who used two buttons twice.
  report.sharers = new Set(
    perSharer.filter((r) => r.kind === 'share').map((r) => r.registration_id),
  ).size;

  const sharerRegs = new Map<number, { registrations: number; secured: number; revenueEurMinor: number }>();
  for (const r of attributed) {
    const row = chan(normalizeChannel(r.channel));
    const secured = SECURED.has(r.payment_status);
    const revenue =
      r.amount_minor != null
        ? grossEurMinor(
            {
              amount_minor: r.amount_minor,
              currency: r.currency ?? 'EUR',
              settlement_amount_minor: r.settlement_amount_minor,
              settlement_currency: r.settlement_currency,
            },
            fxRates,
          )
        : 0;
    report.registrations += 1;
    row.registrations += 1;
    if (secured) { report.secured += 1; row.secured += 1; }
    report.revenueEurMinor += revenue;
    row.revenueEurMinor += revenue;

    const s = sharerRegs.get(r.referred_by_id) ?? { registrations: 0, secured: 0, revenueEurMinor: 0 };
    s.registrations += 1;
    if (secured) s.secured += 1;
    s.revenueEurMinor += revenue;
    sharerRegs.set(r.referred_by_id, s);
  }

  report.byChannel = [...channels.values()].sort(
    (a, b) => b.secured - a.secured || b.visits - a.visits || b.shares - a.shares,
  );

  // Who actually sends people. Ranked by seats secured, then friends reached.
  const sharerRows = new Map<number, ShareSharerStats>();
  const sharer = (id: number): ShareSharerStats => {
    let row = sharerRows.get(id);
    if (!row) {
      row = {
        registrationId: id, name: null, email: '', workshopTitle: null,
        shares: 0, visits: 0, registrations: 0, secured: 0, revenueEurMinor: 0,
      };
      sharerRows.set(id, row);
    }
    return row;
  };
  for (const r of perSharer) {
    if (r.kind === 'share') sharer(r.registration_id).shares += r.n;
    else if (r.kind === 'visit') sharer(r.registration_id).visits += r.n;
  }
  for (const [id, s] of sharerRegs) Object.assign(sharer(id), s);

  const top = [...sharerRows.values()]
    .filter((r) => r.shares > 0 || r.visits > 0 || r.registrations > 0)
    .sort(
      (a, b) =>
        b.secured - a.secured ||
        b.registrations - a.registrations ||
        b.visits - a.visits ||
        b.shares - a.shares,
    )
    .slice(0, 12);
  if (top.length) {
    // A dozen ids at most — comfortably inside D1's 100-param cap.
    const ids = top.map((r) => r.registrationId);
    const people = await db
      .prepare(
        `SELECT r.id, r.name, r.email, w.title
           FROM workshop_registrations r
           LEFT JOIN workshops w ON w.id = r.workshop_id
          WHERE r.id IN (${ids.map(() => '?').join(',')})`,
      )
      .bind(...ids)
      .all<{ id: number; name: string | null; email: string; title: string | null }>();
    const byId = new Map((people.results ?? []).map((p) => [p.id, p]));
    for (const row of top) {
      const p = byId.get(row.registrationId);
      row.name = p?.name ?? null;
      row.email = p?.email ?? '';
      row.workshopTitle = p?.title ?? null;
    }
  }
  report.topSharers = top;

  return report;
}
