// The free moments, worked out from the calendar — pure, no I/O.
//
// Jacob places events titled "Boekingen" on his Google Calendar: each one is a
// window in which sessions can be booked. A window is cut into sessions of the
// set length, a buffer apart, and a moment is offered only when it does not
// touch (buffer included) anything else in the way:
//   - any other event on the calendar that shows him busy (a dentist, a
//     workshop, a session already written there),
//   - a booking held or confirmed on the site (the database is the truth for
//     those, even before the calendar shows them).
// Windows that overlap or touch are read as one. When a moment is blocked the
// next one starts on the first quarter hour after the blocking appointment and
// its buffer, so a short appointment costs as little of the window as it can.

export type Interval = { start: number; end: number }; // epoch ms

export type Window = Interval & {
  eventId: string;
  // A meeting link pasted on the "Boekingen" event (Zoom add-on, location or
  // description) — one of the fallbacks for the session's link.
  joinUrl: string | null;
  passcode: string | null;
};

export type Slot = {
  startUtc: string;
  endUtc: string;
  eventId: string;
};

export type SlotInput = {
  windows: Window[];
  busy: Interval[];
  durationMin: number;
  bufferMin: number;
  minNoticeHours: number;
  horizonDays: number;
  now: number;
};

const MIN = 60_000;
const QUARTER = 15 * MIN;

const ceilToQuarter = (t: number) => Math.ceil(t / QUARTER) * QUARTER;

// Overlapping / touching windows → one window (the first event's id and link).
export function mergeWindows(windows: Window[]): Window[] {
  const sorted = windows
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start);
  const out: Window[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) {
      last.end = Math.max(last.end, w.end);
      if (!last.joinUrl && w.joinUrl) {
        last.joinUrl = w.joinUrl;
        last.passcode = w.passcode;
      }
    } else {
      out.push({ ...w });
    }
  }
  return out;
}

export function computeSlots(input: SlotInput): Slot[] {
  const dur = Math.max(15, input.durationMin) * MIN;
  const buf = Math.max(0, input.bufferMin) * MIN;
  const earliest = input.now + Math.max(0, input.minNoticeHours) * 3_600_000;
  const latest = input.now + Math.max(1, input.horizonDays) * 86_400_000;
  const busy = input.busy.filter((b) => b.end > b.start);

  const out: Slot[] = [];
  for (const w of mergeWindows(input.windows)) {
    let t = w.start;
    // Never offer a moment before the notice period, but keep the window's own
    // rhythm where it can: jump to the first quarter hour at/after it.
    if (t < earliest) t = Math.max(t, ceilToQuarter(earliest));
    while (t + dur <= w.end && t <= latest) {
      const end = t + dur;
      let blockedUntil = 0;
      for (const b of busy) {
        if (t < b.end + buf && end > b.start - buf) blockedUntil = Math.max(blockedUntil, b.end + buf);
      }
      if (blockedUntil) {
        t = Math.max(t + QUARTER, ceilToQuarter(blockedUntil));
        continue;
      }
      out.push({
        startUtc: new Date(t).toISOString(),
        endUtc: new Date(end).toISOString(),
        eventId: w.eventId,
      });
      t = end + buf;
    }
  }
  return out.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}

// The window a moment sits in (for its meeting link), or null.
export function windowFor(windows: Window[], startUtc: string, endUtc: string): Window | null {
  const s = Date.parse(startUtc);
  const e = Date.parse(endUtc);
  return mergeWindows(windows).find((w) => w.start <= s && w.end >= e) ?? null;
}
