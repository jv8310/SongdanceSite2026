// UTC <-> timezone helpers for the workshop engine.
//
// We store all workshop times as UTC ISO-8601 strings ("…Z") and carry a
// display timezone (IANA) on the workshop. Display formatting uses
// Intl.DateTimeFormat with that timezone; the live countdown is computed
// against Date.now() on the client.

// Join window around the start, in seconds. The Join button (and the Zoom
// fallback reveal) open 5 minutes before the start and close 20 minutes after
// it. Past that the room can't be reached at all — latecomers are sent to the
// replay / a free rebooking instead.
export const JOIN_OPEN_BEFORE_SECONDS = 5 * 60;
export const JOIN_CLOSE_AFTER_SECONDS = 20 * 60;

// State of the live join window relative to `now`:
//   'early'  — too soon, show the countdown
//   'open'   — within [start-5m, start+20m], Join is live
//   'closed' — the window has passed; treat as missed (replay / new date)
export type JoinWindow = 'early' | 'open' | 'closed';
export function joinWindow(startsAtUtc: string, now = Date.now()): JoinWindow {
  const start = new Date(startsAtUtc).getTime();
  if (now < start - JOIN_OPEN_BEFORE_SECONDS * 1000) return 'early';
  if (now > start + JOIN_CLOSE_AFTER_SECONDS * 1000) return 'closed';
  return 'open';
}

// Default calendar event duration when a workshop has no explicit end time
// (70 minutes — the standard workshop length; masterclasses carry an explicit
// 100-minute end, so this fallback rarely applies to them).
export const DEFAULT_DURATION_MS = 70 * 60 * 1000;

export function endsAtOrDefault(startsAtUtc: string, endsAtUtc: string | null): string {
  if (endsAtUtc) return endsAtUtc;
  return new Date(new Date(startsAtUtc).getTime() + DEFAULT_DURATION_MS).toISOString();
}

// Rejoin window: someone who already joined once (clicked Join — attendance
// recorded) must be able to get back in for the WHOLE session — a Zoom drop
// mid-workshop must never lock them out behind the 20-minute latecomer gate.
// Their window closes only at the session's real end — the full 70 minutes of
// a workshop, the full 100 of a masterclass (from ends_at_utc, defaulting to
// start+70min) — plus a small grace for sessions that run over. Fresh joins
// keep the original start+20min gate.
export const REJOIN_GRACE_AFTER_END_SECONDS = 10 * 60;

export function joinWindowFor(
  startsAtUtc: string,
  endsAtUtc: string | null,
  hasJoined: boolean,
  now = Date.now(),
): JoinWindow {
  const fresh = joinWindow(startsAtUtc, now);
  if (fresh !== 'closed' || !hasJoined) return fresh;
  const end = new Date(endsAtOrDefault(startsAtUtc, endsAtUtc)).getTime();
  return now <= end + REJOIN_GRACE_AFTER_END_SECONDS * 1000 ? 'open' : 'closed';
}

// ── Naming the timezone ─────────────────────────────────────────────────────
// A time is only useful if the reader knows which clock it's on, and "10:00
// GMT-4" makes people do arithmetic they shouldn't have to (and half of them
// get it wrong, or read it as our time rather than theirs). We show the zone as
// the place it is named after instead — "10:00 New York time" — derived from
// the IANA id we already store, so there is no table to keep current.

// A handful of IANA ids still carry the city's old name. Print the modern one.
const TZ_CITY_ALIASES: Record<string, string> = {
  Calcutta: 'Kolkata',
  'Ho Chi Minh': 'Ho Chi Minh City',
  Kiev: 'Kyiv',
  Rangoon: 'Yangon',
  Saigon: 'Ho Chi Minh City',
  Katmandu: 'Kathmandu',
};

// "America/New_York" → "New York", "Asia/Kolkata" → "Kolkata",
// "America/Argentina/Buenos_Aires" → "Buenos Aires", "UTC" → "UTC".
// Returns null when the id names no place we can print honestly (the Etc/GMT+5
// family, whose sign is inverted from what anyone expects, and anything that
// doesn't look like a city) — the caller then falls back to Intl's own label.
export function timezoneLabel(timezone: string | null | undefined): string | null {
  const id = (timezone || '').trim();
  if (!id) return null;
  if (/^(utc|gmt|z|etc\/(utc|gmt|zulu|greenwich|universal))$/i.test(id)) return 'UTC';
  if (/^etc\//i.test(id)) return null;
  const city = (id.split('/').pop() || '').replace(/_/g, ' ').trim();
  if (!/^[A-Za-z][A-Za-z '.-]*$/.test(city)) return null;
  return TZ_CITY_ALIASES[city] ?? city;
}

// The zone as it reads after a time: "New York time", "UTC".
function tzSuffix(label: string): string {
  return label === 'UTC' ? 'UTC' : `${label} time`;
}

// Format an instant in a given IANA timezone, e.g.
// "Sun 15 Jun 2026, 20:00 Brussels time". The zone is named only when the
// format actually carries a time (a date on its own is the same day in the
// neighbouring zones, so naming one would be noise).
export function formatInTz(
  utcIso: string,
  timezone: string,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  const d = new Date(utcIso);
  const label = timezoneLabel(timezone);
  const base: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    // Named below as a place instead. Where we can't name one, let Intl print
    // its own short label so the time is never left bare.
    ...(label ? {} : { timeZoneName: 'short' }),
    ...opts,
  };
  const suffix = label && base.hour !== undefined ? ` ${tzSuffix(label)}` : '';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, ...base }).format(d) + suffix;
  } catch {
    // Bad/unknown tz → fall back to UTC so we never throw on render. Intl's own
    // short name for UTC is "UTC", so there is nothing to append here.
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      ...base,
      ...(base.hour === undefined ? {} : { timeZoneName: 'short' }),
    }).format(d);
  }
}

// ICS / Google "dates" basic format: YYYYMMDDTHHMMSSZ (UTC).
export function toICSDate(utcIso: string): string {
  return new Date(utcIso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Minutes from `now` until the workshop start (negative once it has started).
export function minutesUntil(startsAtUtc: string, now = Date.now()): number {
  return (new Date(startsAtUtc).getTime() - now) / 60000;
}

// ── Quiet-hours / send-window (timezone-aware sending) ──────────────────────
// Non-urgent email (early reminders + lifecycle marketing) is held to the
// recipient's local daytime so a send computed during their night waits until
// morning. Time-critical mail (the imminent reminders and the discount-deadline
// emails) ignores this and always goes on schedule.

// Inclusive start, exclusive end: a 24h clock 08:00–21:00 local.
export const SEND_WINDOW_START_HOUR = 8;
export const SEND_WINDOW_END_HOUR = 21;
// Used when a registrant has no stored timezone (e.g. replay sign-ups).
export const DEFAULT_SEND_TZ = 'Europe/Brussels';

// The 0–23 local hour in `tz` at `now`. Unknown/bad tz → 12 (midday), so a
// missing timezone never blocks a send — it just always reads as in-window.
export function localHour(tz: string, now = Date.now()): number {
  try {
    const s = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(now));
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n % 24 : 12;
  } catch {
    return 12;
  }
}

// Is it inside the local send window for this recipient right now?
export function withinSendWindow(
  tz: string | null | undefined,
  now = Date.now(),
  fallbackTz: string = DEFAULT_SEND_TZ,
): boolean {
  const h = localHour(tz || fallbackTz, now);
  return h >= SEND_WINDOW_START_HOUR && h < SEND_WINDOW_END_HOUR;
}
