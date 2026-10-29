// "Which days and times convert best?" — the sessions that have run, grouped by
// the weekday and start time they were held at (Brussels, the clock Jacob
// schedules in), one table per product. Behind the "Day & time" panel on
// /admin/workshops/performance (SessionTimeSlots.astro).
//
// Every figure is a sum over the performance report's own rows, so a slot's
// numbers are exactly what its sessions' cards add up to: seats are the paid +
// coupon registrations, "joined live" is a live join (a replay view is not),
// "bought a course" is distinct 12-week / certification buyers per session,
// revenue is the cards' total (tickets, bumps, add-ons and standalone course
// sales at full value), ad cost is the TOF cost the session's own registrations
// were priced at, and profit nets every ad euro charged to it (Meta cost).
//
// Only sessions that have been held count: a replay has no time to sit on, and
// a session still ahead has its ad cost spent and its course income still to
// come, so it would drag its slot down for no reason but the calendar.

import type { WorkshopPerformanceRow } from './stats';

export type SlotGrouping = 'slot' | 'day' | 'time';
export type SlotProduct = 'workshop' | 'masterclass';

export type TimeSlotStats = {
  key: string;
  label: string;
  sessions: number;
  // "Tue 3 Sep 2026" for each session in the slot, oldest first.
  sessionDates: string[];
  seats: number;
  joinedLive: number;
  buyers: number;
  revenueEurMinor: number;
  // Null when no ad spend was charged to any of the slot's sessions.
  tofCostEurMinor: number | null;
  metaCostEurMinor: number | null;
  seatsPerSession: number;
  joinedLivePct: number | null;
  conversionPct: number | null;
  revenuePerSeatEurMinor: number | null;
  costPerSeatEurMinor: number | null;
  roas: number | null;
  profitPerSessionEurMinor: number;
  // Too few sessions to read anything into (fewer than MIN_SESSIONS).
  thin: boolean;
};

export type TimeSlotTable = {
  product: SlotProduct;
  grouping: SlotGrouping;
  slots: TimeSlotStats[];
  total: TimeSlotStats;
  // Per column, the key of the best slot among those with enough sessions —
  // null when fewer than two slots qualify (there is nothing to compare).
  best: Partial<Record<BestColumn, string>>;
};

export type BestColumn =
  | 'seatsPerSession'
  | 'joinedLivePct'
  | 'conversionPct'
  | 'revenuePerSeatEurMinor'
  | 'costPerSeatEurMinor'
  | 'roas'
  | 'profitPerSessionEurMinor';

// Below this many sessions a slot's rates are mostly one evening's luck.
export const MIN_SESSIONS = 3;

const TZ = 'Europe/Brussels';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const startMs = (s: string): number => Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ,
});
const dateFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ,
});

type Placed = { row: WorkshopPerformanceRow; t: number; day: number; time: string };

function place(row: WorkshopPerformanceRow): Placed | null {
  const t = startMs(row.startsAtUtc);
  if (!Number.isFinite(t)) return null;
  const parts = partsFmt.formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = WEEKDAYS.indexOf(get('weekday').slice(0, 3));
  if (day < 0) return null;
  return { row, t, day, time: `${get('hour')}:${get('minute')}` };
}

function keyOf(p: Placed, g: SlotGrouping): { key: string; label: string; order: string } {
  if (g === 'day') return { key: `d${p.day}`, label: WEEKDAY_NAMES[p.day], order: `${p.day}` };
  if (g === 'time') return { key: `t${p.time}`, label: p.time, order: p.time };
  return { key: `d${p.day}-${p.time}`, label: `${WEEKDAYS[p.day]} ${p.time}`, order: `${p.day} ${p.time}` };
}

