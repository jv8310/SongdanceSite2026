// Period presets + date arithmetic for the admin stats pages. "Today" is
// resolved in Europe/Brussels — the business timezone — while all stored
// datetimes remain UTC.

export const PERIOD_PRESETS: Array<[string, string]> = [
  ['all', 'All time'],
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['last7', 'Last 7 days'],
  ['last30', 'Last 30 days'],
  ['last90', 'Last 90 days'],
  ['wtd', 'Week to date'],
  ['mtd', 'Month to date'],
  ['qtd', 'Quarter to date'],
  ['ytd', 'Year to date'],
  ['lastmonth', 'Last month'],
  ['custom', 'Custom range'],
];

export function brusselsToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());
}

export function shiftDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function shiftYears(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y + n, m - 1, d)).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function presetRange(
  preset: string,
  today: string = brusselsToday(),
): { from: string | null; to: string | null } {
  const [y, m, d] = today.split('-').map((s) => parseInt(s, 10));
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const x = shiftDays(today, -1); return { from: x, to: x }; }
    case 'last7': return { from: shiftDays(today, -6), to: today };
    case 'last30': return { from: shiftDays(today, -29), to: today };
    case 'last90': return { from: shiftDays(today, -89), to: today };
    case 'wtd': { // Monday-start week
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      return { from: shiftDays(today, -((dow + 6) % 7)), to: today };
    }
    case 'mtd': return { from: `${today.slice(0, 8)}01`, to: today };
    case 'qtd': {
      const qm = m - ((m - 1) % 3);
      return { from: `${y}-${String(qm).padStart(2, '0')}-01`, to: today };
    }
    case 'ytd': return { from: `${y}-01-01`, to: today };
    case 'lastmonth': {
      const first = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
      const last = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
      return { from: first, to: last };
    }
    default: return { from: null, to: null }; // 'all'
  }
}

const isYmd = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Resolve ?preset=&from=&to= into a concrete window. A preset wins over the
// date inputs (they're just prefilled for transparency); bare from/to without
// a preset reads as a custom range.
//
// `fallback` is what an unparameterised URL means. It defaults to 'all' (every
// page that just wants the whole history), but the live dashboards open on
// 'today' — they are read to answer "how is today going", and an all-time
// figure buries that under a year of history.
export function resolvePeriod(
  params: URLSearchParams,
  fallback: string = 'all',
): {
  preset: string;
  from: string | null;
  to: string | null;
} {
  const qFrom = params.get('from');
  const qTo = params.get('to');
  const rawPreset = params.get('preset');
  const preset =
    rawPreset && PERIOD_PRESETS.some(([v]) => v === rawPreset)
      ? rawPreset
      : isYmd(qFrom) || isYmd(qTo)
        ? 'custom'
        : fallback;
  if (preset === 'custom') {
    return { preset, from: isYmd(qFrom) ? qFrom : null, to: isYmd(qTo) ? qTo : null };
  }
  return { preset, ...presetRange(preset) };
}

// All preset windows as a map, for the filter form's client-side JS.
export function presetRangesMap(): Record<string, { from: string | null; to: string | null }> {
  const today = brusselsToday();
  return Object.fromEntries(
    PERIOD_PRESETS.filter(([v]) => v !== 'custom').map(([v]) => [v, presetRange(v, today)]),
  );
}

// ---------------------------------------------------------------------------
// "Include costs for future events / Exclude costs" — the other filter both
// dashboards carry.
//
// Ad spend is paid before an event happens; the revenue that spend buys (the
// ticket, and weeks later the 12-week / certification sale) lands after it. So
// every window that reaches today carries the cost of sessions that haven't run
// yet against none of the income they will produce, and ROAS reads permanently
// behind the facts — worst of all on "all time", the window that should be the
// honest one. Excluding upcoming events leaves the ROAS of what has actually
// happened.

export const FUTURE_COSTS_PARAM = 'future';

/** True when the reader asked to leave upcoming sessions out of the window. */
export function excludeFutureEventsFrom(params: URLSearchParams): boolean {
  return params.get(FUTURE_COSTS_PARAM) === 'exclude';
}

// ---------------------------------------------------------------------------
// Business days, in UTC.
//
// A window's `from` / `to` are Brussels calendar days — every preset resolves
// "today" there — but every row is stamped in UTC (SQLite's datetime('now'):
// 'YYYY-MM-DD HH:MM:SS'). Filtering rows on `from` … `to 23:59:59` and bucketing
// them on their first ten characters therefore read a UTC day as if it were a
// Brussels one: a sale at 00:30 on a Brussels Tuesday (22:30 UTC Monday) landed
// in Monday's figures and Monday's SD-REPORT. These turn a Brussels day into the
// UTC instants that bound it, and a UTC stamp into the Brussels day it fell on,
// so windows and daily buckets are business days end to end. (Ad spend is
// already per calendar day — `spend_date`, in the Meta ad account's timezone —
// and needs neither.)

const BUSINESS_TZ = 'Europe/Brussels';

const wallClock = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const businessDate = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ });

// Brussels' offset from UTC at an instant, in ms (+1h in winter, +2h in summer).
function businessOffsetMs(ms: number): number {
  const p: Record<string, number> = {};
  for (const part of wallClock.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = parseInt(part.value, 10);
  }
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return wall - (ms - (ms % 1000));
}

const sqliteStamp = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** The UTC instant (ms) a Brussels calendar day begins. */
export function businessDayStartMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map((s) => parseInt(s, 10));
  const midnightAsUtc = Date.UTC(y, m - 1, d);
  // Brussels changes clocks at 01:00 UTC, never across its own midnight, so the
  // offset one guess away is the offset at midnight — re-checked all the same.
  let start = midnightAsUtc - businessOffsetMs(midnightAsUtc);
  const settled = midnightAsUtc - businessOffsetMs(start);
  if (settled !== start) start = settled;
  return start;
}

/**
 * SQL bounds for a Brussels window over a UTC 'YYYY-MM-DD HH:MM:SS' column:
 * rows with `start <= col < end`. A missing side is open (all time).
 */
export function businessWindowUtc(
  from: string | null | undefined,
  to: string | null | undefined,
): { start: string | null; end: string | null } {
  return {
    start: from ? sqliteStamp(businessDayStartMs(from)) : null,
    end: to ? sqliteStamp(businessDayStartMs(shiftDays(to, 1))) : null,
  };
}

// The Brussels day depends only on the UTC hour a stamp falls in (the offset is
// whole hours), so memoise per hour: a busy window's thousands of rows format a
// few hundred dates, not thousands.
const dayByUtcHour = new Map<number, string>();

/** The Brussels calendar day (YYYY-MM-DD) a UTC stamp or instant falls on. */
export function businessDayOf(ts: string | number | null | undefined): string {
  let ms: number;
  if (typeof ts === 'number') ms = ts;
  else {
    const s = (ts ?? '').trim();
    if (!s) return '';
    ms = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
    if (!Number.isFinite(ms)) return s.slice(0, 10);
  }
  const hour = Math.floor(ms / 3_600_000);
  let day = dayByUtcHour.get(hour);
  if (day === undefined) {
    day = businessDate.format(new Date(ms));
    if (dayByUtcHour.size > 20_000) dayByUtcHour.clear();
    dayByUtcHour.set(hour, day);
  }
  return day;
}
