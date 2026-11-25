// Drip → the site's contact list, so the list the broadcasts go to holds
// everyone Drip holds (Jacob, 25 Nov 2026: marketing is no longer sent from
// Drip, and every contact has to be here and reachable).
//
// Drip still collects people the site never sees as buyers: its own sign-up
// forms, and years of subscribers from before the site. The contact list began
// as a CSV export of Drip and has only grown by site purchases since, so it can
// be missing anyone who joined Drip after that export.
//
// What a run does, page by page (1,000 subscribers a page):
//   • every ACTIVE, deliverable subscriber becomes a contact when missing
//     (source 'drip'); an existing contact only gets a missing name, timezone
//     or country filled, and Drip's tags ADDED to its own (never replaced: the
//     site's computed tags, in-drip / app: / cert: / bfcm:, live there too);
//   • an active subscriber Drip has flagged undeliverable goes on the
//     suppression list (reason 'bounced', source 'drip');
//   • every UNSUBSCRIBED subscriber goes on the suppression list (reason
//     'unsubscribe', source 'drip'), whether or not they are a contact.
// It never lifts a suppression and never deletes anything, so a run can only
// add people and add do-not-mail rows. Someone active in Drip but suppressed
// here (they unsubscribed or bounced on the site's side) stays suppressed, and
// is counted by reason so the gap is visible.
//
// A run is resumable: its place (phase + page) is kept in workshop_config, the
// hourly cron moves it on a few pages per tick and starts a new run once a day,
// and the admin button drives it to the end in one go.

import { listSubscribersPage, type DripConfig, type DripListedSubscriber } from '../registrations/drip';
import { getConfig, setConfig } from '../workshops/db';
import { logEventSafe } from '../registrations/db';
import { normalizeTimezone } from '../broadcasts/db';

const STATE_KEY = 'drip_contact_sync';
const CHUNK = 400; // rows per json_each statement
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Prefixes the site computes itself: a Drip tag may never write into them.
const RESERVED = ['app:', 'cert:', 'bfcm:'];
const RESERVED_TAGS = new Set(['in-drip', 'workshop-passed-nonbuyer', 'risky']);
const DAY_MS = 86_400_000;

export type DripSyncCounts = {
  activeSeen: number;
  created: number; // contacts that did not exist before
  undeliverable: number; // active in Drip, flagged undeliverable → suppressed
  unsubscribedSeen: number;
  suppressionsAdded: number; // new do-not-mail rows (undeliverable + unsubscribed)
  // Active and deliverable in Drip, but on the site's do-not-mail list: by reason.
  activeButSuppressed: Record<string, number>;
};

export type DripSyncRun = DripSyncCounts & {
  startedAt: string;
  phase: 'active' | 'unsubscribed';
  page: number; // next page to read
  totalPages: number | null;
  activeTotal: number | null;
};

export type DripSyncState = {
  run: DripSyncRun | null; // a run under way
  last: (DripSyncCounts & { startedAt: string; finishedAt: string; activeTotal: number | null }) | null;
  error: { at: string; message: string } | null;
};

const emptyCounts = (): DripSyncCounts => ({
  activeSeen: 0,
  created: 0,
  undeliverable: 0,
  unsubscribedSeen: 0,
  suppressionsAdded: 0,
  activeButSuppressed: {},
});

export async function dripSyncState(db: D1Database): Promise<DripSyncState> {
  try {
    const raw = await getConfig(db, STATE_KEY);
    if (raw) return { run: null, last: null, error: null, ...(JSON.parse(raw) as Partial<DripSyncState>) };
  } catch {
    /* fall through */
  }
  return { run: null, last: null, error: null };
}

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

function cleanEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return EMAIL_RE.test(e) && e.length <= 254 ? e : null;
}

/** Drip's tags as the contact list writes them; the site's own names left out. */
export function dripTagsForContact(tags: string[]): string[] {
  const out = new Set<string>();
  for (const t of tags) {
    const tag = String(t ?? '').trim().toLowerCase();
    if (!tag || tag.length > 120 || tag.includes(',')) continue;
    if (RESERVED_TAGS.has(tag) || RESERVED.some((p) => tag.startsWith(p))) continue;
    out.add(tag);
  }
  return [...out];
}

