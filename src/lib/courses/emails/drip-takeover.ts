// Taking the ASJ weekly emails over from Drip — for the people already in
// Drip's series, at the week each of them has reached.
//
// "Bring in earlier buyers" (./sequences.ts) can only reach orders paid on the
// site; most people on Drip's two weekly series bought before the site took
// payments, so the site has no order for them. Drip does know exactly where
// each of them stands: every series subscription carries the index of the last
// email sent and when it went (`last_sent_email_index`, `last_sent_email_at`).
// This reads that, enrols the person on the site's own series at the NEXT week
// — keeping their rhythm, the week after their last Drip email, at 08:00 their
// time — and takes them off the Drip series in the same step, so nobody gets a
// week twice or misses one, and there is no need to pause the series by hand.
//
// It runs from the hourly cron, a batch per tick (one Drip call per person),
// only while its switch is on (`drip_takeover_on:<sequence>`, pressed on
// /admin/emails/courses) AND the course's own `asj` handover switch is on — it
// sends people into the CiRCLE, so it waits for the app like everything else.
// Left on, it also picks up anyone the Drip workflow still adds to the series.
// Each person is settled once (an `events` claim, `drip-takeover-<seq>-<email>`):
// moved, already on the site's series, or finished in Drip.

import { logEventSafe } from '../../registrations/db';
import {
  listCampaignSubscribers,
  listSubscriberCampaignSubscriptions,
  removeFromCampaign,
  type DripConfig,
} from '../../registrations/drip';
import { ASJ_WEEK_COUNT } from './asj-weeks';
import { loadHandover } from './handover';
import { dueAtMs, SEQUENCES, sqlUtc, utcMs } from './sequences';

export type TakeoverKey = 'asj-weekly' | 'asj-weekly-nl';

// The Drip email series each site series replaces.
export const DRIP_SERIES: Record<TakeoverKey, { campaignId: string; name: string }> = {
  'asj-weekly': { campaignId: '808009203', name: 'prod_ASJ' },
  'asj-weekly-nl': { campaignId: '866191894', name: 'prod_JAZ' },
};

export function isTakeoverKey(v: unknown): v is TakeoverKey {
  return v === 'asj-weekly' || v === 'asj-weekly-nl';
}

// The week a Drip email index covers (the last week the person has had).
// Both series: 0 = welcome (opens Week 1), 1 = the day-3 note, then week N at
// index N. The Dutch series drifts after week 28: index 29 is the combined
// "Week 29 en 30" mail, 30–36 are weeks 31–37, 37 is the "Integratietijd"
// interlude (still week 37), and 38–40 are weeks 38–40 again.
export function weekReached(key: TakeoverKey, index: number): number {
  if (index <= 1) return 1;
  if (key === 'asj-weekly' || index <= 28) return Math.min(index, ASJ_WEEK_COUNT);
  if (index === 29) return 30;
  if (index <= 36) return index + 1;
  if (index === 37) return 37;
  return Math.min(index, ASJ_WEEK_COUNT);
}

const SWITCH_PREFIX = 'drip_takeover_on:';
const BATCH = 60; // people per hourly tick (one Drip read + one write each)

export async function loadTakeover(db: D1Database): Promise<Map<TakeoverKey, string>> {
  const out = new Map<TakeoverKey, string>();
  try {
    const { results } = await db
      .prepare(`SELECT key, value FROM workshop_config WHERE key LIKE ?`)
      .bind(`${SWITCH_PREFIX}%`)
      .all<{ key: string; value: string }>();
    for (const r of results ?? []) {
      const k = r.key.slice(SWITCH_PREFIX.length);
      if (isTakeoverKey(k) && r.value) out.set(k, r.value);
    }
  } catch {
    /* off */
  }
  return out;
}

export async function setTakeover(db: D1Database, key: TakeoverKey, on: boolean): Promise<void> {
  const k = `${SWITCH_PREFIX}${key}`;
  if (on) {
    await db
      .prepare(`INSERT INTO workshop_config (key, value) VALUES (?, datetime('now')) ON CONFLICT(key) DO NOTHING`)
      .bind(k)
      .run();
  } else {
    await db.prepare(`DELETE FROM workshop_config WHERE key = ?`).bind(k).run();
  }
}

const claimPrefix = (key: TakeoverKey) => `drip-takeover-${key}-`;

async function settledEmails(db: D1Database, key: TakeoverKey): Promise<Set<string>> {
  const p = claimPrefix(key);
  const { results } = await db
    .prepare(`SELECT external_id FROM events WHERE external_id >= ? AND external_id < ?`)
    .bind(p, `${p.slice(0, -1)}.`)
    .all<{ external_id: string }>();
  return new Set((results ?? []).map((r) => r.external_id.slice(p.length)));
}

