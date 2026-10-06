// What a live pass bought today would look like for one address: when each
// length would start and end, and whether the certification-window add-on would
// buy them anything. Shown on the pass page before they pay, re-derived by the
// checkout, and run once more when the payment lands (the period written onto
// the order is the one from the moment of payment).

import { brusselsToday, businessDayOf } from '../workshops/periods';
import { certWindowForEmail, extensionWouldHelp, type CertWindow } from './cert-window';
import {
  LIVE_PASS_MONTHS,
  listPaidLivePasses,
  livePassMonthsOf,
  livePassPeriod,
  recordLivePassPeriod,
  type LivePassMonths,
  type LivePassPeriod,
} from './live-pass';

export type LivePassPlan = {
  window: CertWindow;
  // The last day of the live sessions they already have (a pass, or the
  // certification course), when that is today or later.
  liveUntil: string | null;
  periods: Record<LivePassMonths, LivePassPeriod & { extensionHelps: boolean }>;
};

export async function planLivePass(
  db: D1Database,
  email: string,
  // onlyPassesBefore: count only passes on orders older than this one (the
  // order being settled, and anything bought after it, never push it later).
  opts: { today?: string; onlyPassesBefore?: number } = {},
): Promise<LivePassPlan> {
  const today = opts.today ?? brusselsToday();
  const [window, passes] = await Promise.all([
    certWindowForEmail(db, email, today),
    listPaidLivePasses(db, email),
  ]);
  const busy: string[] = [];
  for (const p of passes) {
    if (opts.onlyPassesBefore == null || p.id < opts.onlyPassesBefore) busy.push(p.endsOn);
  }
  if (window.courseEndsOn) busy.push(window.courseEndsOn);
  const latest = busy.filter((d) => d >= today).sort().pop() ?? null;

  const periods = {} as LivePassPlan['periods'];
  for (const months of LIVE_PASS_MONTHS) {
    const period = livePassPeriod({ today, months, busyUntil: busy });
    periods[months] = { ...period, extensionHelps: extensionWouldHelp(window, period.endsOn) };
  }
  return { window, liveUntil: latest, periods };
}

// When the payment lands: the period from the paid day, written onto the order
// ONCE (claimed in `events` as `live-pass-period-<id>`), so a webhook retry, a
// reconcile or an admin re-fire weeks later never moves a pass that has begun.
// Only passes on earlier orders count as already running. Returns the period
// the order holds; never throws.
export async function settleLivePassPeriod(
  db: D1Database,
  reg: { id: number; email: string; product_slug: string; paid_at: string | null; created_at: string },
): Promise<LivePassPeriod | null> {
  const months = livePassMonthsOf(reg.product_slug);
  if (!months) return null;
  const key = `live-pass-period-${reg.id}`;
  try {
    const claim = await db
      .prepare(
        `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id, payload_json)
         VALUES (NULL, 'course.live_pass.period', 'system', ?, ?)`,
      )
      .bind(key, JSON.stringify({ course_registration_id: reg.id }))
      .run();
    if ((claim.meta?.changes ?? 0) === 0) {
      const mine = (await listPaidLivePasses(db, reg.email)).find((p) => p.id === reg.id);
      return mine ? { startsOn: mine.startsOn, endsOn: mine.endsOn } : null;
    }
    const plan = await planLivePass(db, reg.email, {
      today: businessDayOf(reg.paid_at ?? reg.created_at),
      onlyPassesBefore: reg.id,
    });
    const period = plan.periods[months];
    if (!(await recordLivePassPeriod(db, reg.id, period))) {
      await db.prepare(`DELETE FROM events WHERE external_id = ?`).bind(key).run();
    } else {
      await db
        .prepare(`UPDATE events SET payload_json = ? WHERE external_id = ?`)
        .bind(JSON.stringify({ course_registration_id: reg.id, ...period }), key)
        .run();
    }
    return { startsOn: period.startsOn, endsOn: period.endsOn };
  } catch (err) {
    console.error('[live-pass] period not settled', String(err));
    return null;
  }
}
