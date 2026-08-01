// The 12-week counter — which week of the foundation course a person is in.
//
// One row per email in `course_week_progress` (migration 0081). The week itself
// is never stored: it is DERIVED from `started_at`, the moment the course
// started for them (their payment). So the field is true at every read, with
// nothing having to tick it forward — a cron that misses a night can't leave
// someone stranded in week 4 forever.
//
//   week 1  = days 0-6 after the start
//   week 12 = days 77-83
//   day 84+ = the run is over → "Ended since YYYY-MM-DD" (the wording Jacob's
//             older Drip automation already used, and the one variant.ts parses)
//
// The other state a person can be in is the certification course: they bought
// the path and chose "Activate now", or they were mid-12-week and activated
// early (from /access, or the cert page). Then the field stops counting and
// reads "Ongoing Certification".
//
// Who writes it:
//   • src/lib/courses/paid-handler.ts — every paid course order (all gateways,
//     all backstops) starts the clock or flips it to certification.
//   • src/pages/api/courses/activate-now.ts — the early activation.
//   • src/lib/courses/week-sync.ts — pushes the current value onto the Drip
//     profile field `prod_SVH_week` as the weeks turn over.
//
// Who reads it: /access (the student's own view + the activation button),
// /admin/people/<email> (the profile field), and — via Drip — the cert page's
// variant gate.

export const TWELVE_WEEK_TOTAL_WEEKS = 12;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

// The exact string the profile field carries once someone is on the
// certification course. Kept as a constant because it is matched, not just
// displayed (the Drip sync compares against it; variant.ts parses it).
export const CERT_ONGOING_VALUE = 'Ongoing Certification';

export type WeekProgressState = 'twelve_week' | 'certification';
// How someone came to be on the certification course: they bought it and took
// it straight away, they activated it themselves mid-foundation (from /access
// or the certification page), or an admin moved them.
export type CertActivationSource = 'purchase' | 'self-service' | 'admin';

