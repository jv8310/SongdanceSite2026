// Calendar sync — pulls a fixed set of Google Calendar events onto the site as
// live (published) workshops, so a date placed on the calendar is bookable on
// /workshop without any further admin step.
//
// The two recognised event types are HARD-CODED here on purpose: we only ever
// look for calendar events whose title is one of the `calendarTitle`s below,
// and we map each onto a workshop type (workshop vs masterclass) with its own
// product, bump, teacher and Drip tag. Add more entries here to teach the sync
// about new event types.
//
// Idempotency: each created workshop is keyed on the Google event id, so an
// event that already exists is skipped (never re-created or overwritten).

import {
  createSyncedWorkshop,
  getProductBySlug,
  googleEventExists,
} from './db';
import { findEventsByTitle } from './google-calendar';
import type { GoogleCalConfig } from './google-calendar';

export type SyncMapping = {
  // Exact title (case-insensitive) of the event as it appears on the calendar.
  calendarTitle: string;
  // Title the workshop gets on the site / in /admin/workshops.
  eventTitle: string;
  // 'workshop' | 'masterclass' — surfaced for the admin UI; the public page
  // classifies by product slug, so the productSlug below is what counts.
  kind: 'workshop' | 'masterclass';
  productSlug: string;       // ticket product
  bumpSlug: string | null;   // optional order-bump product
  sourceTag: string;         // Drip tag applied on a paid registration
  teacher: string;
  // Fallback duration in minutes when the calendar event has no end time.
  defaultDurationMin: number;
};

// The only two event types the sync recognises (hard-coded for now).
export const SYNC_MAPPINGS: SyncMapping[] = [
  {
    calendarTitle: 'SVH Workshop',
    eventTitle: 'Somatic Vocal Healing Workshop',
    kind: 'workshop',
    productSlug: 'svh-ticket',
    bumpSlug: 'mantra-empower-bump',
    sourceTag: 'svh_workshop_live',
    teacher: 'Jacob',
    defaultDurationMin: 70,
  },
  {
    calendarTitle: 'SVH Masterclass',
    eventTitle: 'Somatic Vocal Healing Masterclass',
    kind: 'masterclass',
    productSlug: 'svh-masterclass',
    bumpSlug: null,
    sourceTag: 'svh_masterclass_live',
    teacher: 'Jacob',
    defaultDurationMin: 100,
  },
];

export type SyncCreated = {
  id: number;
  title: string;
  kind: 'workshop' | 'masterclass';
  startsAtUtc: string;
};
export type SyncSkipped = { summary: string; startsAtUtc: string | null; reason: string };
export type SyncResult = { created: SyncCreated[]; skipped: SyncSkipped[] };

function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

// Run the sync for every mapping. Newly-found events become published
// workshops; events that already exist (by Google event id) are skipped.
export async function syncMappedEvents(
  db: D1Database,
  cfg: GoogleCalConfig,
  status: 'draft' | 'published' = 'published',
): Promise<SyncResult> {
  const created: SyncCreated[] = [];
  const skipped: SyncSkipped[] = [];

  for (const m of SYNC_MAPPINGS) {
    const product = await getProductBySlug(db, m.productSlug);
    const bump = m.bumpSlug ? await getProductBySlug(db, m.bumpSlug) : null;

    const events = await findEventsByTitle(cfg, m.calendarTitle);
    for (const ev of events) {
      if (ev.isAllDay || !ev.startUtc) {
        skipped.push({ summary: ev.summary, startsAtUtc: ev.startUtc, reason: 'all-day / no time' });
        continue;
      }
      if (await googleEventExists(db, ev.id)) {
        skipped.push({ summary: ev.summary, startsAtUtc: ev.startUtc, reason: 'already synced' });
        continue;
      }
      if (!product) {
        skipped.push({ summary: ev.summary, startsAtUtc: ev.startUtc, reason: `missing product ${m.productSlug}` });
        continue;
      }

      const id = await createSyncedWorkshop(db, {
        googleEventId: ev.id,
        title: m.eventTitle,
        teacher: m.teacher,
        startsAtUtc: ev.startUtc,
        endsAtUtc: ev.endUtc ?? addMinutesIso(ev.startUtc, m.defaultDurationMin),
        displayTz: ev.timeZone ?? 'Europe/Brussels',
        mainProductId: product.id,
        bumpProductId: bump?.id ?? null,
        sourceTag: m.sourceTag,
        status,
      });
      created.push({ id, title: m.eventTitle, kind: m.kind, startsAtUtc: ev.startUtc });
    }
  }

  return { created, skipped };
}
