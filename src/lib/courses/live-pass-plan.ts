// What a live pass bought today would look like for one address: the day each
// length would start, how long an extension bought with it would keep the
// certification window open, whether that add-on would buy them anything, and
// whether they walk the 12-week course (the page then offers the 9-month
// certification course beside the pass). Shown on the pass page before they
// pay, re-derived by the checkout, and run once more when the payment lands
// (the dates written onto the order are the ones from the moment of payment).
// Which sessions a pass holds is the member app's to count (live-pass.ts).

import { brusselsToday, businessDayOf } from '../workshops/periods';
import { findCountry } from '../countries';
import { addDays, FOUNDATION_WEEKS } from './cert-access';
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
  // The 12-week course: whether they hold it, and the last day of its live
  // weeks when a site order says when that is.
  twelveWeek: { holds: boolean; liveUntil: string | null };
  // The last day of the live sessions their course still gives them (the
  // certification course or the 12-week course), when that is today or later:
  // a pass starts the day after.
  liveUntil: string | null;
  // Whether a pass of theirs is still running (its months reach today or
  // later): a new one then continues with the session after its last.
  passRunning: boolean;
  periods: Record<LivePassMonths, LivePassPeriod & { extensionHelps: boolean }>;
};

// ── The 12-week course ───────────────────────────────────────────────────────
//
// Its live weeks are the 12 weeks from the purchase (the member app's window:
// 84 days from the paid date), read from the same two places a sale can land as
// cert-access.ts reads (an order, or a 12w-course line on a workshop seat). The
// buyers from before the site took payments carry only the Drip tag, mirrored
// onto the contacts list: they hold the course, with no date to extend from.
async function loadTwelveWeek(db: D1Database, email: string, today: string): Promise<LivePassPlan['twelveWeek']> {
  const key = email.trim().toLowerCase();
  const days: string[] = [];
  const course = await db
    .prepare(
      `SELECT COALESCE(paid_at, created_at) AS at FROM course_registrations
        WHERE status = 'paid' AND product_slug = 'svh-12week' AND lower(email) = ?`,
    )
    .bind(key)
    .all<{ at: string }>();
  for (const r of course.results ?? []) days.push(businessDayOf(r.at));
  const ledger = await db
    .prepare(
      `SELECT pur.created_at AS at
         FROM workshop_purchases pur
         JOIN workshop_registrations wr ON wr.id = pur.registration_id
         JOIN workshop_products p ON p.id = pur.product_id
        WHERE pur.product_type = 'course' AND p.slug = '12w-course'
          AND wr.payment_status IN ('paid','coupon') AND lower(wr.email) = ?`,
    )
    .bind(key)
    .all<{ at: string }>()
    .catch(() => ({ results: [] as Array<{ at: string }> }));
  for (const r of ledger.results ?? []) days.push(businessDayOf(r.at));

  let holds = days.length > 0;
  if (!holds) {
    const tag = await db
      .prepare(`SELECT 1 AS x FROM contact_tags WHERE email = ? AND lower(tag) = 'prod_svh_12w' LIMIT 1`)
      .bind(key)
      .first<{ x: number }>()
      .catch(() => null);
    holds = !!tag;
  }
  const ends = days.map((d) => addDays(d, FOUNDATION_WEEKS * 7)).filter((d) => d >= today).sort();
  return { holds, liveUntil: ends.pop() ?? null };
}

// ── Who they are, for the form ───────────────────────────────────────────────
//
// The name and country the site already holds for this address — their latest
// order, else their latest workshop seat, else the contacts list — so the page
// fills the form in, the way the 12-week and certification pages fill theirs
// from Drip. Email is the credential here, as there.
export type BuyerDetails = { firstName: string | null; lastName: string | null; country: string | null };

function splitName(name: string | null | undefined): { firstName: string | null; lastName: string | null } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: null, lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || null };
}

const isoCountry = (c: string | null | undefined): string | null => {
  const code = (c ?? '').trim().toUpperCase();
  return code && findCountry(code) ? code : null;
};

export async function loadBuyerDetails(db: D1Database, email: string): Promise<BuyerDetails> {
  const key = email.trim().toLowerCase();
  const order = await db
    .prepare(
      `SELECT first_name, last_name, country FROM course_registrations
        WHERE lower(email) = ? AND (first_name IS NOT NULL OR last_name IS NOT NULL)
        ORDER BY id DESC LIMIT 1`,
    )
    .bind(key)
    .first<{ first_name: string | null; last_name: string | null; country: string | null }>()
    .catch(() => null);
  if (order) return { firstName: order.first_name, lastName: order.last_name, country: isoCountry(order.country) };
  const seat = await db
    .prepare(
      `SELECT name, country FROM workshop_registrations
        WHERE lower(email) = ? AND name IS NOT NULL ORDER BY id DESC LIMIT 1`,
    )
    .bind(key)
    .first<{ name: string | null; country: string | null }>()
    .catch(() => null);
  if (seat) return { ...splitName(seat.name), country: isoCountry(seat.country) };
  const contact = await db
    .prepare(`SELECT name, country FROM contacts WHERE email = ? LIMIT 1`)
    .bind(key)
    .first<{ name: string | null; country: string | null }>()
    .catch(() => null);
  if (contact) return { ...splitName(contact.name), country: isoCountry(contact.country) };
  return { firstName: null, lastName: null, country: null };
}

export async function planLivePass(
  db: D1Database,
  email: string,
  // onlyPassesBefore: count only passes on orders older than this one (the
  // order being settled, and anything bought after it, never push it later).
  opts: { today?: string; onlyPassesBefore?: number } = {},
): Promise<LivePassPlan> {
  const today = opts.today ?? brusselsToday();
  const [window, passes, twelveWeek] = await Promise.all([
    certWindowForEmail(db, email, today),
    listPaidLivePasses(db, email),
    loadTwelveWeek(db, email, today),
  ]);
  // Earlier passes never move the start (the member app queues the sessions);
  // they only push back where this pass's months — an extension's — begin.
  const passesUntil: string[] = [];
  for (const p of passes) {
    if (opts.onlyPassesBefore == null || p.id < opts.onlyPassesBefore) passesUntil.push(p.endsOn);
  }
  const busy: string[] = [];
  if (window.courseEndsOn) busy.push(window.courseEndsOn);
  // A 12-week student extends their Q&As: the pass picks up where the 12 weeks end.
  if (twelveWeek.liveUntil) busy.push(twelveWeek.liveUntil);
  const latest = busy.filter((d) => d >= today).sort().pop() ?? null;

  const periods = {} as LivePassPlan['periods'];
  for (const months of LIVE_PASS_MONTHS) {
    const period = livePassPeriod({ today, months, busyUntil: busy, passesUntil });
    periods[months] = { ...period, extensionHelps: extensionWouldHelp(window, period.endsOn) };
  }
  return { window, twelveWeek, liveUntil: latest, passRunning: passesUntil.some((d) => d >= today), periods };
}

// When the payment lands: the dates from the paid day, written onto the order
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
