// UTC <-> timezone helpers for the workshop engine.
//
// We store all workshop times as UTC ISO-8601 strings ("…Z") and carry a
// display timezone (IANA) on the workshop. Display formatting uses
// Intl.DateTimeFormat with that timezone; the live countdown is computed
// against Date.now() on the client.

// Join window, in seconds. The Join button (and the Zoom fallback reveal) open
// 5 minutes before the start and stay reachable for the WHOLE live session —
// until JOIN_GRACE_AFTER_SECONDS past its end (a session that runs a little
// long, clock skew, a straggler rejoining). Only after that has the event
// truly passed.
export const JOIN_OPEN_BEFORE_SECONDS = 5 * 60;
export const JOIN_GRACE_AFTER_SECONDS = 15 * 60;

// State of the live join window relative to `now`:
//   'early'  — too soon, show the countdown
//   'open'   — within [start-5m, end+grace], Join is live for the whole session
//   'closed' — the session has passed; treat as missed (replay / new date)
export type JoinWindow = 'early' | 'open' | 'closed';
export function joinWindow(
  startsAtUtc: string,
  endsAtUtc: string | null,
  now = Date.now(),
): JoinWindow {
  const start = new Date(startsAtUtc).getTime();
  const end = new Date(endsAtOrDefault(startsAtUtc, endsAtUtc)).getTime();
  if (now < start - JOIN_OPEN_BEFORE_SECONDS * 1000) return 'early';
  if (now > end + JOIN_GRACE_AFTER_SECONDS * 1000) return 'closed';
  return 'open';
}

// Default calendar event duration when a workshop has no explicit end time.
export const DEFAULT_DURATION_MS = 60 * 60 * 1000;

export function endsAtOrDefault(startsAtUtc: string, endsAtUtc: string | null): string {
  if (endsAtUtc) return endsAtUtc;
  return new Date(new Date(startsAtUtc).getTime() + DEFAULT_DURATION_MS).toISOString();
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
