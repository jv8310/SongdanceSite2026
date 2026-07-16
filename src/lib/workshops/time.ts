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

// Default calendar event duration when a workshop has no explicit end time.
export const DEFAULT_DURATION_MS = 60 * 60 * 1000;

export function endsAtOrDefault(startsAtUtc: string, endsAtUtc: string | null): string {
  if (endsAtUtc) return endsAtUtc;
  return new Date(new Date(startsAtUtc).getTime() + DEFAULT_DURATION_MS).toISOString();
}

// Rejoin window: someone who already joined once (clicked Join — attendance
// recorded) must be able to get back in for the WHOLE session — a Zoom drop
// mid-workshop must never lock them out behind the 20-minute latecomer gate.
// Their window closes only at the session's real end — the full 60 minutes of
// a workshop, the full 90 of a masterclass (from ends_at_utc, defaulting to
// start+60min) — plus a small grace for sessions that run over. Fresh joins
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

// Format an instant in a given IANA timezone, e.g. "Sun 15 Jun 2026, 20:00 CEST".
export function formatInTz(
  utcIso: string,
  timezone: string,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  const d = new Date(utcIso);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      ...opts,
    }).format(d);
  } catch {
    // Bad/unknown tz → fall back to UTC so we never throw on render.
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      ...opts,
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
