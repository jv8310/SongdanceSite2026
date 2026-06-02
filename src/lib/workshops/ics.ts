// "Add to calendar" — Google link + .ics file generation.
// Ports the legacy create_calendar_ics / create_calendar_link behaviour:
// 1-hour default duration, CRLF line endings, escaped fields.

import { endsAtOrDefault, toICSDate } from './time';

export type CalendarEvent = {
  title: string;
  startsAtUtc: string;
  endsAtUtc: string | null;
  description?: string;
  location?: string; // defaults to "On Zoom"
  url?: string; // join/countdown link
  uid?: string;
};

// Build a "Add to Google Calendar" template URL (UTC YYYYMMDDTHHMMSSZ).
export function googleCalendarUrl(ev: CalendarEvent): string {
  const start = toICSDate(ev.startsAtUtc);
  const end = toICSDate(endsAtOrDefault(ev.startsAtUtc, ev.endsAtUtc));
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${start}/${end}`,
    details: [ev.description, ev.url].filter(Boolean).join('\n\n'),
    location: ev.location ?? 'On Zoom',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function escapeICS(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Build a VCALENDAR string with CRLF endings.
export function buildICS(ev: CalendarEvent): string {
  const now = toICSDate(new Date().toISOString());
  const start = toICSDate(ev.startsAtUtc);
  const end = toICSDate(endsAtOrDefault(ev.startsAtUtc, ev.endsAtUtc));
  const uid = ev.uid ?? `${start}-${Math.random().toString(36).slice(2)}@songdance.co`;
  const desc = [ev.description, ev.url].filter(Boolean).join('\n\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Songdance//Workshop//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeICS(ev.title)}`,
    `DESCRIPTION:${escapeICS(desc)}`,
    `LOCATION:${escapeICS(ev.location ?? 'On Zoom')}`,
    ...(ev.url ? [`URL:${escapeICS(ev.url)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}