function nameOf(s: DripListedSubscriber): string | null {
  const n = [s.first_name, s.last_name].filter(Boolean).join(' ').trim();
  return n || null;
}

async function countIn(db: D1Database, table: 'contacts' | 'email_suppressions', emails: string[]): Promise<number> {
  let n = 0;
  for (const part of chunks(emails)) {
    const r = await db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE email IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify(part))
      .first<{ n: number }>();
    n += r?.n ?? 0;
  }
  return n;
}

async function applyActivePage(db: D1Database, subs: DripListedSubscriber[], run: DripSyncRun): Promise<void> {
  const good = new Map<string, DripListedSubscriber>();
  const bad = new Set<string>();
  for (const s of subs) {
    const email = cleanEmail(s.email);
    if (!email) continue;
    if (s.deliverable === false) bad.add(email);
    else good.set(email, s);
  }
  const goodEmails = [...good.keys()];
  const badEmails = [...bad];
  run.activeSeen += good.size + bad.size;
  run.undeliverable += bad.size;

  const contactsBefore = await countIn(db, 'contacts', goodEmails);
  const suppressedBefore = await countIn(db, 'email_suppressions', badEmails);

  // Deliverable in Drip, yet on the site's do-not-mail list: why.
  for (const part of chunks(goodEmails)) {
    const r = await db
      .prepare(
        `SELECT reason, COUNT(*) AS n FROM email_suppressions
          WHERE email IN (SELECT value FROM json_each(?1)) GROUP BY reason`,
      )
      .bind(JSON.stringify(part))
      .all<{ reason: string; n: number }>();
    for (const row of r.results ?? []) {
      run.activeButSuppressed[row.reason] = (run.activeButSuppressed[row.reason] ?? 0) + row.n;
    }
  }

  const statements: D1PreparedStatement[] = [];
  const rows = [...good.entries()].map(([e, s]) => ({
    e,
    n: nameOf(s),
    z: normalizeTimezone(s.time_zone),
    c: s.country ?? null,
  }));
  for (const part of chunks(rows)) {
    statements.push(
      db
        .prepare(
          `INSERT INTO contacts (email, name, timezone, country, source)
             SELECT json_extract(value, '$.e'), json_extract(value, '$.n'), json_extract(value, '$.z'),
                    json_extract(value, '$.c'), 'drip'
               FROM json_each(?1) WHERE 1
           ON CONFLICT(email) DO UPDATE SET
             name = COALESCE(contacts.name, excluded.name),
             timezone = COALESCE(contacts.timezone, excluded.timezone),
             country = COALESCE(contacts.country, excluded.country),
             updated_at = datetime('now')
           WHERE (contacts.name IS NULL AND excluded.name IS NOT NULL)
              OR (contacts.timezone IS NULL AND excluded.timezone IS NOT NULL)
              OR (contacts.country IS NULL AND excluded.country IS NOT NULL)`,
        )
        .bind(JSON.stringify(part)),
    );
  }
  const pairs: Array<[string, string]> = [];
  for (const [e, s] of good) for (const t of dripTagsForContact(s.tags)) pairs.push([e, t]);
  for (const part of chunks(pairs)) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO contact_tags (email, tag)
             SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1)`,
        )
        .bind(JSON.stringify(part)),
    );
  }
  // The display column follows the normalized tags, only where it is behind.
  for (const part of chunks(goodEmails)) {
    statements.push(
      db
        .prepare(
          `UPDATE contacts
              SET tags = (SELECT group_concat(tag, ', ') FROM (SELECT tag FROM contact_tags t WHERE t.email = contacts.email ORDER BY tag))
            WHERE email IN (SELECT value FROM json_each(?1))
              AND COALESCE(tags, '') != COALESCE((SELECT group_concat(tag, ', ') FROM (SELECT tag FROM contact_tags t WHERE t.email = contacts.email ORDER BY tag)), '')`,
        )
        .bind(JSON.stringify(part)),
    );
  }
  for (const part of chunks(badEmails)) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO email_suppressions (email, reason, source)
             SELECT value, 'bounced', 'drip' FROM json_each(?1)`,
        )
        .bind(JSON.stringify(part)),
    );
  }
  if (statements.length) await db.batch(statements);

  run.created += good.size - contactsBefore;
  run.suppressionsAdded += bad.size - suppressedBefore;
}

