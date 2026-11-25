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
import { addDays, addMonths, FOUNDATION_WEEKS } from './cert-access';
import { certWindowForEmail, extensionWouldHelp, type CertWindow } from './cert-window';
import { findRunningMonthly, monthlyPaidThroughDay } from './live-pass-monthly';
import type { CourseRegistration } from './db';
import {
  LIVE_PASS_MONTHLY_SLUG,
  LIVE_PASS_MONTHS,
  listPaidLivePasses,
  livePassContents,
  livePassLabel,
  livePassMonthsOf,
  livePassPeriod,
  recordLivePassPeriod,
  type LivePassMonths,
  type LivePassPeriod,
  type PaidLivePass,
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
  // Every paid pass under this address, oldest first (the months of each
  // already stacked behind the one before it: live-pass.ts, livePassPeriod).
  passes: PaidLivePass[];
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
    passes,
    periods,
  };
}

// Why the "Extend my certification window" add-on is refused for this length,
// in the words the buyer reads — or null when it would buy them something. One
// rule for both doors that can add it: the checkout and a free pass given from
// the admin or the member app (live-pass-grant.ts).
export function extensionRefusal(plan: LivePassPlan, months: LivePassMonths): string | null {
  const period = plan.periods[months];
  if (period.extensionHelps) return null;
  if (!plan.window.holdsCourse) {
    return 'The certification extension is for students of the certification course, and we find no certification course under this email address. If you bought it with another address, please use that one.';
  }
  const day = plan.window.endsOn ?? period.endsOn;
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `Your certification window already runs until ${label}, past what the extension would add, so it would buy you nothing. Untick it to continue.`;
}

// The same question for the monthly, whose extension runs month by month: it
// is worth taking when its first month already reaches past the window they
// have (or they hold the course without the right to certify). `startsOn` is
// the day of the first charge (null = today). Null when it may be sold.
export function monthlyExtensionUntil(startsOn: string | null, today = brusselsToday()): string {
  return addDays(addMonths(startsOn ?? today, 1), -1);
}

export function monthlyExtensionRefusal(window: CertWindow, startsOn: string | null, today = brusselsToday()): string | null {
  if (extensionWouldHelp(window, monthlyExtensionUntil(startsOn, today))) return null;
  if (!window.holdsCourse) {
    return 'The certification extension is for students of the certification course, and we find no certification course under this email address. If you bought it with another address, please use that one.';
  }
  const day = window.endsOn ?? today;
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `Your certification window already runs until ${label}, past the first month of the monthly, so the extension would add nothing yet. Untick it to continue.`;
}

// ── The live sessions they already have ─────────────────────────────────────
//
// "Your live access is until DATE" (Jacob, November 2026): one answer for
// everything that gives this person the Q&As and the deepening sessions, and
// the passes they hold, cumulated — two passes are the sessions of both, one
// after the other, so the access runs to the end of the last.
//
// Read from two places:
//   • the site's own dates (planLivePass): the certification course or the
//     12-week weeks bought here, a monthly's paid month, and every paid pass;
//   • the member app, which holds every access rule and the calendar — asked
//     through APP_ADMIN (`member`), the same answer the People page's App
//     access section prints. A course's `liveUntil` is the end of its live
//     sessions (a plain date is the last day it covers; an instant the moment
//     it ends). A pass's `liveUntil` is the end of its LAST session, known only
//     once every one of its sessions is on the calendar.
//
// A pass ends with its last session, and the calendar is usually scheduled a
// few weeks ahead only. So while any pass of theirs still waits for sessions
// to be scheduled, the day is an estimate (`approx`): the end of the passes'
// months, stacked one behind the other (a pass is sold by the month: about 4
// Q&As and 1 deepening session each). Once the app has all their sessions on
// its calendar, the day is the day of the last one. When the app does not
// answer, the site's own dates decide.
export type HeldPass = {
  id: number; // the order (C-<id>)
  months: LivePassMonths;
  label: string; // "Live pass · 3 months"
  contents: string; // "12 Q&As and 3 deepening sessions"
  paidOn: string;
  // What is still to come, when the app says so (null: an app deployed before it, or silent).
  toCome: { qa: number; deepening: number } | null;
};

export type LiveCover = { until: string; by: string; kind: 'course' | 'pass' | 'monthly'; approx: boolean };

