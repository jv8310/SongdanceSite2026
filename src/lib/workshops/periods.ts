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