async function applyUnsubscribedPage(db: D1Database, subs: DripListedSubscriber[], run: DripSyncRun): Promise<void> {
  const emails = [...new Set(subs.map((s) => cleanEmail(s.email)).filter((e): e is string => !!e))];
  run.unsubscribedSeen += emails.length;
  const before = await countIn(db, 'email_suppressions', emails);
  const statements = chunks(emails).map((part) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO email_suppressions (email, reason, source)
           SELECT value, 'unsubscribe', 'drip' FROM json_each(?1)`,
      )
      .bind(JSON.stringify(part)),
  );
  if (statements.length) await db.batch(statements);
  run.suppressionsAdded += emails.length - before;
}

export type DripSyncStep = { ok: true; done: boolean; state: DripSyncState } | { ok: false; message: string; state: DripSyncState };

/**
 * Move the sync on by up to `maxPages` pages. `start: true` begins a new run
 * when none is under way. Never throws: a failure is kept in the state and the
 * run stays where it was, so the next call tries the same page again.
 */
export async function stepDripContactSync(
  db: D1Database,
  cfg: DripConfig | null,
  opts: { maxPages?: number; start?: boolean } = {},
): Promise<DripSyncStep> {
  const state = await dripSyncState(db);
  if (!cfg) return { ok: false, message: 'Drip is not configured on this deployment.', state };
  if (!state.run) {
    if (!opts.start) return { ok: true, done: true, state };
    state.run = { ...emptyCounts(), startedAt: new Date().toISOString(), phase: 'active', page: 1, totalPages: null, activeTotal: null };
  }
  const run = state.run;
  const maxPages = Math.max(1, Math.min(20, opts.maxPages ?? 3));
  try {
    for (let i = 0; i < maxPages; i++) {
      const res = await listSubscribersPage(cfg, run.phase, run.page);
      run.totalPages = res.totalPages;
      if (run.phase === 'active') {
        run.activeTotal = res.totalCount;
        await applyActivePage(db, res.subscribers, run);
      } else {
        await applyUnsubscribedPage(db, res.subscribers, run);
      }
      run.page += 1;
      const phaseDone = run.page > res.totalPages || res.subscribers.length === 0;
      if (phaseDone && run.phase === 'active') {
        run.phase = 'unsubscribed';
        run.page = 1;
        run.totalPages = null;
      } else if (phaseDone) {
        const { phase: _p, page: _g, totalPages: _t, ...rest } = run;
        state.last = { ...rest, finishedAt: new Date().toISOString() };
        state.run = null;
        state.error = null;
        await setConfig(db, STATE_KEY, JSON.stringify(state));
        await logEventSafe(db, { registration_id: null, kind: 'contacts.drip_sync.done', source: 'system', payload: state.last });
        return { ok: true, done: true, state };
      }
      // Kept after every page, so a run cut short resumes where it was.
      state.error = null;
      await setConfig(db, STATE_KEY, JSON.stringify(state));
    }
    return { ok: true, done: false, state };
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 300);
    state.error = { at: new Date().toISOString(), message };
    try {
      await setConfig(db, STATE_KEY, JSON.stringify(state));
    } catch {
      /* the state stays as it was */
    }
    return { ok: false, message, state };
  }
}

/** The hourly cron: carry a run on, or start one when the last finished a day ago. */
export async function runDripContactSyncCron(db: D1Database, cfg: DripConfig | null): Promise<DripSyncStep | null> {
  if (!cfg) return null;
  const state = await dripSyncState(db);
  const due = !state.last || Date.now() - Date.parse(state.last.finishedAt) >= DAY_MS - 3_600_000;
  if (!state.run && !due) return null;
  return stepDripContactSync(db, cfg, { maxPages: 4, start: true });
}
