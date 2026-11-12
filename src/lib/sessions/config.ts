// Individual sessions — the settings Jacob changes himself on /admin/sessions,
// stored in workshop_config (no deploy needed), with the defaults below.
//
// Kept free of heavy imports: the public page, the checkout, the cron and the
// admin all read it.

import { getConfig, setConfig } from '../workshops/db';

// One product slug for every booking. The payment rides course_registrations
// under it (see migrations/0097_session_bookings.sql).
export const SESSION_PRODUCT_SLUG = 'individual-session' as const;
export const SESSION_PRODUCT_LABEL = 'Individual session with Jacob';
export const SESSION_DRIP_TAG = 'prod_Session';
export const SESSION_DRIP_EVENT = 'Completed individual session booking';

export function isSessionProductSlug(slug: string | null | undefined): boolean {
  return slug === SESSION_PRODUCT_SLUG;
}

export type SessionSettings = {
  // EUR price in cents. 0 = booking closed (the page says it opens soon) — so
  // nothing is ever sold before Jacob has set a price.
  priceEurCents: number;
  durationMin: number;
  // Free time kept around every session and every other appointment.
  bufferMin: number;
  // The earliest a moment can be booked, counted from now.
  minNoticeHours: number;
  // How far ahead moments are offered.
  horizonDays: number;
  // Exact title (case-insensitive) of the calendar events that are bookable.
  calendarTitle: string;
  // The Zoom link used when the Zoom API is not connected and the "Boekingen"
  // event carries none: Jacob's personal meeting room, say.
  standardJoinUrl: string;
  standardPasscode: string;
  // Until how many hours before the session the client may move it themselves.
  rescheduleHours: number;
};

export const SESSION_DEFAULTS: SessionSettings = {
  priceEurCents: 0,
  durationMin: 60,
  bufferMin: 15,
  minNoticeHours: 24,
  horizonDays: 60,
  calendarTitle: 'Boekingen',
  standardJoinUrl: '',
  standardPasscode: '',
  rescheduleHours: 24,
};

const KEYS: Record<keyof SessionSettings, string> = {
  priceEurCents: 'sessions_price_eur_cents',
  durationMin: 'sessions_duration_min',
  bufferMin: 'sessions_buffer_min',
  minNoticeHours: 'sessions_min_notice_hours',
  horizonDays: 'sessions_horizon_days',
  calendarTitle: 'sessions_calendar_title',
  standardJoinUrl: 'sessions_standard_join_url',
  standardPasscode: 'sessions_standard_passcode',
  rescheduleHours: 'sessions_reschedule_hours',
};

const LIMITS: Partial<Record<keyof SessionSettings, [number, number]>> = {
  priceEurCents: [0, 1_000_000],
  durationMin: [15, 240],
  bufferMin: [0, 120],
  minNoticeHours: [0, 24 * 30],
  horizonDays: [1, 365],
  rescheduleHours: [0, 24 * 30],
};

function clampInt(v: number, key: keyof SessionSettings): number {
  const lim = LIMITS[key];
  const n = Math.round(v);
  if (!lim) return n;
  return Math.min(lim[1], Math.max(lim[0], n));
}

export async function loadSessionSettings(db: D1Database): Promise<SessionSettings> {
  const out: SessionSettings = { ...SESSION_DEFAULTS };
  let rows: Array<{ key: string; value: string }> = [];
  try {
    const r = await db
      .prepare(`SELECT key, value FROM workshop_config WHERE key LIKE 'sessions_%'`)
      .all<{ key: string; value: string }>();
    rows = r.results ?? [];
  } catch {
    return out;
  }
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  for (const k of Object.keys(KEYS) as Array<keyof SessionSettings>) {
    const raw = byKey.get(KEYS[k]);
    if (raw == null) continue;
    if (typeof SESSION_DEFAULTS[k] === 'number') {
      const n = Number(raw);
      if (Number.isFinite(n)) (out as Record<string, unknown>)[k] = clampInt(n, k);
    } else {
      (out as Record<string, unknown>)[k] = raw;
    }
  }
  if (!out.calendarTitle.trim()) out.calendarTitle = SESSION_DEFAULTS.calendarTitle;
  return out;
}

export async function saveSessionSettings(
  db: D1Database,
  patch: Partial<SessionSettings>,
): Promise<void> {
  for (const k of Object.keys(patch) as Array<keyof SessionSettings>) {
    const v = patch[k];
    if (v == null) continue;
    const value = typeof v === 'number' ? String(clampInt(v, k)) : String(v).trim();
    await setConfig(db, KEYS[k], value);
  }
}

export async function sessionSetting(db: D1Database, key: keyof SessionSettings): Promise<string | null> {
  return getConfig(db, KEYS[key]);
}

export const bookingOpen = (s: SessionSettings) => s.priceEurCents > 0;

// The price per market lives in ./price.ts (pure, so the page's script can
// repaint it); re-exported here for the server side.
export { sessionCurrencyForCountry, sessionPriceCents, sessionPriceLabel } from './price';
