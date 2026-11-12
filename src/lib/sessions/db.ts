// session_bookings — reads and writes (migrations/0097_session_bookings.sql).
//
// The one rule that matters: two bookings never share a moment. Taking a
// moment (a hold at checkout, or a move) is a single INSERT … SELECT / UPDATE
// that checks for an overlap in the same statement, so two buyers pressing pay
// at once cannot both get it — SQLite runs one statement at a time.

export type SessionBookingStatus = 'held' | 'booked' | 'conflict' | 'cancelled' | 'expired';

export type SessionBooking = {
  id: number;
  status: SessionBookingStatus;
  starts_at_utc: string;
  ends_at_utc: string;
  duration_min: number;
  source_event_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  timezone: string | null;
  note: string | null;
  course_registration_id: number | null;
  hold_expires_at: string | null;
  confirmed_at: string | null;
  zoom_meeting_id: string | null;
  join_url: string | null;
  join_passcode: string | null;
  join_source: string | null;
  calendar_event_id: string | null;
  calendar_error: string | null;
  reminder_24h_sent_at: string | null;
  reminder_1h_sent_at: string | null;
  reschedule_count: number;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
};

// How long a moment is kept for someone on the payment page. The Stripe page
// itself closes after 30 minutes (expires_at), so it can never be paid after
// the hold has lapsed; PayPal can, rarely — see the conflict path in confirm.ts.
export const HOLD_MINUTES = 35;

const nowIso = () => new Date().toISOString();

// A row keeps its moment while it is booked / in conflict (paid), or held and
// its hold has not run out. `buffer` keeps the same free time around it the
// slot engine keeps.
const TAKEN_SQL = `(status IN ('booked','conflict') OR (status = 'held' AND hold_expires_at > ?))`;

export async function takenIntervals(
  db: D1Database,
  fromIso: string,
  toIso: string,
  opts?: { excludeId?: number },
): Promise<Array<{ start: number; end: number }>> {
  let rows: Array<{ starts_at_utc: string; ends_at_utc: string }> = [];
  try {
    const r = await db
      .prepare(
        `SELECT starts_at_utc, ends_at_utc FROM session_bookings
          WHERE ${TAKEN_SQL} AND ends_at_utc > ? AND starts_at_utc < ? AND id != ?`,
      )
      .bind(nowIso(), fromIso, toIso, opts?.excludeId ?? 0)
      .all<{ starts_at_utc: string; ends_at_utc: string }>();
    rows = r.results ?? [];
  } catch {
    // Only before migration 0097 has run (a preview on the live database):
    // nothing can have been booked yet, and taking a moment fails loudly on
    // its own INSERT.
    rows = [];
  }
  return rows.map((x) => ({ start: Date.parse(x.starts_at_utc), end: Date.parse(x.ends_at_utc) }));
}

// Takes the moment for a checkout, or returns null when anything taken
// (buffer included) overlaps it.
export async function createHold(
  db: D1Database,
  input: {
    startsAtUtc: string;
    endsAtUtc: string;
    durationMin: number;
    bufferMin: number;
    sourceEventId: string | null;
    email: string;
    firstName: string;
    lastName: string;
    timezone: string | null;
    note: string | null;
  },
): Promise<number | null> {
  const now = nowIso();
  const holdUntil = new Date(Date.now() + HOLD_MINUTES * 60_000).toISOString();
  const bufMs = input.bufferMin * 60_000;
  const padStart = new Date(Date.parse(input.startsAtUtc) - bufMs).toISOString();
  const padEnd = new Date(Date.parse(input.endsAtUtc) + bufMs).toISOString();
  const res = await db
    .prepare(
      `INSERT INTO session_bookings
         (status, starts_at_utc, ends_at_utc, duration_min, source_event_id,
          email, first_name, last_name, timezone, note, hold_expires_at)
       SELECT 'held', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM session_bookings
           WHERE ${TAKEN_SQL} AND starts_at_utc < ? AND ends_at_utc > ?
        )`,
    )
    .bind(
      input.startsAtUtc,
      input.endsAtUtc,
      input.durationMin,
      input.sourceEventId,
      input.email,
      input.firstName,
      input.lastName,
      input.timezone,
      input.note,
      holdUntil,
      now,
      padEnd,
      padStart,
    )
    .run();
  if ((res.meta?.changes ?? 0) === 0) return null;
  const id = res.meta?.last_row_id;
  return typeof id === 'number' ? id : null;
}