async function settle(db: D1Database, key: TakeoverKey, email: string, outcome: string, payload: object) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id, payload_json)
       VALUES (NULL, 'course.emails.drip_takeover', 'cron', ?, ?)`,
    )
    .bind(`${claimPrefix(key)}${email}`, JSON.stringify({ outcome, ...payload }))
    .run();
}

// How many are moved / still in Drip — for the admin page.
export async function takeoverCounts(db: D1Database, key: TakeoverKey): Promise<{ moved: number; settled: number }> {
  try {
    const p = claimPrefix(key);
    const r = await db
      .prepare(
        `SELECT COUNT(*) AS settled,
                SUM(CASE WHEN json_extract(payload_json, '$.outcome') = 'moved' THEN 1 ELSE 0 END) AS moved
           FROM events WHERE external_id >= ? AND external_id < ?`,
      )
      .bind(p, `${p.slice(0, -1)}.`)
      .first<{ settled: number; moved: number | null }>();
    return { moved: r?.moved ?? 0, settled: r?.settled ?? 0 };
  } catch {
    return { moved: 0, settled: 0 };
  }
}

type TakeoverEnv = { DB: D1Database; DRIP_API_TOKEN?: string; DRIP_ACCOUNT_ID?: string };

export type TakeoverResult = { key: TakeoverKey; inDrip: number; moved: number; skipped: number; failed: number };

// One batch. `nowMs` is injectable for tests.
export async function runDripTakeover(
  env: TakeoverEnv,
  opts: { nowMs?: number; batch?: number } = {},
): Promise<TakeoverResult[]> {
  if (!env.DRIP_API_TOKEN || !env.DRIP_ACCOUNT_ID) return [];
  const cfg: DripConfig = { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID };
  const [on, handover] = await Promise.all([loadTakeover(env.DB), loadHandover(env.DB)]);
  if (!handover.has('asj')) return [];
  const nowMs = opts.nowMs ?? Date.now();
  const out: TakeoverResult[] = [];

  for (const key of on.keys()) {
    const { campaignId } = DRIP_SERIES[key];
    const res: TakeoverResult = { key, inDrip: 0, moved: 0, skipped: 0, failed: 0 };
    out.push(res);
    let budget = opts.batch ?? BATCH;
    const settled = await settledEmails(env.DB, key);

    for (let page = 1; budget > 0; page++) {
      const { subscribers, totalPages, totalCount } = await listCampaignSubscribers(cfg, campaignId, page);
      res.inDrip = totalCount;
      for (const s of subscribers) {
        if (budget <= 0) break;
        const email = s.email.trim().toLowerCase();
        if (settled.has(email)) continue;
        budget--;
        try {
          const sub = (await listSubscriberCampaignSubscriptions(cfg, s.id)).find(
            (c) => c.campaign_id === campaignId && c.status === 'active',
          );
          if (!sub || sub.is_complete || sub.last_sent_email_index == null) {
            // Finished, or not yet sent anything (Drip will send the welcome;
            // the next pass picks them up once it has).
            if (sub?.is_complete || !sub) {
              await settle(env.DB, key, email, sub ? 'complete' : 'not-in-series', {});
              res.skipped++;
            }
            continue;
          }
          const reached = weekReached(key, sub.last_sent_email_index);
          if (reached >= ASJ_WEEK_COUNT) {
            await settle(env.DB, key, email, 'complete', { index: sub.last_sent_email_index });
            res.skipped++;
            continue;
          }
          const next = reached + 1;
          // Keep their rhythm: the week after their last Drip email, 08:00 their
          // time — or the next tick, if that day is already behind us (the Dutch
          // series has been paused). The series' start is set back from that
          // first send so every later week follows a week apart.
          const def = SEQUENCES[key];
          const step = def.steps.find((st) => st.n === next);
          if (!step) {
            await settle(env.DB, key, email, 'complete', { index: sub.last_sent_email_index });
            res.skipped++;
            continue;
          }
          const lastMs = utcMs(sub.last_sent_email_at) || nowMs;
          let dueMs = dueAtMs(lastMs, 7, s.time_zone, def.sendHour);
          if (dueMs < nowMs) dueMs = nowMs;
          const startMs = dueMs - step.dayOffset * 86_400_000;

          const ins = await env.DB
            .prepare(
              `INSERT OR IGNORE INTO course_email_sequences
                 (sequence, email, first_name, timezone, course_registration_id, variant,
                  started_at, next_step, next_due_at)
               VALUES (?, ?, ?, ?, NULL, 'drip', ?, ?, ?)`,
            )
            .bind(key, email, s.first_name, s.time_zone, sqlUtc(startMs), next, sqlUtc(dueMs))
            .run();
          // Off the Drip series either way: if the site already had them (an
          // order brought in earlier), Drip must stop too.
          await removeFromCampaign(cfg, s.id, campaignId);
          const already = (ins.meta?.changes ?? 0) === 0;
          await settle(env.DB, key, email, already ? 'already-on-site' : 'moved', {
            index: sub.last_sent_email_index,
            next_week: next,
            due: sqlUtc(dueMs),
          });
          if (already) res.skipped++;
          else res.moved++;
        } catch (err) {
          res.failed++;
          await logEventSafe(env.DB, {
            registration_id: null,
            kind: 'course.emails.drip_takeover_error',
            source: 'cron',
            payload: { sequence: key, email, error: String(err) },
          });
        }
      }
      if (page >= totalPages) break;
    }
  }
  return out;
}
