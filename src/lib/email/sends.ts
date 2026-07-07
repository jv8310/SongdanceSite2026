// Email engagement tracking — the data layer behind the email_sends table
// (migrations/0046). Every Resend send is recorded here with its message id and
// type; the Resend webhook (src/pages/api/webhooks/resend.ts) then folds
// open/click/bounce/complaint events back onto the matching row.
//
// Everything here is best-effort and defensive: the table may not exist yet on
// a preview that runs against production D1 before the migration has merged, so
// every write is wrapped and a missing table simply means "no stats yet" rather
// than a broken send. Recording a send must NEVER throw into the mail path.

import { suppressEmailWithReason } from './unsubscribe';

// The notification/email types the engine emits, mapped to a human group +
// label for the stats view. Unknown types fall back to their raw key, so a new
// email shows up in stats the moment it sends — it just isn't prettily named
// until added here. Keep in step with src/lib/workshops/email-samples.ts.
export const EMAIL_TYPE_META: Record<string, { group: string; label: string }> = {
  verification: { group: 'Transactional', label: 'Email verification code' },
  confirmation: { group: 'Transactional', label: 'Registration confirmation' },
  date_changed: { group: 'Transactional', label: 'Date change — moved to a new date' },
  reminder_7d: { group: 'Reminders', label: 'Reminder — one week out' },
  reminder_2d: { group: 'Reminders', label: 'Reminder — two days out' },
  reminder_1d: { group: 'Reminders', label: 'Reminder — tomorrow' },
  reminder_6h: { group: 'Reminders', label: 'Reminder — six hours' },
  reminder_1h: { group: 'Reminders', label: 'Reminder — one hour' },
  reminder_20m: { group: 'Reminders', label: 'Reminder — 20 minutes' },
  reminder_5m: { group: 'Reminders', label: "Reminder — we're live" },
  // Retired cadence (kept so historical sends still label in stats).
  reminder_15m: { group: 'Reminders', label: 'Reminder — 15 minutes' },
  at_time: { group: 'Reminders', label: "Reminder — we're starting" },
  abandoned_1: { group: 'Abandoned checkout', label: 'Nudge 1 — the open door' },
  abandoned_2: { group: 'Abandoned checkout', label: 'Nudge 2 — honest small print' },
  course_abandoned_1: { group: 'Abandoned checkout (courses)', label: 'Nudge 1 — the open door' },
  course_abandoned_2: { group: 'Abandoned checkout (courses)', label: 'Nudge 2 — honest small print' },
  post_attended: { group: 'Attended → 12-week', label: 'Email 1 — thank you + window opens' },
  post_attended_2: { group: 'Attended → 12-week', label: 'Email 2 — the case for the course' },
  post_attended_3: { group: 'Attended → 12-week', label: 'Email 3 — last chance' },
  post_attended_pro: { group: 'Attended PRO → certification', label: 'Email 1 — thank you + practitioner door' },
  post_attended_pro_2: { group: 'Attended PRO → certification', label: 'Email 2 — holding space is a craft' },
  post_attended_pro_3: { group: 'Attended PRO → certification', label: 'Email 3 — last note' },
  post_no_show: { group: 'Missed the workshop', label: 'Email 1 — seat is safe' },
  post_no_show_2: { group: 'Missed the workshop', label: 'Email 2 — rebook' },
  post_no_show_3: { group: 'Missed the workshop', label: 'Email 3 — last note' },
  downsell_1: { group: 'Downsell — after the window', label: 'Email 1 — installments + reply prompt' },
  downsell_2: { group: 'Downsell — after the window', label: 'Email 2 — free practice + calendar' },
};

export function emailTypeMeta(type: string): { group: string; label: string } {
  if (EMAIL_TYPE_META[type]) return EMAIL_TYPE_META[type];
  // One-off broadcasts track under `broadcast_<id>` (see src/lib/broadcasts);
  // group them together so the new-site blast etc. read cleanly in stats.
  if (type.startsWith('broadcast_')) {
    return { group: 'Broadcasts', label: `Broadcast #${type.slice('broadcast_'.length)}` };
  }
  return { group: 'Other', label: type };
}

