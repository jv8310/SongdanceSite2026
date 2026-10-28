// What a live pass bought today would look like for one address: the day each
// length would start, how long an extension bought with it would keep the
// certification window open, whether that add-on would buy them anything, and
// whether they walk the 12-week course (the page then offers the 9-month
// certification course beside the pass). Shown on the pass page before they
// pay, re-derived by the checkout, and run once more when the payment lands
// (the dates written onto the order are the ones from the moment of payment).
// Which sessions a pass holds is the member app's to count (live-pass.ts).

import { brusselsToday, businessDayOf } from '../workshops/periods';
import { askApp } from '../admin/app-access';
import { findCountry } from '../countries';
import { addDays, FOUNDATION_WEEKS } from './cert-access';
import { certWindowForEmail, extensionWouldHelp, type CertWindow } from './cert-window';
import { monthlyPaidThroughDay } from './live-pass-monthly';
import type { CourseRegistration } from './db';
import {
  LIVE_PASS_MONTHLY_SLUG,
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
  // The last day of the month a monthly of theirs has paid for, when that is
  // today or later (running, or cancelled with its month still to run): a pass
  // starts the day after, so it never pays for days the monthly already has.
  monthlyUntil: string | null;
  // Whether that monthly still renews (not cancelled on our side).
  monthlyRenews: boolean;
  periods: Record<LivePassMonths, LivePassPeriod & { extensionHelps: boolean }>;
};

// ── The 12-week course ───────────────────────────────────────────────────────
//
// Its live weeks are the 12 weeks from the purchase (the member app's window:
// 84 days from the paid date), read from the same two places a sale can land as
// cert-access.ts reads (an order, or a 12w-course line on a workshop seat). The
// buyers from before the site took payments carry only the Drip tag, mirrored
// onto the contacts list: they hold the course, with no date to extend from.
export async function loadTwelveWeek(db: D1Database, email: string, today = brusselsToday()): Promise<LivePassPlan['twelveWeek']> {
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
  const [window, passes, twelveWeek, monthly] = await Promise.all([
    certWindowForEmail(db, email, today),
    listPaidLivePasses(db, email),
    loadTwelveWeek(db, email, today),
    loadMonthly(db, email, today),
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
  // A monthly's paid month holds the start back too, but it is not "your
  // course" — the page words it on its own (monthlyUntil).
  if (monthly.until) busy.push(monthly.until);

  const periods = {} as LivePassPlan['periods'];
  for (const months of LIVE_PASS_MONTHS) {
    const period = livePassPeriod({ today, months, busyUntil: busy, passesUntil });
    periods[months] = { ...period, extensionHelps: extensionWouldHelp(window, period.endsOn) };
  }
  return {
    window,
    twelveWeek,
    liveUntil: latest,
    passRunning: passesUntil.some((d) => d >= today),
    monthlyUntil: monthly.until,
    monthlyRenews: monthly.renews,
    periods,
  };
}

// ── When a monthly starts ───────────────────────────────────────────────────
//
// A monthly opens every session from its first charge, so it starts — and is
// first charged — when the live sessions this person already has run out (Jacob,
// October 2026: someone with Q&As until 31 December who takes a monthly in
// October pays from 1 January, not twice for November and December). What they
// already have is read from two places:
//   • the site's own dates (planLivePass): the certification course or the
//     12-week weeks bought here, and a cancelled monthly's paid month;
//   • the member app, which holds every access rule — an admin grant such as a
//     CEEE year of Q&As, extra time on a course, the Mighty imports — asked
//     through APP_ADMIN for the address (`member`), the same answer the People
//     page's App access section prints: each open course's `liveUntil` ("live
//     sessions until …"). A plain date is the last day it covers; an instant is
//     the moment it ends.
// When the app does not answer, the site's own dates decide. A start less than
// two days off is today: Stripe's trial needs 48 hours, and a day's overlap is
// not worth a charge on another day.
export type MonthlyStart = {
  startsOn: string | null; // the Brussels day of the first charge; null = today
  coveredUntil: string | null; // the last day of the live sessions they already have
  coveredBy: string | null; // what gives them those, for the page ("Extended Q&A plan")
};

export const MONTHLY_DEFER_MIN_DAYS = 2;
export const MONTHLY_DEFER_MAX_DAYS = 700;

const APP_ASK_MS = 4000;

export async function planMonthlyStart(
  env: { APP_ADMIN?: unknown },
  email: string,
  plan: Pick<LivePassPlan, 'liveUntil' | 'monthlyUntil' | 'monthlyRenews'>,
  today = brusselsToday(),
): Promise<MonthlyStart> {
  // Each candidate is the first day NOT covered, with what covers the days before it.
  const free: Array<{ day: string; by: string }> = [];
  if (plan.liveUntil) free.push({ day: addDays(plan.liveUntil, 1), by: 'your course' });
  if (plan.monthlyUntil && !plan.monthlyRenews) free.push({ day: addDays(plan.monthlyUntil, 1), by: 'your monthly' });

  const app = await Promise.race([
    askApp(env, (a) => a.member({ email: email.trim().toLowerCase() })),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), APP_ASK_MS)),
  ]);
  if (app?.ok) {
    for (const c of app.data.courses) {
      if (c.state === 'ended' || c.state === 'revoked' || !c.liveUntil) continue;
      const v = c.liveUntil.trim();
      const day = /^\d{4}-\d{2}-\d{2}$/.test(v) ? addDays(v, 1) : businessDayOf(v);
      if (day) free.push({ day, by: c.label });
    }
  }

  const latest = free.filter((f) => f.day > today).sort((x, y) => x.day.localeCompare(y.day)).pop() ?? null;
  if (!latest) return { startsOn: null, coveredUntil: null, coveredBy: null };
  const coveredUntil = addDays(latest.day, -1);
  const deferDays = daysFrom(today, latest.day);
  const startsOn = deferDays >= MONTHLY_DEFER_MIN_DAYS && deferDays <= MONTHLY_DEFER_MAX_DAYS ? latest.day : null;
  return { startsOn, coveredUntil, coveredBy: latest.by };
}

function daysFrom(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

// The monthly live pass (live-pass-monthly.ts): the last day its paid months
// cover (inclusive Brussels day — the day before paid_through's), when that is
// today or later.
async function loadMonthly(db: D1Database, email: string, today: string): Promise<{ until: string | null; renews: boolean }> {
  const rows = await db
    .prepare(
      `SELECT * FROM course_registrations
        WHERE product_slug = ? AND lower(email) = ? AND installments_paid > 0 AND status IN ('paid','cancelled')`,
    )
    .bind(LIVE_PASS_MONTHLY_SLUG, email.trim().toLowerCase())
    .all<CourseRegistration>()
    .catch(() => ({ results: [] as CourseRegistration[] }));
  let until: string | null = null;
  let renews = false;
  for (const r of rows.results ?? []) {
    const through = monthlyPaidThroughDay(r);
    if (!through) continue;
    const last = addDays(through, -1);
    if (last < today) continue;
    if (!until || last > until) until = last;
    if (r.status === 'paid' && !['canceled', 'incomplete_expired'].includes(r.subscription_status ?? '')) renews = true;
  }
  return { until, renews };
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