export type CourseWeekProgressRow = {
  email: string;
  started_at: string;
  state: WeekProgressState;
  cert_activated_at: string | null;
  cert_activated_source: string | null;
  course_registration_id: number | null;
  product_slug: string | null;
  drip_value: string | null;
  drip_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

// What the counter says right now, in every shape a caller needs.
export type WeekProgressStatus = {
  // 'twelve_week' while the clock runs, 'completed' once the 12 weeks are up,
  // 'certification' once they've moved on.
  state: 'twelve_week' | 'completed' | 'certification';
  // 1-12 while the clock runs; null otherwise.
  week: number | null;
  totalWeeks: number;
  startedAt: string;
  // YYYY-MM-DD the 12 weeks ended (or will end).
  endsOn: string;
  // Human-facing, e.g. "Week 3 of 12".
  label: string;
  // The value the `prod_SVH_week` profile field should carry.
  fieldValue: string;
  // True when they're inside weeks 1-12 — i.e. the certification course can
  // still be activated early. (Whether they OWN it is a separate check.)
  inTwelveWeek: boolean;
};

// D1 hands back 'YYYY-MM-DD HH:MM:SS' (UTC, no zone marker); older/imported
// rows may be ISO with a T and a Z. Parse both as UTC — a naive `new Date()` on
// the SQLite form is treated as LOCAL time by some runtimes, which would slide
// the whole count by the server's offset.
export function parseUtc(value: string | null | undefined): number | null {
  if (!value) return null;
  const s = value.trim();
  if (!s) return null;
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const ms = Date.parse(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(ms) ? null : ms;
}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// The week someone is in, counting from their start. 1-based and uncapped, so
// week 13+ means the run is over.
export function weekNumberAt(startedAtMs: number, nowMs: number): number {
  return Math.floor(Math.max(0, nowMs - startedAtMs) / WEEK_MS) + 1;
}

export function describeWeekProgress(
  row: Pick<CourseWeekProgressRow, 'started_at' | 'state'>,
  nowMs: number = Date.now(),
): WeekProgressStatus {
  const startedMs = parseUtc(row.started_at) ?? nowMs;
  const endsOn = ymd(startedMs + TWELVE_WEEK_TOTAL_WEEKS * WEEK_MS);
  const base = { totalWeeks: TWELVE_WEEK_TOTAL_WEEKS, startedAt: row.started_at, endsOn };

  if (row.state === 'certification') {
    return {
      ...base,
      state: 'certification',
      week: null,
      label: CERT_ONGOING_VALUE,
      fieldValue: CERT_ONGOING_VALUE,
      inTwelveWeek: false,
    };
  }

  const week = weekNumberAt(startedMs, nowMs);
  if (week > TWELVE_WEEK_TOTAL_WEEKS) {
    return {
      ...base,
      state: 'completed',
      week: null,
      label: `Completed — ended ${endsOn}`,
      fieldValue: `Ended since ${endsOn}`,
      inTwelveWeek: false,
    };
  }
  return {
    ...base,
    state: 'twelve_week',
    week,
    label: `Week ${week} of ${TWELVE_WEEK_TOTAL_WEEKS}`,
    fieldValue: String(week),
    inTwelveWeek: true,
  };
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

// ── Reads ───────────────────────────────────────────────────────────────────

export async function getWeekProgress(
  db: D1Database,
  email: string,
): Promise<CourseWeekProgressRow | null> {
  const e = normalizeEmail(email);
  if (!e) return null;
  return db
    .prepare('SELECT * FROM course_week_progress WHERE email = ?')
    .bind(e)
    .first<CourseWeekProgressRow>();
}

// The counter for a person, already resolved to "what does it say right now".
// Returns null when there's nothing to say (no 12-week, no certification).
export async function getWeekProgressStatus(
  db: D1Database,
  email: string,
  nowMs: number = Date.now(),
): Promise<WeekProgressStatus | null> {
  const row = await getWeekProgress(db, email);
  return row ? describeWeekProgress(row, nowMs) : null;
}

// ── Writes ──────────────────────────────────────────────────────────────────

export type StartTwelveWeekInput = {
  email: string;
  // The moment the course started for them — the order's paid_at (or, absent
  // that, when it was placed).
  startedAt: string;
  courseRegistrationId?: number | null;
  productSlug?: string | null;
  // True when the purchase itself CARRIES the 12-week course (the standalone
  // course, or the certification path) — that's a fresh run, so a previous run
  // that has already finished is restarted from this order. False when the
  // purchase merely happens alongside an existing run (a mid-12-week student
  // buying the certification on its own): then we never invent or move a clock.
  carriesTwelveWeek: boolean;
};

// Start (or leave alone) the 12-week clock. Idempotent by design: every
// fulfilment path calls the paid-handler, installment plans call it once per
// cycle, and the reconciles re-run it — none of that may move someone's week.
//
// Never downgrades a person who is already on the certification course.
export async function startTwelveWeekProgress(
  db: D1Database,
  input: StartTwelveWeekInput,
): Promise<CourseWeekProgressRow | null> {
  const email = normalizeEmail(input.email);
  const startedMs = parseUtc(input.startedAt);
  if (!email || startedMs == null) return null;
  const startedAt = new Date(startedMs).toISOString().slice(0, 19).replace('T', ' ');

  const existing = await getWeekProgress(db, email);

  if (!existing) {
    // No clock yet. A purchase that carries the course starts one; anything
    // else (cert-only, bought by someone we have no 12-week record for) leaves
    // the field empty rather than inventing a start date.
    if (!input.carriesTwelveWeek) return null;
    await db
      .prepare(
        `INSERT OR IGNORE INTO course_week_progress
           (email, started_at, state, course_registration_id, product_slug)
         VALUES (?, ?, 'twelve_week', ?, ?)`,
      )
      .bind(email, startedAt, input.courseRegistrationId ?? null, input.productSlug ?? null)
      .run();
    return getWeekProgress(db, email);
  }

  // Already on the certification course → the counter has moved past weeks.
  if (existing.state === 'certification') return existing;

  // The SAME order coming through fulfilment again is never a new run. An
  // installment plan calls the paid-handler once per cycle, and a 6×/12× plan
  // is still billing months after the foundation has finished — without this
  // guard the restart branch below would send that student back to week 1 every
  // month. Only a different purchase can start a new run.
  if (
    input.courseRegistrationId != null &&
    existing.course_registration_id === input.courseRegistrationId
  ) {
    return existing;
  }

  const current = describeWeekProgress(existing, Date.now());
  // A run still in flight keeps its own start date — buying the certification
  // path mid-foundation must not reset someone to week 1.
  if (current.state === 'twelve_week') return existing;

  // The previous run is finished and this order carries the course again →
  // a genuinely new run. Clear the sync marker so the sweep publishes week 1.
  if (!input.carriesTwelveWeek) return existing;
  await db
    .prepare(
      `UPDATE course_week_progress
          SET started_at = ?, state = 'twelve_week',
              cert_activated_at = NULL, cert_activated_source = NULL,
              course_registration_id = ?, product_slug = ?,
              drip_value = NULL, drip_synced_at = NULL,
              updated_at = datetime('now')
        WHERE email = ?`,
    )
    .bind(startedAt, input.courseRegistrationId ?? null, input.productSlug ?? null, email)
    .run();
  return getWeekProgress(db, email);
}

// Move someone onto the certification course: the counter stops and the field
// reads "Ongoing Certification". Idempotent — re-running keeps the first
// activation date. Creates the row when there was no 12-week clock (a cert-only
// buyer), so the profile field says something true for every student; its
// started_at then records when the certification began, and is never read as a
// week (the state settles that).
export async function markCertificationOngoing(
  db: D1Database,
  email: string,
  opts: {
    source: CertActivationSource;
    at?: string;
    courseRegistrationId?: number | null;
    productSlug?: string | null;
  },
): Promise<CourseWeekProgressRow | null> {
  const e = normalizeEmail(email);
  if (!e) return null;
  const atMs = parseUtc(opts.at ?? null) ?? Date.now();
  const at = new Date(atMs).toISOString().slice(0, 19).replace('T', ' ');

  const existing = await getWeekProgress(db, e);
  if (!existing) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO course_week_progress
           (email, started_at, state, cert_activated_at, cert_activated_source,
            course_registration_id, product_slug)
         VALUES (?, ?, 'certification', ?, ?, ?, ?)`,
      )
      .bind(
        e,
        at,
        at,
        opts.source,
        opts.courseRegistrationId ?? null,
        opts.productSlug ?? null,
      )
      .run();
    return getWeekProgress(db, e);
  }
  if (existing.state === 'certification') return existing;

  await db
    .prepare(
      `UPDATE course_week_progress
          SET state = 'certification',
              cert_activated_at = COALESCE(cert_activated_at, ?),
              cert_activated_source = COALESCE(cert_activated_source, ?),
              updated_at = datetime('now')
        WHERE email = ? AND state <> 'certification'`,
    )
    .bind(at, opts.source, e)
    .run();
  return getWeekProgress(db, e);
}

// Record what was last published to the Drip profile field, so the sweep can
// tell "unchanged" from "never pushed".
export async function recordWeekProgressSync(
  db: D1Database,
  email: string,
  value: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE course_week_progress
          SET drip_value = ?, drip_synced_at = datetime('now'), updated_at = datetime('now')
        WHERE email = ?`,
    )
    .bind(value, normalizeEmail(email))
    .run();
}

// Rows whose profile field is (or may be) out of date.
//
// For a running clock the value changes exactly when the person crosses into a
// new week, so compare the week BUCKET at `now` against the bucket at the last
// sync — same bucket, nothing to say. Buckets are clamped at 12 (day 84+ = the
// single "Ended since" bucket), which is what stops finished runs being
// re-pushed forever.
export async function listWeekProgressNeedingSync(
  db: D1Database,
  limit: number,
): Promise<CourseWeekProgressRow[]> {
  const r = await db
    .prepare(
      `SELECT * FROM course_week_progress
        WHERE (
                state = 'certification'
                AND (drip_value IS NULL OR drip_value <> ?)
              )
           OR (
                state = 'twelve_week'
                AND (
                     drip_value IS NULL
                  OR drip_synced_at IS NULL
                  OR MIN(CAST((julianday('now') - julianday(started_at)) / 7 AS INTEGER), ?)
                     <> MIN(CAST((julianday(drip_synced_at) - julianday(started_at)) / 7 AS INTEGER), ?)
                )
              )
        ORDER BY COALESCE(drip_synced_at, created_at) ASC
        LIMIT ?`,
    )
    .bind(CERT_ONGOING_VALUE, TWELVE_WEEK_TOTAL_WEEKS, TWELVE_WEEK_TOTAL_WEEKS, limit)
    .all<CourseWeekProgressRow>();
  return r.results ?? [];
}
