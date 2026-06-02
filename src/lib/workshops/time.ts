// UTC <-> timezone helpers for the workshop engine.
//
// We store all workshop times as UTC ISO-8601 strings ("…Z") and carry a
// display timezone (IANA) on the workshop. Display formatting uses
// Intl.DateTimeFormat with that timezone; the live countdown is computed
// against Date.now() on the client.

// 15-minute Zoom join threshold, in seconds (matches the legacy hard-coded
// 900s). The Join button appears within this window before start.
export const JOIN_THRESHOLD_SECONDS = 900;

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
