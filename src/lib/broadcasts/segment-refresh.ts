// Freshen the tag-based segments a broadcast targets, just before its audience
// is snapshotted — so a launch always sends against current data instead of tags
// last computed by hand. Two segments need this and neither keeps itself current
// for the whole list:
//
//   • `workshop-passed-nonbuyer` — time-dependent (workshops keep passing) and
//     add-only; rebuilt by buildPastWorkshopSegment (catches newly-passed
//     sessions + newly-created contacts, drops course-buyers via the exclude).
//   • `in-drip` — the buyer / also-in-Drip marker; live-stamped on new purchases
//     but its history came from a one-time, non-trim backfill (migration 0069)
//     that missed some rows. syncInDripTag recomputes it, trim-correct.
//
// Gated to the tags a broadcast actually uses (Jacob's "IF these are used"): a
// broadcast that references neither is a no-op, so an unrelated launch never
// triggers a list-wide re-tag. Each refresher is best-effort and independent — a
// failure is logged and swallowed so it can never block a launch; the snapshot
// then just uses whatever the tags already say.

import { buildPastWorkshopSegment, PAST_WORKSHOP_SEGMENT_TAG } from '../contacts/segments';
import { syncInDripTag, IN_DRIP_TAG } from '../contacts/mirror';
import { logEventSafe } from '../registrations/db';

export type SegmentRefreshResult = {
  // Rows newly tagged this run (undefined if that refresher didn't apply).
  segmentAdded?: number; // workshop-passed-nonbuyer
  inDripAdded?: number; // in-drip
};

// `tags` is the normalized (lowercased, trimmed) set of a broadcast's include +
// exclude tags — callers build it with splitTags() so membership matches the
// audience query exactly.
export async function refreshBroadcastSegments(
  db: D1Database,
  tags: Set<string>,
): Promise<SegmentRefreshResult> {
  const out: SegmentRefreshResult = {};

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
