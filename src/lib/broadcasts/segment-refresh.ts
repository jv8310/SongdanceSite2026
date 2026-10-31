// Freshen the tag-based segments a broadcast targets, just before its audience
// is snapshotted — so a launch always sends against current data instead of tags
// last computed by hand. Three kinds of tag need this and none keeps itself
// current for the whole list:
//
//   • `workshop-passed-nonbuyer` — time-dependent (workshops keep passing) and
//     add-only; rebuilt by buildPastWorkshopSegment (catches newly-passed
//     sessions + newly-created contacts, drops course-buyers via the exclude).
//   • `in-drip` — the buyer / also-in-Drip marker; live-stamped on new purchases
//     but its history came from a one-time, non-trim backfill (migration 0069)
//     that missed some rows. syncInDripTag recomputes it, trim-correct.
//   • `app:…` — the member app's tags (`app:member`, `app:course:<key>`, …),
//     asked of the app through APP_ADMIN by syncAppTags (app-tags.ts). Synced
//     hourly too; at launch it makes the queue the app's answer of this minute.
//     Only when the caller passes the env that carries the binding.
//
// Gated to the tags a broadcast actually uses (Jacob's "IF these are used"): a
// broadcast that references neither is a no-op, so an unrelated launch never
// triggers a list-wide re-tag. Each refresher is best-effort and independent — a
// failure is logged and swallowed so it can never block a launch; the snapshot
// then just uses whatever the tags already say.

import { buildPastWorkshopSegment, PAST_WORKSHOP_SEGMENT_TAG } from '../contacts/segments';
import { syncInDripTag, IN_DRIP_TAG } from '../contacts/mirror';
import { logEventSafe } from '../registrations/db';
import { syncAppTags, usesAppTags, type AppTagSyncResult } from './app-tags';

export type SegmentRefreshResult = {
  // Rows newly tagged this run (undefined if that refresher didn't apply).
  segmentAdded?: number; // workshop-passed-nonbuyer
  inDripAdded?: number; // in-drip
  appTags?: AppTagSyncResult; // app:… (the app's answer, or why there was none)
};

// `tags` is the normalized (lowercased, trimmed) set of a broadcast's include +
// exclude tags — callers build it with splitTags() so membership matches the
// audience query exactly.
export async function refreshBroadcastSegments(
  db: D1Database,
  tags: Set<string>,
  app?: { APP_ADMIN?: unknown },
): Promise<SegmentRefreshResult> {
  const out: SegmentRefreshResult = {};

  // syncAppTags never throws: a failure is its answer, and the tags stay as
  // the last sync left them.
  if (app && usesAppTags(tags)) {
    out.appTags = await syncAppTags({ DB: db, APP_ADMIN: app.APP_ADMIN });
  }

  if (tags.has(PAST_WORKSHOP_SEGMENT_TAG)) {
    try {
      const r = await buildPastWorkshopSegment(db);
      out.segmentAdded = r.added;
    } catch (err) {
      await logEventSafe(db, {
        registration_id: null,
        kind: 'broadcast.segment.refresh_error',
        source: 'system',
        payload: { segment: PAST_WORKSHOP_SEGMENT_TAG, error: String(err) },
      });
    }
  }

  if (tags.has(IN_DRIP_TAG)) {
    try {
      out.inDripAdded = await syncInDripTag(db);
    } catch (err) {
      await logEventSafe(db, {
        registration_id: null,
        kind: 'broadcast.segment.refresh_error',
        source: 'system',
        payload: { segment: IN_DRIP_TAG, error: String(err) },
      });
    }
  }

  return out;
}
