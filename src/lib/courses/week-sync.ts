// Keeping the profile field honest — publishing the 12-week counter to Drip.
//
// The counter itself is derived (src/lib/courses/week-progress.ts), so the site
// always knows the right week. Drip does not: `prod_SVH_week` is a stored
// custom field, and Jacob's automations plus the certification page's variant
// gate read it. So as each person crosses into a new week, that field has to be
// written — once, on the change, not on every tick.
//
// `listWeekProgressNeedingSync` does the picking in SQL (bucket at now vs
// bucket at the last push), so a steady hour finds a handful of people and a
// quiet one finds none. Rows are pushed one at a time and each failure is
// isolated: an unreachable Drip leaves the marker untouched, so the next hour
// simply retries.
//
// Rides the hourly cron (src/worker-entrypoint.ts) and no-ops entirely until
// the Drip credentials are set.

import { upsertSubscriber } from '../registrations/drip';
import { logEvent } from '../registrations/db';
import {
  describeWeekProgress,
  getWeekProgress,
  recordWeekProgressSync,
  listWeekProgressNeedingSync,
  type CourseWeekProgressRow,
} from './week-progress';

// The Drip custom field that carries the counter. Historically written by
// Jacob's own automation at the end of a run; the site owns it now.
export const WEEK_FIELD = 'prod_SVH_week';

// Bounded per run — the sweep shares the hourly tick with the reconciles and
// the reports. Far above the real steady-state volume (a person changes week
// once every seven days).
const MAX_PER_RUN = 250;

export type WeekSyncEnv = {
  DB: D1Database;
  DRIP_API_TOKEN?: string;
  DRIP_ACCOUNT_ID?: string;
};

function dripCfgFor(env: WeekSyncEnv) {
  if (!env.DRIP_API_TOKEN || !env.DRIP_ACCOUNT_ID) return null;
  return { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID };
}

// Publish one person's current value. Returns the value written, or null when
// there was nothing to write (no counter, credentials unset, or already in
// sync). Best-effort by contract: throws are the caller's to swallow.
export async function pushWeekFieldToDrip(
  env: WeekSyncEnv,
  email: string,
  opts: { force?: boolean; row?: CourseWeekProgressRow | null } = {},
): Promise<string | null> {
  const cfg = dripCfgFor(env);
  if (!cfg) return null;
  const row = opts.row ?? (await getWeekProgress(env.DB, email));
  if (!row) return null;
  const status = describeWeekProgress(row);
  if (!opts.force && row.drip_value === status.fieldValue) return null;

  await upsertSubscriber(cfg, {
    email: row.email,
    custom_fields: { [WEEK_FIELD]: status.fieldValue },
  });
  await recordWeekProgressSync(env.DB, row.email, status.fieldValue);
  return status.fieldValue;
}

export type WeekSyncResult = { checked: number; pushed: number; failed: number };

export async function runCourseWeekSync(env: WeekSyncEnv): Promise<WeekSyncResult> {
  const result: WeekSyncResult = { checked: 0, pushed: 0, failed: 0 };
  if (!dripCfgFor(env)) return result;

  const rows = await listWeekProgressNeedingSync(env.DB, MAX_PER_RUN);
  result.checked = rows.length;

  for (const row of rows) {
    try {
      const written = await pushWeekFieldToDrip(env, row.email, { row });
      if (written) result.pushed += 1;
      // Nothing to write (the field already carries this value) — stamp the
      // marker anyway so the row settles instead of being re-picked hourly.
      else await recordWeekProgressSync(env.DB, row.email, describeWeekProgress(row).fieldValue);
    } catch (err) {
      result.failed += 1;
      // Leave the marker alone so the next tick retries this person.
      await logEvent(env.DB, {
        registration_id: null,
        kind: 'course.week.sync.error',
        source: 'system',
        payload: { email: row.email, error: String(err) },
      }).catch(() => {});
    }
  }

  return result;
}