export type LiveAccess = {
  // The last day of the live sessions they have (inclusive Brussels day),
  // today or later; null when nothing gives them any.
  until: string | null;
  approx: boolean; // an estimate: a pass's last sessions are not on the calendar yet
  by: string | null; // what gives them that day, for the page ("your course")
  // A monthly that still renews: the sessions stay open past `until` by themselves.
  monthlyRenews: boolean;
  passes: HeldPass[]; // the passes still running or waiting their turn, oldest first
  covers: LiveCover[]; // everything counted, for planMonthlyStart
};

const APP_ASK_MS = 4000;
const PLAIN_DAY = /^\d{4}-\d{2}-\d{2}$/;

function passOrderId(ref: string | null | undefined): number | null {
  const m = /^course_registrations:(\d+)$/.exec(ref ?? '');
  return m ? Number(m[1]) : null;
}

export async function loadLiveAccess(
  env: { APP_ADMIN?: unknown },
  email: string,
  plan: Pick<LivePassPlan, 'liveUntil' | 'monthlyUntil' | 'monthlyRenews' | 'passes'>,
  today = brusselsToday(),
): Promise<LiveAccess> {
  const covers: LiveCover[] = [];
  if (plan.liveUntil) covers.push({ until: plan.liveUntil, by: 'your course', kind: 'course', approx: false });
  if (plan.monthlyUntil) covers.push({ until: plan.monthlyUntil, by: 'your monthly', kind: 'monthly', approx: false });

  const app = await Promise.race([
    askApp(env, (a) => a.member({ email: email.trim().toLowerCase() })),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), APP_ASK_MS)),
  ]);

  const describe = (p: PaidLivePass, toCome: HeldPass['toCome']): HeldPass => ({
    id: p.id,
    months: p.months,
    label: livePassLabel(p.months),
    contents: livePassContents(p.months),
    paidOn: p.paidOn,
    toCome,
  });
  // The end of the passes' months, stacked: what the site can say by itself.
  const monthsEnd = plan.passes.map((p) => p.endsOn).sort().pop() ?? null;
  let passes: HeldPass[];

  if (app?.ok) {
    for (const c of app.data.courses) {
      if (c.product === 'live-pass' || c.state === 'ended' || c.state === 'revoked' || !c.liveUntil) continue;
      const v = c.liveUntil.trim();
      // A plain date is the last day covered; an instant is the moment it ends
      // (the end of a day on the member's own clock, so the day an admin set
      // is read from where it is written as a day).
      const set = (c.liveSetByAdmin ?? '').trim();
      const until = PLAIN_DAY.test(set) ? set : PLAIN_DAY.test(v) ? v : addDays(businessDayOf(v), -1);
      covers.push({ until, by: c.label, kind: 'course', approx: false });
    }
    const open = app.data.courses.filter((c) => c.product === 'live-pass' && (c.state === 'active' || c.state === 'starts-later'));
    if (open.length) {
      const exact = open.every((c) => !!c.liveUntil);
      const lastSession = open
        .map((c) => (c.liveUntil ? businessDayOf(c.liveUntil) : null))
        .filter((d): d is string => !!d)
        .sort()
        .pop();
      // Never earlier than a session the app already holds for them, nor than today.
      const until = exact ? lastSession! : [monthsEnd, lastSession, today].filter((d): d is string => !!d).sort().pop()!;
      covers.push({ until, by: open.length > 1 ? 'your live passes' : 'your live pass', kind: 'pass', approx: !exact });
    }
    // Which of the site's orders those are: by the order the app names, else
    // (an app deployed before it did) the newest ones — passes queue oldest first.
    const named = new Map<number, HeldPass['toCome']>();
    for (const c of open) {
      const id = passOrderId(c.sourceRef);
      if (id != null) named.set(id, c.pass ? { qa: c.pass.qaToCome, deepening: c.pass.deepeningToCome } : null);
    }
    passes = named.size
      ? plan.passes.filter((p) => named.has(p.id)).map((p) => describe(p, named.get(p.id) ?? null))
      : plan.passes.slice(Math.max(0, plan.passes.length - open.length)).map((p) => describe(p, null));
  } else {
    const running = plan.passes.filter((p) => p.endsOn >= today);
    if (running.length && monthsEnd) {
      covers.push({ until: monthsEnd, by: running.length > 1 ? 'your live passes' : 'your live pass', kind: 'pass', approx: true });
    }
    passes = running.map((p) => describe(p, null));
  }

  const latest = covers.filter((c) => c.until >= today).sort((x, y) => x.until.localeCompare(y.until)).pop() ?? null;
  return {
    until: latest?.until ?? null,
    approx: latest?.approx ?? false,
    by: latest?.by ?? null,
    monthlyRenews: !!plan.monthlyUntil && plan.monthlyRenews,
    passes,
    covers,
  };
}

