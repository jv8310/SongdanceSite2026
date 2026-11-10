// Google Calendar for the individual sessions: read the bookable windows (the
// "Boekingen" events) and everything else that makes Jacob busy, and write the
// booked session back as its own event.
//
// Reading uses the calendar connected under Settings → Calendar sync (the same
// one the workshops sync from). Writing needs calendar.events, which a
// connection made before November 2026 does not carry: then the write fails
// with a 403, the booking stands anyway (the database keeps the moment taken),
// and /admin/sessions says to press Connect again.

import { getAccessToken, GOOGLE_EVENTS_SCOPE, meetingOf, type GoogleCalConfig } from '../workshops/google-calendar';
import type { Interval, Window } from './slots';

type RawEvent = {
  id: string;
  status?: string; // 'confirmed' | 'tentative' | 'cancelled'
  summary?: string;
  location?: string;
  description?: string;
  transparency?: string; // 'opaque' (busy, default) | 'transparent' (free)
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string; passcode?: string; password?: string }>;
  };
  extendedProperties?: { private?: Record<string, string> };
};

export type CalendarRead = {
  windows: Window[];
  busy: Interval[];
};

// An all-day event's dates are calendar days; read them as Brussels days.
function allDayBounds(e: RawEvent): Interval | null {
  const s = e.start?.date;
  const en = e.end?.date;
  if (!s || !en) return null;
  const start = brusselsMidnight(s);
  const end = brusselsMidnight(en);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

function brusselsMidnight(day: string): number {
  // Midnight in Brussels is 22:00 or 23:00 UTC the day before; find the offset
  // for that day by formatting noon UTC in Brussels.
  const noon = new Date(`${day}T12:00:00Z`);
  const hh = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hourCycle: 'h23' }).format(noon),
  );
  const offsetH = hh - 12;
  return Date.parse(`${day}T00:00:00Z`) - offsetH * 3_600_000;
}

const declinedBySelf = (e: RawEvent) =>
  (e.attendees ?? []).some((a) => a.self && a.responseStatus === 'declined');

// Every event between timeMin and timeMax, split into bookable windows (title
// matches `windowTitle`) and busy time (anything else that shows him busy).
export async function readCalendarWindow(
  cfg: GoogleCalConfig,
  windowTitle: string,
  timeMin: Date,
  timeMax: Date,
  // A session being moved: its own calendar entry is not in its way.
  opts?: { ignoreBookingId?: number },
): Promise<CalendarRead> {
  const token = await getAccessToken(cfg);
  const wanted = windowTitle.trim().toLowerCase();
  const windows: Window[] = [];
  const busy: Interval[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events`,
    );
    url.searchParams.set('timeMin', timeMin.toISOString());
    url.searchParams.set('timeMax', timeMax.toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '250');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Google events.list: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { items?: RawEvent[]; nextPageToken?: string };

    for (const e of data.items ?? []) {
      if (e.status === 'cancelled') continue;
      const isWindow = (e.summary ?? '').trim().toLowerCase() === wanted;
      const timed = e.start?.dateTime && e.end?.dateTime;
      if (isWindow) {
        if (!timed) continue; // an all-day "Boekingen" names no hours
        const m = meetingOf(e);
        windows.push({
          start: Date.parse(e.start!.dateTime!),
          end: Date.parse(e.end!.dateTime!),
          eventId: e.id,
          joinUrl: m.joinUrl,
          passcode: m.passcode,
        });
        continue;
      }
      if (e.transparency === 'transparent' || declinedBySelf(e)) continue;
      if (
        opts?.ignoreBookingId &&
        e.extendedProperties?.private?.songdanceSessionBooking === String(opts.ignoreBookingId)
      ) continue;
      const iv = timed
        ? { start: Date.parse(e.start!.dateTime!), end: Date.parse(e.end!.dateTime!) }
        : allDayBounds(e);
      if (iv && Number.isFinite(iv.start) && Number.isFinite(iv.end)) busy.push(iv);
    }
    pageToken = data.nextPageToken;
    pages++;
  } while (pageToken && pages < 10);

  return { windows, busy };
}

// ── Writing the booked session ──────────────────────────────────────────────

export type SessionCalendarEvent = {
  bookingId: number;
  summary: string;
  description: string;
  startUtc: string;
  endUtc: string;
  joinUrl: string | null;
};

function eventBody(ev: SessionCalendarEvent) {
  return {
    summary: ev.summary,
    description: ev.description,
    location: ev.joinUrl ?? 'Zoom',
    start: { dateTime: ev.startUtc, timeZone: 'Europe/Brussels' },
    end: { dateTime: ev.endUtc, timeZone: 'Europe/Brussels' },
    // Shows him busy, so the slot engine also sees it on the next read.
    transparency: 'opaque',
    reminders: { useDefault: true },
    extendedProperties: { private: { songdanceSessionBooking: String(ev.bookingId) } },
  };
}

async function writeToken(cfg: GoogleCalConfig): Promise<string> {
  return getAccessToken(cfg, GOOGLE_EVENTS_SCOPE);
}

const eventsUrl = (cfg: GoogleCalConfig, id?: string) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events${id ? `/${encodeURIComponent(id)}` : ''}`;

// A plain sentence for the admin page from a failed write.
export function calendarWriteError(status: number, body: string): string {
  if (status === 403 && /insufficient|scope|forbidden|writer|permission/i.test(body)) {
    return 'The calendar connection is read-only. Settings → Calendar sync → Connect Google Calendar again, and allow it to edit events.';
  }
  if (status === 404) return 'The calendar or the event was not found.';
  return `Google answered ${status}: ${body.slice(0, 200)}`;
}

export async function insertSessionEvent(
  cfg: GoogleCalConfig,
  ev: SessionCalendarEvent,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(eventsUrl(cfg), {
      method: 'POST',
      headers: { Authorization: `Bearer ${await writeToken(cfg)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody(ev)),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: calendarWriteError(res.status, text) };
    const id = (JSON.parse(text) as { id?: string }).id;
    return id ? { ok: true, id } : { ok: false, error: 'Google returned no event id.' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function patchSessionEvent(
  cfg: GoogleCalConfig,
  eventId: string,
  ev: SessionCalendarEvent,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(eventsUrl(cfg, eventId), {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${await writeToken(cfg)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody(ev)),
    });
    if (!res.ok) return { ok: false, error: calendarWriteError(res.status, await res.text()) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function deleteSessionEvent(
  cfg: GoogleCalConfig,
  eventId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(eventsUrl(cfg, eventId), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${await writeToken(cfg)}` },
    });
    // 410 = already deleted, which is what we wanted.
    if (!res.ok && res.status !== 410 && res.status !== 404) {
      return { ok: false, error: calendarWriteError(res.status, await res.text()) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Whether the connected token may write events — for the admin page. Asks
// Google which scopes the current access token carries. null = could not tell.
export async function calendarCanWrite(cfg: GoogleCalConfig): Promise<boolean | null> {
  if (cfg.saJson) return null; // a service account asks per token; only a real write tells
  try {
    const token = await getAccessToken(cfg);
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const info = (await res.json()) as { scope?: string };
    const scopes = (info.scope ?? '').split(/\s+/);
    return scopes.includes(GOOGLE_EVENTS_SCOPE) || scopes.includes('https://www.googleapis.com/auth/calendar');
  } catch {
    return null;
  }
}