export async function attachRegistration(db: D1Database, bookingId: number, courseRegistrationId: number) {
  await db
    .prepare(`UPDATE session_bookings SET course_registration_id = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(courseRegistrationId, bookingId)
    .run();
}

export async function getBooking(db: D1Database, id: number): Promise<SessionBooking | null> {
  return (await db.prepare(`SELECT * FROM session_bookings WHERE id = ?`).bind(id).first<SessionBooking>()) ?? null;
}

export async function getBookingByRegistration(db: D1Database, regId: number): Promise<SessionBooking | null> {
  return (
    (await db
      .prepare(`SELECT * FROM session_bookings WHERE course_registration_id = ? ORDER BY id DESC LIMIT 1`)
      .bind(regId)
      .first<SessionBooking>()) ?? null
  );
}

// Release a hold nobody paid for (the buyer came back from the payment page).
export async function releaseHold(db: D1Database, id: number): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE session_bookings SET status = 'expired', hold_expires_at = ?, updated_at = datetime('now')
        WHERE id = ? AND status = 'held'`,
    )
    .bind(nowIso(), id)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

// The same person starting a checkout for the same moment again (back from
// the payment page with the browser's Back button, not its cancel link): their
// own unpaid hold must not stand in their way.
export async function releaseOwnHolds(db: D1Database, email: string, startsAtUtc: string): Promise<void> {
  await db
    .prepare(
      `UPDATE session_bookings SET status = 'expired', updated_at = datetime('now')
        WHERE status = 'held' AND lower(email) = ? AND starts_at_utc = ?
          AND (course_registration_id IS NULL OR NOT EXISTS (
                SELECT 1 FROM course_registrations c
                 WHERE c.id = session_bookings.course_registration_id AND c.status = 'paid'))`,
    )
    .bind(email.trim().toLowerCase(), startsAtUtc)
    .run();
}

// held → booked, if nobody else holds the moment now. A hold that lapsed is
// taken again when the moment is still free (a late PayPal return); otherwise
// the row goes to 'conflict'. Returns what happened.
export async function claimBooked(
  db: D1Database,
  b: SessionBooking,
  bufferMin: number,
): Promise<'booked' | 'conflict' | 'already'> {
  if (b.status === 'booked') return 'already';
  if (b.status !== 'held' && b.status !== 'expired') return 'already';
  const bufMs = bufferMin * 60_000;
  const padStart = new Date(Date.parse(b.starts_at_utc) - bufMs).toISOString();
  const padEnd = new Date(Date.parse(b.ends_at_utc) + bufMs).toISOString();
  const r = await db
    .prepare(
      `UPDATE session_bookings
          SET status = 'booked', confirmed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND status IN ('held','expired')
          AND NOT EXISTS (
            SELECT 1 FROM session_bookings o
             WHERE o.id != ? AND (o.status IN ('booked','conflict') OR (o.status = 'held' AND o.hold_expires_at > ?))
               AND o.starts_at_utc < ? AND o.ends_at_utc > ?
          )`,
    )
    .bind(b.id, b.id, nowIso(), padEnd, padStart)
    .run();
  if ((r.meta?.changes ?? 0) > 0) return 'booked';
  const again = await getBooking(db, b.id);
  if (again?.status === 'booked') return 'already';
  await db
    .prepare(
      `UPDATE session_bookings SET status = 'conflict', confirmed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND status IN ('held','expired')`,
    )
    .bind(b.id)
    .run();
  return 'conflict';
}

// Move a booked session to a new moment, if it is free (the session itself
// does not count against its own move).
export async function moveBooking(
  db: D1Database,
  id: number,
  input: { startsAtUtc: string; endsAtUtc: string; durationMin: number; bufferMin: number; sourceEventId: string | null },
): Promise<boolean> {
  const bufMs = input.bufferMin * 60_000;
  const padStart = new Date(Date.parse(input.startsAtUtc) - bufMs).toISOString();
  const padEnd = new Date(Date.parse(input.endsAtUtc) + bufMs).toISOString();
  const r = await db
    .prepare(
      `UPDATE session_bookings
          SET starts_at_utc = ?, ends_at_utc = ?, duration_min = ?, source_event_id = ?,
              reminder_24h_sent_at = NULL, reminder_1h_sent_at = NULL,
              reschedule_count = reschedule_count + 1, updated_at = datetime('now')
        WHERE id = ? AND status = 'booked'
          AND NOT EXISTS (
            SELECT 1 FROM session_bookings o
             WHERE o.id != ? AND (o.status IN ('booked','conflict') OR (o.status = 'held' AND o.hold_expires_at > ?))
               AND o.starts_at_utc < ? AND o.ends_at_utc > ?
          )`,
    )
    .bind(
      input.startsAtUtc,
      input.endsAtUtc,
      input.durationMin,
      input.sourceEventId,
      id,
      id,
      nowIso(),
      padEnd,
      padStart,
    )
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function setMeeting(
  db: D1Database,
  id: number,
  m: { zoomMeetingId: string | null; joinUrl: string | null; passcode: string | null; source: string | null },
) {
  await db
    .prepare(
      `UPDATE session_bookings
          SET zoom_meeting_id = ?, join_url = ?, join_passcode = ?, join_source = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(m.zoomMeetingId, m.joinUrl, m.passcode, m.source, id)
    .run();
}

export async function setCalendarResult(
  db: D1Database,
  id: number,
  r: { eventId?: string | null; error?: string | null },
) {
  await db
    .prepare(
      `UPDATE session_bookings
          SET calendar_event_id = COALESCE(?, calendar_event_id), calendar_error = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(r.eventId ?? null, r.error ?? null, id)
    .run();
}

export async function markCancelled(db: D1Database, id: number, reason: string): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE session_bookings
          SET status = 'cancelled', cancelled_at = datetime('now'), cancel_reason = ?, updated_at = datetime('now')
        WHERE id = ? AND status IN ('held','booked','conflict')`,
    )
    .bind(reason.slice(0, 300), id)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

// Claim a reminder (compare-and-swap on its column); false = someone else has.
export async function claimReminder(db: D1Database, id: number, which: '24h' | '1h'): Promise<boolean> {
  const col = which === '24h' ? 'reminder_24h_sent_at' : 'reminder_1h_sent_at';
  const r = await db
    .prepare(`UPDATE session_bookings SET ${col} = datetime('now') WHERE id = ? AND ${col} IS NULL AND status = 'booked'`)
    .bind(id)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function releaseReminder(db: D1Database, id: number, which: '24h' | '1h') {
  const col = which === '24h' ? 'reminder_24h_sent_at' : 'reminder_1h_sent_at';
  await db.prepare(`UPDATE session_bookings SET ${col} = NULL WHERE id = ?`).bind(id).run();
}

// Booked sessions that start between the two instants.
export async function bookedBetween(db: D1Database, fromIso: string, toIso: string): Promise<SessionBooking[]> {
  const r = await db
    .prepare(
      `SELECT * FROM session_bookings
        WHERE status = 'booked' AND starts_at_utc >= ? AND starts_at_utc < ?
        ORDER BY starts_at_utc`,
    )
    .bind(fromIso, toIso)
    .all<SessionBooking>();
  return r.results ?? [];
}

export type AdminBookingRow = SessionBooking & {
  reg_status: string | null;
  reg_amount_cents: number | null;
  reg_currency: string | null;
  reg_refunded_cents: number | null;
};

export async function listBookingsForAdmin(
  db: D1Database,
  opts: { upcoming: boolean; limit?: number },
): Promise<AdminBookingRow[]> {
  const now = nowIso();
  const where = opts.upcoming
    ? `b.ends_at_utc >= ?1 AND (b.status IN ('booked','conflict') OR (b.status = 'held' AND b.hold_expires_at > ?1))`
    : `b.status = 'cancelled' OR (b.ends_at_utc < ?1 AND b.status IN ('booked','conflict'))`;
  const r = await db
    .prepare(
      `SELECT b.*, c.status AS reg_status, c.amount_cents AS reg_amount_cents, c.currency AS reg_currency,
              c.refunded_amount_cents AS reg_refunded_cents
         FROM session_bookings b
         LEFT JOIN course_registrations c ON c.id = b.course_registration_id
        WHERE ${where}
        ORDER BY b.starts_at_utc ${opts.upcoming ? 'ASC' : 'DESC'}
        LIMIT ?2`,
    )
    .bind(now, opts.limit ?? 100)
    .all<AdminBookingRow>();
  return r.results ?? [];
}

// A link typed in by hand on /admin/sessions wins over whatever the booking had;
// a Zoom API meeting id is kept, so cancelling still removes that meeting.
export async function setJoinLinkByAdmin(db: D1Database, id: number, url: string, passcode: string | null) {
  await db
    .prepare(
      `UPDATE session_bookings SET join_url = ?, join_passcode = ?, join_source = 'admin', updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(url, passcode, id)
    .run();
}