function stats(key: string, label: string, ps: Placed[]): TimeSlotStats {
  const sum = (f: (r: WorkshopPerformanceRow) => number) => ps.reduce((s, p) => s + f(p.row), 0);
  const anyTof = ps.some((p) => p.row.acquisitionCostEurMinor != null);
  const anyMeta = ps.some((p) => p.row.metaCostEurMinor != null);
  const seats = sum((r) => r.registrations);
  const joinedLive = sum((r) => r.attendedLive);
  const buyers = sum((r) => r.courseCertBuyers);
  const revenue = sum((r) => r.totalEurMinor);
  const tof = anyTof ? sum((r) => r.acquisitionCostEurMinor ?? 0) : null;
  const meta = anyMeta ? sum((r) => r.metaCostEurMinor ?? 0) : null;
  const sessions = ps.length;
  return {
    key,
    label,
    sessions,
    sessionDates: ps.slice().sort((a, b) => a.t - b.t).map((p) => dateFmt.format(p.t)),
    seats,
    joinedLive,
    buyers,
    revenueEurMinor: revenue,
    tofCostEurMinor: tof,
    metaCostEurMinor: meta,
    seatsPerSession: sessions > 0 ? seats / sessions : 0,
    joinedLivePct: seats > 0 ? (joinedLive / seats) * 100 : null,
    conversionPct: seats > 0 ? (buyers / seats) * 100 : null,
    revenuePerSeatEurMinor: seats > 0 ? revenue / seats : null,
    costPerSeatEurMinor: tof != null && seats > 0 ? tof / seats : null,
    roas: tof != null && tof > 0 ? revenue / tof : null,
    profitPerSessionEurMinor: sessions > 0 ? (revenue - (meta ?? 0)) / sessions : 0,
    thin: sessions < MIN_SESSIONS,
  };
}

// Lower is better for cost; higher for everything else.
const BEST_COLUMNS: [BestColumn, 'max' | 'min'][] = [
  ['seatsPerSession', 'max'],
  ['joinedLivePct', 'max'],
  ['conversionPct', 'max'],
  ['revenuePerSeatEurMinor', 'max'],
  ['costPerSeatEurMinor', 'min'],
  ['roas', 'max'],
  ['profitPerSessionEurMinor', 'max'],
];

function bestOf(slots: TimeSlotStats[]): TimeSlotTable['best'] {
  const eligible = slots.filter((s) => !s.thin);
  const best: TimeSlotTable['best'] = {};
  if (eligible.length < 2) return best;
  for (const [col, dir] of BEST_COLUMNS) {
    let winner: TimeSlotStats | null = null;
    for (const s of eligible) {
      const v = s[col];
      if (v == null) continue;
      const w = winner?.[col];
      if (w == null || (dir === 'max' ? v > w : v < w)) winner = s;
    }
    if (winner) best[col] = winner.key;
  }
  return best;
}

// The held sessions this panel reads: dated, not a replay, already run, and
// with at least one seat in the window.
export function heldSessions(rows: WorkshopPerformanceRow[]): WorkshopPerformanceRow[] {
  return rows.filter((r) => !r.isReplay && !r.isUpcoming && r.registrations > 0);
}

export function timeSlotTables(rows: WorkshopPerformanceRow[]): TimeSlotTable[] {
  const placed = heldSessions(rows)
    .map(place)
    .filter((p): p is Placed => p != null);
  const tables: TimeSlotTable[] = [];
  for (const product of ['workshop', 'masterclass'] as const) {
    const mine = placed.filter((p) => (product === 'masterclass') === p.row.isMasterclass);
    if (mine.length === 0) continue;
    for (const grouping of ['slot', 'day', 'time'] as const) {
      const groups = new Map<string, { label: string; order: string; ps: Placed[] }>();
      for (const p of mine) {
        const k = keyOf(p, grouping);
        const g = groups.get(k.key) ?? { label: k.label, order: k.order, ps: [] };
        g.ps.push(p);
        groups.set(k.key, g);
      }
      const slots = [...groups.entries()]
        .sort(([, a], [, b]) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
        .map(([key, g]) => stats(key, g.label, g.ps));
      tables.push({
        product,
        grouping,
        slots,
        total: stats('total', 'All', mine),
        best: bestOf(slots),
      });
    }
  }
  return tables;
}
