// The free moments right now: calendar windows ("Boekingen") minus everything
// that makes Jacob busy, minus the bookings held or made on the site.

import { resolveGoogleConfig } from '../workshops/google-config';
import type { GoogleCalConfig } from '../workshops/google-calendar';
import { readCalendarWindow } from './calendar';
import { takenIntervals } from './db';
import { computeSlots, windowFor, type Slot, type Window } from './slots';
import type { SessionSettings } from './config';

export type AvailabilityEnv = {
  DB: D1Database;
  PUBLIC_BASE_URL: string;
  GOOGLE_SA_JSON?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REFRESH_TOKEN?: string;
  GOOGLE_CALENDAR_ID?: string;
};

export type Availability =
  | { ok: true; slots: Slot[]; windows: Window[]; windowCount: number; cfg: GoogleCalConfig }
  | { ok: false; error: 'not-connected' | 'calendar-error'; message: string };

export async function loadAvailability(
  env: AvailabilityEnv,
  settings: SessionSettings,
  opts?: { excludeBookingId?: number; now?: number },
): Promise<Availability> {
  const cfg = await resolveGoogleConfig(env.DB, env).catch(() => null);
  if (!cfg) {
    return { ok: false, error: 'not-connected', message: 'Google Calendar is not connected (Settings → Calendar sync).' };
  }
  const now = opts?.now ?? Date.now();
  const from = new Date(now);
  const to = new Date(now + (settings.horizonDays + 1) * 86_400_000);
  let read;
  try {
    read = await readCalendarWindow(cfg, settings.calendarTitle, from, to, {
      ignoreBookingId: opts?.excludeBookingId,
    });
  } catch (err) {
    return { ok: false, error: 'calendar-error', message: String(err).replace(/^Error:\s*/, '') };
  }
  const taken = await takenIntervals(env.DB, from.toISOString(), to.toISOString(), {
    excludeId: opts?.excludeBookingId,
  });
  const slots = computeSlots({
    windows: read.windows,
    busy: [...read.busy, ...taken],
    durationMin: settings.durationMin,
    bufferMin: settings.bufferMin,
    minNoticeHours: settings.minNoticeHours,
    horizonDays: settings.horizonDays,
    now,
  });
  return { ok: true, slots, windows: read.windows, windowCount: read.windows.length, cfg };
}

// Is this exact moment on offer right now? Returns the slot (with its window,
// for the meeting link) or null.
export function findOfferedSlot(
  av: Extract<Availability, { ok: true }>,
  startUtc: string,
): { slot: Slot; window: Window | null } | null {
  const t = Date.parse(startUtc);
  if (!Number.isFinite(t)) return null;
  const slot = av.slots.find((s) => Date.parse(s.startUtc) === t);
  if (!slot) return null;
  return { slot, window: windowFor(av.windows, slot.startUtc, slot.endUtc) };
}
