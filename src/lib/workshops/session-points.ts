// The points behind the profit & ROAS per-session chart
// (src/components/admin/SessionProfitRoasChart.astro), built in one place for
// every page that draws it — /admin/workshops/performance and /ads — so the two
// can never plot different figures for the same session.
//
// One point per dated session that did something in the window, carrying the
// very figures its card prints: profit = revenue − Meta cost (every ad euro
// charged to it, prospecting + retargeting), ROAS = revenue ÷ TOF cost. An
// on-demand replay has no date to sit on, so it stays on the cards only.

import type { WorkshopPerformanceRow } from './stats';

export type SessionPoint = {
  id: number;
  title: string;
  dateLabel: string;
  t: number; // session start, ms since epoch
  kind: 'workshop' | 'masterclass';
  upcoming: boolean;
  profitEurMinor: number;
  roas: number | null;
  revenueEurMinor: number;
  metaCostEurMinor: number | null;
  tofCostEurMinor: number | null;
  registrations: number;
};

const startMs = (s: string): number => Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Brussels',
});

export function sessionChartPoints(rows: WorkshopPerformanceRow[]): SessionPoint[] {
  return rows
    .filter((r) => r.registrations > 0 || r.totalEurMinor > 0)
    .filter((r) => !r.isReplay && Number.isFinite(startMs(r.startsAtUtc)))
    .map((r) => ({
      id: r.workshopId,
      title: r.title.replace(/Somatic Vocal Healing/gi, 'SVH'),
      dateLabel: dateFmt.format(startMs(r.startsAtUtc)),
      t: startMs(r.startsAtUtc),
      kind: r.isMasterclass ? ('masterclass' as const) : ('workshop' as const),
      upcoming: r.isUpcoming,
      profitEurMinor: r.totalEurMinor - (r.metaCostEurMinor ?? 0),
      roas: r.workshopRoas,
      revenueEurMinor: r.totalEurMinor,
      metaCostEurMinor: r.metaCostEurMinor,
      tofCostEurMinor: r.acquisitionCostEurMinor,
      registrations: r.registrations,
    }))
    .sort((a, b) => a.t - b.t);
}
