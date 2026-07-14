// Build a marketing segment that the broadcast audience system can't express
// with tags alone, and materialise it as a normal contact tag.
//
// The motivating case (Jacob, July 2026): send a sale follow-up to people who
//   1. registered for a workshop,
//   2. whose workshop has ALREADY PASSED, and
//   3. haven't yet bought the 12-week or certification course.
//
// A broadcast can only filter on tags + one custom field — it has no notion of a
// workshop's date. And every session of a workshop shares one source_tag
// (m26_SVH_Workshop / m26_SVH_Masterclass), so the include tag alone can't tell a
// past attendee from someone registered for a still-open upcoming session. The
// separating fact — "the workshop this person registered for has already ended"
// — lives in `workshop_registrations ⋈ workshops` (which carries the dates), not
// on the contact. So we compute the cohort there and stamp it as a tag; the
// broadcast then targets that one tag like any other.
//
// Idempotent (INSERT OR IGNORE) and re-runnable: run it again before each send
// and it catches workshops that have passed since, and drops anyone who has since
// bought. As a launch-time freshness guard, the broadcast should ALSO keep the
// course-purchase tags (prod_SVH_12w / prod_SVH_9m) in its exclude list, so
// anyone who buys between tagging and send is filtered at snapshot time too.

import { TWELVE_WEEK_PRODUCT_SLUG } from '../courses/twelve-week';

// The default tag the segment is written under. Overridable per run so a campaign
// can carve its own (e.g. a dated tag), but a stable default means the broadcast
// can always target the same name and you just re-run the pass before launch.
export const PAST_WORKSHOP_SEGMENT_TAG = 'workshop-passed-nonbuyer';

// Course products whose purchase means "already bought" for this segment — the
// standalone 12-week, the certification, and the cert+foundation bundle. Matches
// courseDripTags: 12-week → prod_SVH_12w, cert/bundle → prod_SVH_9m (+12w).
const CONVERTED_COURSE_SLUGS = [TWELVE_WEEK_PRODUCT_SLUG, 'cc-cert', 'cc-bundle'];

// Tags are lowercased throughout contact_tags (see splitTags/importContacts), so
// normalise the segment tag the same way or the broadcast include won't match it.
function normalizeTag(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

export type PastWorkshopSegmentResult = {
  tag: string;
  added: number; // contact_tags rows inserted this run (new since last run)
  sendable: number; // contacts now carrying the tag, minus suppressions
};

// Tag every contact who registered (paid or coupon-comped) for a live workshop
// whose scheduled time has already passed, and who has NOT bought the 12-week or
// certification course. Only tags people who already have a contacts row (the
// purchase mirror + tag backfill create one for every registrant), so a tagged
// address is always a mailable contact. Returns how many were newly tagged and
// the current sendable size of the segment.
export async function buildPastWorkshopSegment(
  db: D1Database,
  opts: { tag?: string } = {},
): Promise<PastWorkshopSegmentResult> {
  const tag = normalizeTag(opts.tag) || PAST_WORKSHOP_SEGMENT_TAG;
  const slugPlaceholders = CONVERTED_COURSE_SLUGS.map(() => '?').join(',');

  // The cohort, evaluated entirely in SQL (no id lists → no D1 100-param cap):
  //   • paid/coupon workshop registration,
  //   • a live (non-replay), non-cancelled workshop whose end (or start, if no
  //     end recorded) is in the past — this is the "already passed" test that
  //     also excludes still-open upcoming sessions sharing the same source_tag,
  //   • the contact exists (so it's mailable),
  //   • hasn't bought a converting course,
  //   • isn't already suppressed.
  const insertSql = `
    INSERT OR IGNORE INTO contact_tags (email, tag)
    SELECT DISTINCT LOWER(TRIM(wr.email)), ?
      FROM workshop_registrations wr
      JOIN workshops w ON w.id = wr.workshop_id
     WHERE wr.payment_status IN ('paid','coupon')
       AND w.is_replay = 0
       AND w.status <> 'cancelled'
       AND w.deleted = 0
       AND COALESCE(w.ends_at_utc, w.starts_at_utc) < datetime('now')
       AND EXISTS (SELECT 1 FROM contacts c WHERE c.email = LOWER(TRIM(wr.email)))
       AND NOT EXISTS (
             SELECT 1 FROM course_registrations cr
              WHERE LOWER(TRIM(cr.email)) = LOWER(TRIM(wr.email))
                AND cr.status = 'paid'
                AND cr.product_slug IN (${slugPlaceholders})
           )
       AND NOT EXISTS (
             SELECT 1 FROM email_suppressions s WHERE s.email = LOWER(TRIM(wr.email))
           )
  `;
  const res = await db
    .prepare(insertSql)
    .bind(tag, ...CONVERTED_COURSE_SLUGS)
    .run();
  const added = Number(res.meta?.changes ?? 0);

  // Keep the denormalised display `tags` column on `contacts` in step with the
  // normalised table for anyone carrying the segment tag, so the People page and
  // the recent-contacts view show it (audience targeting reads contact_tags, so
  // it works regardless — this is cosmetic parity with the purchase mirror).
  await db
    .prepare(
      `UPDATE contacts
          SET tags = (
                SELECT group_concat(tag, ', ')
                  FROM (SELECT tag FROM contact_tags WHERE email = contacts.email ORDER BY tag)
              ),
              updated_at = datetime('now')
        WHERE email IN (SELECT email FROM contact_tags WHERE tag = ?)`,
    )
    .bind(tag)
    .run();

  // Current sendable size of the segment (what a broadcast including only this
  // tag would snapshot, before any exclude tags): contacts carrying it, minus
  // the suppression list.
  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM contacts c
        WHERE EXISTS (SELECT 1 FROM contact_tags t WHERE t.email = c.email AND t.tag = ?)
          AND NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email = c.email)`,
    )
    .bind(tag)
    .first<{ n: number }>();

  return { tag, added, sendable: countRow?.n ?? 0 };
}