// ── When a monthly starts ───────────────────────────────────────────────────
//
// A monthly opens every session from its first charge, so it starts — and is
// first charged — when the live sessions this person already has run out (Jacob,
// October 2026: someone with Q&As until 31 December who takes a monthly in
// October pays from 1 January, not twice for November and December). What they
// already have is loadLiveAccess above: their course, an admin grant, a
// cancelled monthly's paid month, and their passes, cumulated (two passes hold
// it back to the end of the second — until November 2026 a pass whose sessions
// were not on the calendar yet was left out, and the monthly started after the
// first pass alone). A start less than two days off is today: Stripe's trial
// needs 48 hours, and a day's overlap is not worth a charge on another day.
export type MonthlyStart = {
  startsOn: string | null; // the Brussels day of the first charge; null = today
  coveredUntil: string | null; // the last day of the live sessions they already have
  coveredBy: string | null; // what gives them those, for the page ("Extended Q&A plan")
};

export const MONTHLY_DEFER_MIN_DAYS = 2;
export const MONTHLY_DEFER_MAX_DAYS = 700;

export async function planMonthlyStart(
  env: { APP_ADMIN?: unknown },
  email: string,
  plan: Pick<LivePassPlan, 'liveUntil' | 'monthlyUntil' | 'monthlyRenews' | 'passes'>,
  today = brusselsToday(),
  access?: LiveAccess,
): Promise<MonthlyStart> {
  const have = access ?? (await loadLiveAccess(env, email, plan, today));
  // A monthly that still renews is not something a new one waits for (the
  // checkout refuses a second one anyway).
  const latest =
    have.covers
      .filter((c) => !(c.kind === 'monthly' && plan.monthlyRenews) && c.until >= today)
      .sort((x, y) => x.until.localeCompare(y.until))
      .pop() ?? null;
  if (!latest) return { startsOn: null, coveredUntil: null, coveredBy: null };
  const firstFree = addDays(latest.until, 1);
  const deferDays = daysFrom(today, firstFree);
  const startsOn = deferDays >= MONTHLY_DEFER_MIN_DAYS && deferDays <= MONTHLY_DEFER_MAX_DAYS ? firstFree : null;
  return { startsOn, coveredUntil: latest.until, coveredBy: latest.by };
}

// ── The answer the live-pass page shows for one address ─────────────────────
//
// One object for the page (rendered on the server when the address came in the
// link) and for /api/courses/live-pass-status (asked from the browser when it is
// typed): the same words either way. `access` is the personal panel — "Your
// live access is until …" and the passes they hold; `access_after` is, per pass
// length, the day their live access would run to with that pass added behind
// what they have (an estimate: a pass ends with its last session).
export type LivePassStatus = {
  email: string;
  live_until: string | null;
  pass_running: boolean;
  monthly_running: boolean;
  monthly_until: string | null;
  monthly_starts_on: string | null;
  monthly_covered_until: string | null;
  monthly_covered_by: string | null;
  periods: LivePassPlan['periods'];
  access: {
    until: string | null;
    approx: boolean;
    headline: string;
    note: string | null;
    items: Array<{ icon: string; title: string; detail: string }>;
  };
  access_after: Record<string, string>;
  // The certification-window extension on a monthly taken today: whether it
  // would add anything, and the last day its first month would keep the window open.
  monthly_extension: { helps: boolean; until: string };
  certification: { holds_course: boolean; may_certify: boolean; ends_on: string | null; open: boolean };
  twelve_week: { holds: boolean; live_until: string | null };
};

const sayDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const countOf = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// What a pass still holds: "3 Q&As and 1 deepening session to come".
function toComeWords(t: { qa: number; deepening: number }): string {
  const parts: string[] = [];
  if (t.qa > 0) parts.push(countOf(t.qa, 'Q&A', 'Q&As'));
  if (t.deepening > 0) parts.push(countOf(t.deepening, 'deepening session', 'deepening sessions'));
  return parts.length ? `${parts.join(' and ')} to come` : 'its last session has been held';
}