// Record a send the moment Resend accepts it. Returns nothing meaningful;
// failures (including a missing table) are swallowed so mail is never blocked.
export async function recordEmailSend(
  db: D1Database,
  data: {
    resendId: string | null;
    type: string;
    to: string;
    subject?: string | null;
    registrationId?: number | null;
    variant?: string | null;
  },
): Promise<void> {
  // No id back from Resend → nothing to key webhook events on; skip quietly.
  if (!data.resendId) return;
  try {
    await db
      .prepare(
        `INSERT OR IGNORE INTO email_sends
           (resend_id, email_type, variant, registration_id, to_email, subject)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        data.resendId,
        data.type,
        data.variant ?? null,
        data.registrationId ?? null,
        data.to,
        data.subject ?? null,
      )
      .run();
  } catch {
    // Table not migrated yet (preview before merge), or a transient write
    // failure — stats are best-effort, the email already went out.
  }
}

// Same record, as a prepared statement for the caller to compose into a
// db.batch() — used by the broadcast drain, which sends a chunk via Resend's
// batch endpoint and then writes all the email_sends rows in one round-trip.
// Returns null when there's no id to key on (nothing to record). Keep in step
// with recordEmailSend above.
export function recordEmailSendStmt(
  db: D1Database,
  data: {
    resendId: string | null;
    type: string;
    to: string;
    subject?: string | null;
    registrationId?: number | null;
    variant?: string | null;
  },
): D1PreparedStatement | null {
  if (!data.resendId) return null;
  return db
    .prepare(
      `INSERT OR IGNORE INTO email_sends
         (resend_id, email_type, variant, registration_id, to_email, subject)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.resendId,
      data.type,
      data.variant ?? null,
      data.registrationId ?? null,
      data.to,
      data.subject ?? null,
    );
}

// Resend webhook event → the column(s) it touches on email_sends. Idempotent on
// the once-only timestamps (COALESCE keeps the first); counts increment on each
// open/click. Matched on resend_id; unknown ids (sends we didn't track) no-op.
export type ResendEventType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.delivery_delayed'
  | 'email.opened'
  | 'email.clicked'
  | 'email.bounced'
  | 'email.complained';

// Resend mirrors SES bounce types: 'Permanent' (hard — mailbox is gone),
// 'Transient' (soft — full/greylisted, may clear) and 'Undetermined'. Only a
// permanent bounce means the address will only ever bounce again. Be
// conservative: if Resend didn't tell us the type, treat it as soft and don't
// suppress — the bounce-checker reimport loop is the comprehensive cleanup.
function isPermanentBounce(bounceType?: string): boolean {
  return (bounceType ?? '').toLowerCase() === 'permanent';
}

export async function applyResendEvent(
  db: D1Database,
  type: string,
  resendId: string,
  atIso: string,
  opts: { bounceType?: string } = {},
): Promise<void> {
  let sql: string | null = null;
  let binds: string[] = [atIso, resendId];
  switch (type) {
    case 'email.delivered':
      sql = `UPDATE email_sends SET delivered_at = COALESCE(delivered_at, ?) WHERE resend_id = ?`;
      break;
    case 'email.opened':
      sql = `UPDATE email_sends
                SET first_opened_at = COALESCE(first_opened_at, ?),
                    last_opened_at = ?,
                    open_count = open_count + 1
              WHERE resend_id = ?`;
      binds = [atIso, atIso, resendId];
      break;
    case 'email.clicked':
      sql = `UPDATE email_sends
                SET first_clicked_at = COALESCE(first_clicked_at, ?),
                    last_clicked_at = ?,
                    click_count = click_count + 1
              WHERE resend_id = ?`;
      binds = [atIso, atIso, resendId];
      break;
    case 'email.bounced':
      // Stamp `bounced_at` for every bounce (the all-bounces display figure),
      // but mark `hard_bounced_at` only for a permanent one — the same test that
      // drives suppression below. The broadcast circuit breaker weighs hard
      // bounces only, so a transient/greylist bounce can't auto-pause a send.
      if (isPermanentBounce(opts.bounceType)) {
        sql = `UPDATE email_sends
                  SET bounced_at = COALESCE(bounced_at, ?),
                      hard_bounced_at = COALESCE(hard_bounced_at, ?)
                WHERE resend_id = ?`;
        binds = [atIso, atIso, resendId];
      } else {
        sql = `UPDATE email_sends SET bounced_at = COALESCE(bounced_at, ?) WHERE resend_id = ?`;
      }
      break;
    case 'email.complained':
      sql = `UPDATE email_sends SET complained_at = COALESCE(complained_at, ?) WHERE resend_id = ?`;
      break;
    default:
      // email.sent (already recorded), email.delivery_delayed, anything new.
      return;
  }
  await db.prepare(sql).bind(...binds).run();

  // A spam complaint MUST take the address off marketing, and a permanent
  // bounce will only bounce again — fold both onto the global suppression list
  // so they're skipped on every future marketing/broadcast send. (Transactional
  // mail ignores suppression, so this never blocks what someone paid for.)
  // Best-effort: a hiccup here must never fail the already-recorded webhook.
  const complaint = type === 'email.complained';
  const hardBounce = type === 'email.bounced' && isPermanentBounce(opts.bounceType);
  if (complaint || hardBounce) {
    try {
      const row = await db
        .prepare('SELECT to_email FROM email_sends WHERE resend_id = ?')
        .bind(resendId)
        .first<{ to_email: string | null }>();
      if (row?.to_email) {
        await suppressEmailWithReason(db, row.to_email, complaint ? 'complaint' : 'bounced', 'resend');
      }
    } catch {
      // best-effort — the bounce/complaint timestamp is already recorded.
    }
  }
}

export type EmailSendRow = {
  id: number;
  type: string;
  group: string;
  label: string;
  variant: string | null;
  subject: string | null;
  sentAt: string;
  deliveredAt: string | null;
  openedAt: string | null;
  openCount: number;
  clickedAt: string | null;
  clickCount: number;
  bouncedAt: string | null;
  hardBouncedAt: string | null;
  complainedAt: string | null;
};

// Every tracked send to one address, newest first — the People detail page's
// "emails sent" panel. Distinct from (and not a superset of)
// workshop_sent_notifications: this table only has rows from migration 0046
// onward and is Resend-webhook-driven, but it's the only place open/click/
// bounce data lives. Falls back to empty when the table isn't migrated yet.
export async function emailSendsForAddress(db: D1Database, email: string): Promise<EmailSendRow[]> {
  try {
    const r = await db
      .prepare(
        `SELECT id, email_type, variant, subject, sent_at, delivered_at,
                first_opened_at, open_count, first_clicked_at, click_count,
                bounced_at, hard_bounced_at, complained_at
           FROM email_sends
          WHERE lower(to_email) = ?
          ORDER BY sent_at DESC`,
      )
      .bind(email.trim().toLowerCase())
      .all<{
        id: number;
        email_type: string;
        variant: string | null;
        subject: string | null;
        sent_at: string;
        delivered_at: string | null;
        first_opened_at: string | null;
        open_count: number | null;
        first_clicked_at: string | null;
        click_count: number | null;
        bounced_at: string | null;
        hard_bounced_at: string | null;
        complained_at: string | null;
      }>();
    return (r.results ?? []).map((row) => {
      const meta = emailTypeMeta(row.email_type);
      return {
        id: row.id,
        type: row.email_type,
        group: meta.group,
        label: meta.label,
        variant: row.variant,
        subject: row.subject,
        sentAt: row.sent_at,
        deliveredAt: row.delivered_at,
        openedAt: row.first_opened_at,
        openCount: row.open_count ?? 0,
        clickedAt: row.first_clicked_at,
        clickCount: row.click_count ?? 0,
        bouncedAt: row.bounced_at,
        hardBouncedAt: row.hard_bounced_at,
        complainedAt: row.complained_at,
      };
    });
  } catch {
    return [];
  }
}

export type EmailTypeStats = {
  type: string;
  group: string;
  label: string;
  sent: number;
  delivered: number;
  opened: number; // unique (rows with a first_opened_at)
  clicked: number; // unique (rows with a first_clicked_at)
  bounced: number;
  complained: number;
  openRate: number; // opened / delivered (0..1), 0 when no deliveries
  clickRate: number; // clicked / delivered (0..1)
};

// Aggregate open/click rates per email type. Rates are over delivered mail (the
// honest denominator — an email that bounced was never a chance to open). Falls
// back to an empty list when the table doesn't exist yet.
export async function emailStatsByType(db: D1Database): Promise<EmailTypeStats[]> {
  try {
    const r = await db
      .prepare(
        `SELECT email_type AS type,
                COUNT(*) AS sent,
                SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
                SUM(CASE WHEN first_opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
                SUM(CASE WHEN first_clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
                SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) AS bounced,
                SUM(CASE WHEN complained_at IS NOT NULL THEN 1 ELSE 0 END) AS complained
           FROM email_sends
          GROUP BY email_type`,
      )
      .all<{
        type: string;
        sent: number;
        delivered: number;
        opened: number;
        clicked: number;
        bounced: number;
        complained: number;
      }>();
    const rows = r.results ?? [];
    return rows
      .map((row) => {
        const meta = emailTypeMeta(row.type);
        // No delivery webhooks yet (tracking just enabled) → fall back to sent
        // as the denominator so rates aren't all zero.
        const denom = row.delivered || row.sent || 0;
        return {
          type: row.type,
          group: meta.group,
          label: meta.label,
          sent: row.sent,
          delivered: row.delivered,
          opened: row.opened,
          clicked: row.clicked,
          bounced: row.bounced,
          complained: row.complained,
          openRate: denom ? row.opened / denom : 0,
          clickRate: denom ? row.clicked / denom : 0,
        };
      })
      .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group.localeCompare(b.group)));
  } catch {
    return [];
  }
}