export function describeLiveAccess(
  access: LiveAccess,
  plan: Pick<LivePassPlan, 'liveUntil' | 'monthlyUntil'>,
  monthlyRunning: boolean,
  today = brusselsToday(),
): LivePassStatus['access'] {
  const items: LivePassStatus['access']['items'] = [];
  // Their course, while it still gives them live sessions: one line, the one
  // that runs longest (the app's name for it when it answered).
  const course = access.covers
    .filter((c) => c.kind === 'course' && c.until >= today)
    .sort((x, y) => x.until.localeCompare(y.until) || (x.by === 'your course' ? -1 : 1))
    .pop();
  if (course) {
    const by = course.by.startsWith('your ') ? `Y${course.by.slice(1)}` : course.by;
    items.push({ icon: 'ph-graduation-cap', title: by, detail: `Live sessions until ${sayDay(course.until)}` });
  }
  for (const p of access.passes) {
    items.push({
      icon: 'ph-ticket',
      title: p.label,
      detail: p.toCome ? toComeWords(p.toCome) : p.contents,
    });
  }
  if (plan.monthlyUntil) {
    items.push({
      icon: 'ph-repeat',
      title: 'Live pass · monthly',
      detail: access.monthlyRenews ? `Paid until ${sayDay(plan.monthlyUntil)}, renews that day` : `Cancelled, open until ${sayDay(plan.monthlyUntil)}`,
    });
  }

  let headline: string;
  let note: string | null = null;
  if (access.monthlyRenews && plan.monthlyUntil) {
    headline = 'Your monthly keeps your live sessions open.';
    note = `It is paid until ${sayDay(plan.monthlyUntil)} and renews that day, for as long as you keep it.`;
  } else if (access.until) {
    headline = `Your live access is until ${access.approx ? 'around ' : ''}${sayDay(access.until)}.`;
    if (access.passes.length > 1) {
      note = `You hold ${access.passes.length} live passes. They follow one another, so your live access runs to the end of the last.`;
    }
    if (access.approx) {
      note = `${note ? `${note} ` : ''}A pass ends with its last session, so the exact day follows the calendar.`;
    }
  } else if (monthlyRunning) {
    headline = 'Your monthly is agreed and has not started yet.';
  } else {
    headline = 'You have no live sessions at the moment.';
    note = 'A pass or the monthly opens them again from today.';
  }
  return { until: access.until, approx: access.approx, headline, note, items };
}

export async function loadLivePassStatus(
  env: { APP_ADMIN?: unknown },
  db: D1Database,
  email: string,
  today = brusselsToday(),
): Promise<{ status: LivePassStatus; details: BuyerDetails }> {
  const [plan, details, monthly] = await Promise.all([
    planLivePass(db, email, { today }),
    loadBuyerDetails(db, email),
    findRunningMonthly(db, email),
  ]);
  const access = await loadLiveAccess(env, email, plan, today);
  // When a monthly taken today would be first charged: the day the live
  // sessions they already have end (here or in the member app), else today.
  const start = await planMonthlyStart(env, email, plan, today, access);

  // With this pass added: its months, counted from the day after what they
  // have (or from the day it starts, when that is later).
  const accessAfter: Record<string, string> = {};
  for (const months of LIVE_PASS_MONTHS) {
    const startsOn = plan.periods[months].startsOn;
    const from = access.until && addDays(access.until, 1) > startsOn ? addDays(access.until, 1) : startsOn;
    accessAfter[String(months)] = addDays(addMonths(from, months), -1);
  }

  return {
    details,
    status: {
      email,
      live_until: plan.liveUntil,
      pass_running: access.passes.length > 0,
      // A monthly already running: the page offers "Manage my monthly pass" instead
      // of a second one (a yes/no only — the manage link goes by email).
      monthly_running: !!monthly,
      monthly_until: plan.monthlyUntil,
      monthly_starts_on: start.startsOn,
      monthly_covered_until: start.coveredUntil,
      monthly_covered_by: start.coveredBy,
      periods: plan.periods,
      access: describeLiveAccess(access, plan, !!monthly, today),
      access_after: accessAfter,
      monthly_extension: {
        helps: monthlyExtensionRefusal(plan.window, start.startsOn, today) === null,
        until: monthlyExtensionUntil(start.startsOn, today),
      },
      certification: {
        holds_course: plan.window.holdsCourse,
        may_certify: plan.window.mayCertify,
        ends_on: plan.window.endsOn,
        open: plan.window.open,
      },
      twelve_week: { holds: plan.twelveWeek.holds, live_until: plan.twelveWeek.liveUntil },
    },
  };
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
