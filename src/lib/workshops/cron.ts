// Scheduled work for the workshop engine, run from the 5-minute cron trigger
// (see wrangler.jsonc + worker-entrypoint.ts):
//
//   1. Reminder cadence before each live session (transactional).
//   2. Abandoned-checkout nudges for registrations stuck at 'prepared'.
//   3. Post-workshop sequences anchored one hour after the start:
//        attended      → thank-you + 12-week course, riding the existing
//                        48h / 20% participant-discount window
//        attended PRO  → certification path (masterclass attendees, and —
//                        once the pending is_pro column lands — anyone
//                        flagged pro at registration)
//        no-show       → replay + free rebooking, three touches
//        downsell      → after the discount window closes unbought
//
// Idempotency is the whole game: every send is guarded by an atomic
// claimNotification() on (registration_id, type). Sequences additionally
// carry a staleness guard so a backlog (deploy, cron outage) never sends a
// "closes in a few hours" email days late — too late is silently skipped.
//
// Marketing-flavoured sends (2 & 3) are suppressed for unsubscribed emails
// and carry the one-click List-Unsubscribe header; reminders and
// confirmations are service messages and always go out.

import {
  audienceIsPro,
  claimNotification,
  notificationExists,
  workshopIsMasterclass,
  type Workshop,
  type WorkshopRegistration,
} from './db';
import { sendEmail } from './resend';
import {
  abandonedEmail1,
  abandonedEmail2,
  attendedEmail1,
  attendedEmail2,
  attendedEmail3,
  attendedProEmail1,
  attendedProEmail2,
  attendedProEmail3,
  downsellEmail1,
  downsellEmail2,
  downsellEmail3,
  noShowEmail1,
  noShowEmail2,
  noShowEmail3,
  reminderEmail,
  MARKETING_FROM_DEFAULT,
  MARKETING_REPLY_TO_DEFAULT,
  type EmailContent,
  type WorkshopEmailCtx,
} from './emails';
import {
  eligibleDownsellOffers,
  bundleEligible,
  type Ownership,
} from './downsell-offers';
import { gatherBriefingData, buildBriefingEmail } from './briefing';
import { googleCalendarUrl } from './ics';
import { formatInTz, minutesUntil, withinSendWindow } from './time';
import { icsUrl, successUrl } from './paid-handler';
import {
  isEmailSuppressed,
  oneClickUnsubscribeUrl,
  unsubscribePageUrl,
  unsubscribeSecret,
} from '../email/unsubscribe';
import {
  anchorMsFromWorkshop,
  DISCOUNT_WINDOW_HOURS,
  postWorkshopEmailOffer,
} from '../courses/twelve-week';

type CronEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
  MARKETING_FROM?: string;
  MARKETING_REPLY_TO?: string;
  UNSUBSCRIBE_SECRET?: string;
  ADMIN_SESSION_SECRET?: string;
  PUBLIC_BASE_URL: string;
  // Internal pre-workshop briefing recipients (see runPreWorkshopBriefing).
  BRIEFING_TO?: string;
  REPORTS_TO?: string;
  ADMIN_EMAIL?: string;
};

const MIN_MS = 60_000;
const H = 60; // minutes
const D = 24 * H;

// Pre-workshop briefing (internal ops email): fire when a live session starts
// within the next BRIEFING_LEAD_MIN minutes — on the 5-minute cron this lands
// 0–5 min before the start, i.e. "about five minutes before". A missed tick
// (deploy/outage) can still catch a session up to BRIEFING_STALE_MIN after its
// start; beyond that a "starting soon" heads-up is pointless, so it's skipped.
const BRIEFING_LEAD_MIN = 5;
const BRIEFING_STALE_MIN = 10;
const BRIEFING_DEFAULT_RECIPIENT = 'jacob@songdance.co';

// Reminder cadence: lead time before start, in minutes. Ordered loosest →
// tightest. `at_time` (0) fires right at start.
const CADENCE: Array<{ type: string; lead: number }> = [
  { type: 'reminder_7d', lead: 7 * D },
  { type: 'reminder_2d', lead: 2 * D },
  { type: 'reminder_1d', lead: 1 * D },
  { type: 'reminder_6h', lead: 6 * H },
  { type: 'reminder_1h', lead: 1 * H },
  { type: 'reminder_15m', lead: 15 },
  { type: 'at_time', lead: 0 },
];

// The early, non-urgent reminders held to the recipient's local send window
// (08:00–21:00). The imminent ones (6h, 1h, 15m, at_time) are time-critical and
// always go on schedule — they're never gated.
const QUIET_HOURS_REMINDERS = new Set(['reminder_7d', 'reminder_2d', 'reminder_1d']);

// An early "X to go" reminder (7d/2d/1d) is suppressed when it would land within
// this much of the registration. Someone who books inside the 7-day window has
// already crossed those buckets, so without this guard the "starts in one week /
// tomorrow" reminder fires on the very next cron tick — seconds after the
// confirmation — and the two arrive together, which reads as a glitch. The
// confirmation already carries the date, join link and calendar; a calendar-
// style reminder is only worth sending with real daylight after it. Imminent
// reminders are exempt — a "starting now" nudge is never a confirmation dup.
const REMINDER_MIN_LEAD_MS = 2 * H * MIN_MS;

// Lifecycle sequence steps, anchored one hour after the start (minutes after).
// `staleMin`: how long past due a step may still be sent — beyond that it's
// skipped, never delivered embarrassingly late. `requires`: a step only
// fires if the named earlier claim exists, so a sequence can never start in
// the middle (e.g. on first deploy over historical workshops).
// `urgent`: deadline-driven, so it goes on its scheduled tick regardless of the
// recipient's local hour (quiet-hours holding could push it past its staleness
// and miss the window). Non-urgent steps wait for local daytime. The
// discount-deadline emails carry an accurate hours-remaining figure either way.
type LifecycleStep = { type: string; offsetMin: number; staleMin: number; requires?: string; urgent?: boolean };

// The 12-week participant discount closes 48h after the session
// (DISCOUNT_WINDOW_HOURS) — email 2 lands mid-window, email 3 shortly
// before it shuts and must never arrive after it has.
const ATTENDED_STEPS: LifecycleStep[] = [
  { type: 'post_attended', offsetMin: 0, staleMin: 48 * H },
  { type: 'post_attended_2', offsetMin: 24 * H, staleMin: 16 * H, requires: 'post_attended', urgent: true },
  { type: 'post_attended_3', offsetMin: 42 * H, staleMin: 5 * H, requires: 'post_attended_2', urgent: true },
];

const PRO_ATTENDED_STEPS: LifecycleStep[] = [
  { type: 'post_attended', offsetMin: 0, staleMin: 48 * H },
  { type: 'post_attended_pro_2', offsetMin: 2 * D, staleMin: 48 * H, requires: 'post_attended' },
  { type: 'post_attended_pro_3', offsetMin: 5 * D, staleMin: 48 * H, requires: 'post_attended_pro_2' },
];

const NO_SHOW_STEPS: LifecycleStep[] = [
  { type: 'post_no_show', offsetMin: 0, staleMin: 48 * H },
  { type: 'post_no_show_2', offsetMin: 2 * D, staleMin: 48 * H, requires: 'post_no_show' },
  { type: 'post_no_show_3', offsetMin: 6 * D, staleMin: 72 * H, requires: 'post_no_show_2' },
];

// Only for non-pro attendees who didn't buy (course or cert) after the window
// closed. Three touches now — promoting the gentler doors (journeys + grief),
// chosen per-recipient from what they don't already own.
const DOWNSELL_STEPS: LifecycleStep[] = [
  { type: 'downsell_1', offsetMin: 4 * D, staleMin: 48 * H, requires: 'post_attended' },
  { type: 'downsell_2', offsetMin: 8 * D, staleMin: 72 * H, requires: 'downsell_1' },
  { type: 'downsell_3', offsetMin: 12 * D, staleMin: 72 * H, requires: 'downsell_2' },
];

// How far back the post-workshop scan reaches. Must cover the latest step
// (+12d) plus its staleness (+72h → 15d).
const POST_SCAN_DAYS = 16;

// Abandoned-checkout timing (minutes after the registration was last touched).
// Each nudge has a closing edge too: past it, the moment (and the copy's
// "yesterday") has passed, so we stay quiet — this also keeps a backlog from
// blasting old carts when the feature first deploys or after an outage.
const ABANDONED_1_AFTER_MIN = 45;
const ABANDONED_2_AFTER_MIN = 20 * H;
const ABANDONED_2_MAX_AGE_MIN = 36 * H;

export type CronResult = {
  remindersSent: number;
  abandonedSent: number;
  postSent: number;
  noShowsMarked: number;
  briefingsSent: number;
};

export async function runWorkshopCron(env: CronEnv, now = Date.now()): Promise<CronResult> {
  const result: CronResult = {
    remindersSent: 0,
    abandonedSent: 0,
    postSent: 0,
    noShowsMarked: 0,
    briefingsSent: 0,
  };
  if (!env.RESEND_API_KEY) return result;

  await runReminders(env, now, result);
  await runAbandonedCheckouts(env, now, result);
  await runPostWorkshop(env, now, result);
  await runPreWorkshopBriefing(env, now, result);
  return result;
}

function emailCtx(env: CronEnv, reg: WorkshopRegistration, w: Workshop): WorkshopEmailCtx {
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const tz = reg.timezone || w.display_tz;
  const join = successUrl(base, reg.access_token);
  return {
    name: reg.name,
    workshopTitle: w.title,
    whenLocal: formatInTz(w.starts_at_utc, tz),
    joinUrl: join,
    googleCalUrl: googleCalendarUrl({
      title: w.title,
      startsAtUtc: w.starts_at_utc,
      endsAtUtc: w.ends_at_utc,
      url: join,
    }),
    icsUrl: icsUrl(base, reg.access_token),
  };
}

// SQLite's datetime('now') yields "YYYY-MM-DD HH:MM:SS" (UTC, no zone);
// ISO strings parse as-is.
function sqliteMs(s: string): number {
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  return Date.parse(iso);
}

// ── Reminders ──────────────────────────────────────────────────────────────
async function runReminders(env: CronEnv, now: number, result: CronResult) {
  // Live workshops starting within the next 7 days (plus a 30-minute grace
  // after start so `at_time` still fires). Replays have no live time.
  const horizon = new Date(now + 7 * D * MIN_MS + 60000).toISOString();
  const floor = new Date(now - 30 * MIN_MS).toISOString();
  const wRes = await env.DB
    .prepare(
      `SELECT * FROM workshops
        WHERE status = 'published' AND deleted = 0 AND is_replay = 0
          AND starts_at_utc >= ? AND starts_at_utc <= ?`,
    )
    .bind(floor, horizon)
    .all<Workshop>();

  for (const w of wRes.results ?? []) {
    const regs = await env.DB
      .prepare(
        `SELECT * FROM workshop_registrations
          WHERE workshop_id = ? AND payment_status IN ('paid','coupon')`,
      )
      .bind(w.id)
      .all<WorkshopRegistration>();

    for (const reg of regs.results ?? []) {
      const mins = minutesUntil(w.starts_at_utc, now);
      // Tightest cadence bucket already crossed (smallest lead with lead >= mins).
      let idx = -1;
      for (let i = 0; i < CADENCE.length; i++) {
        if (CADENCE[i].lead >= mins) idx = i; // keep advancing → ends on the tightest crossed
      }
      if (idx < 0) continue; // nothing due yet (more than 7d out)

      const due = CADENCE[idx];
      // An early "X to go" reminder only makes sense with real lead time after
      // the person registered. If they booked so close to (or past) this
      // bucket's natural send time that it would land right on top of the
      // confirmation — the "reminder arrived with my receipt" glitch —
      // reserve the slot silently (emailed=0) instead of firing it, and let a
      // tighter, genuinely-ahead bucket be their first reminder. Imminent nudges
      // (6h/1h/15m/at_time) are time-of-event and always go.
      if (QUIET_HOURS_REMINDERS.has(due.type)) {
        const dueAtMs = new Date(w.starts_at_utc).getTime() - due.lead * MIN_MS;
        const regMs = sqliteMs(reg.created_at);
        if (Number.isFinite(regMs) && regMs > dueAtMs - REMINDER_MIN_LEAD_MS) {
          await claimNotification(env.DB, reg.id, due.type, false);
          continue;
        }
      }
      // Non-urgent early reminders wait for the recipient's local send window;
      // skip this tick (without claiming) and the next ticks re-evaluate until
      // it's local daytime. Imminent reminders are never held.
      if (
        QUIET_HOURS_REMINDERS.has(due.type) &&
        !withinSendWindow(reg.timezone || w.display_tz, now)
      ) {
        continue;
      }
      // Claim every looser bucket too so we never backfill them with a late
      // burst — but only actually email the single tightest due reminder.
      // These looser claims are marked emailed=0: they reserve the slot
      // without being emails the person received, so the admin People view
      // doesn't count a late registrant's skipped reminders as sent.
      for (let i = 0; i < idx; i++) {
        await claimNotification(env.DB, reg.id, CADENCE[i].type, false);
      }
      const shouldSend = await claimNotification(env.DB, reg.id, due.type);
      if (!shouldSend) continue;

      const content = reminderEmail(due.type, emailCtx(env, reg, w));
      try {
        await sendEmail({
          apiKey: env.RESEND_API_KEY!,
          replyTo: env.RESEND_REPLY_TO,
          to: reg.email,
          subject: content.subject,
          html: content.html,
          text: content.text,
          entityRefId: `workshop-${due.type}-${reg.id}`,
          track: { db: env.DB, type: due.type, registrationId: reg.id },
        });
        result.remindersSent += 1;
      } catch {
        // Already claimed; a transient failure means this cadence is skipped
        // rather than retried. The next tighter bucket will still reach them.
      }
    }
  }
}

// ── Abandoned checkouts ─────────────────────────────────────────────────────
// Registrations that reached Stripe but never paid ('prepared', or an
// outright 'failed' attempt) on a workshop people can still join. Two nudges,
// anchored on updated_at (a fresh checkout attempt re-arms the clock).
type AbandonedRow = WorkshopRegistration & {
  w_slug: string;
  w_title: string;
  w_starts_at_utc: string;
  w_display_tz: string;
  w_is_replay: number;
};

async function runAbandonedCheckouts(env: CronEnv, now: number, result: CronResult) {
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const secret = unsubscribeSecret(env);

  const rows = await env.DB
    .prepare(
      `SELECT r.*, w.slug AS w_slug, w.title AS w_title, w.starts_at_utc AS w_starts_at_utc,
              w.display_tz AS w_display_tz, w.is_replay AS w_is_replay
         FROM workshop_registrations r
         JOIN workshops w ON w.id = r.workshop_id
        WHERE r.payment_status IN ('prepared','failed')
          AND w.status = 'published' AND w.deleted = 0
          AND (w.is_replay = 1 OR w.starts_at_utc > ?)
          AND r.updated_at >= datetime('now', '-${ABANDONED_2_MAX_AGE_MIN} minutes')`,
    )
    .bind(new Date(now).toISOString())
    .all<AbandonedRow>();

  for (const r of rows.results ?? []) {
    const ageMin = (now - sqliteMs(r.updated_at)) / MIN_MS;
    if (!Number.isFinite(ageMin) || ageMin < ABANDONED_1_AFTER_MIN) continue;

    let due: { type: string; build: 'first' | 'second' } | null = null;
    if (ageMin >= ABANDONED_2_AFTER_MIN && ageMin <= ABANDONED_2_MAX_AGE_MIN) {
      due = { type: 'abandoned_2', build: 'second' };
    } else if (ageMin < ABANDONED_2_AFTER_MIN) {
      due = { type: 'abandoned_1', build: 'first' };
    }
    if (!due) continue;

    // Marketing-flavoured, so honour the recipient's local send window: hold
    // the nudge until local daytime (re-evaluated on later ticks; the windows
    // above are wide enough to absorb an overnight wait).
    if (!withinSendWindow(r.timezone || r.w_display_tz, now)) continue;

    // Quiet checks before burning the claim: unsubscribed, or already a
    // customer (a secured seat on any workshop means no cart-nagging).
    if (await isEmailSuppressed(env.DB, r.email)) continue;
    const secured = await env.DB
      .prepare(
        `SELECT 1 AS one FROM workshop_registrations
          WHERE lower(email) = lower(?) AND payment_status IN ('paid','coupon') LIMIT 1`,
      )
      .bind(r.email)
      .first<{ one: number }>();
    if (secured) continue;

    if (!(await claimNotification(env.DB, r.id, due.type))) continue;

    const tz = r.timezone || r.w_display_tz;
    const ctx = {
      name: r.name,
      workshopTitle: r.w_title,
      whenLocal: r.w_is_replay === 1 ? null : formatInTz(r.w_starts_at_utc, tz),
      // Back to the workshop page's booking form (not the bare /w/ form), with
      // the date pre-selected and their saved details filled in. The token (not
      // PII) rides the URL; the page resolves it server-side. #register scrolls
      // straight to it.
      resumeUrl: `${base}/workshop?resume=${r.access_token}#register`,
      unsubscribeUrl: secret ? await unsubscribePageUrl(base, secret, r.email) : undefined,
    };
    const content = due.build === 'first' ? abandonedEmail1(ctx) : abandonedEmail2(ctx);
    const sent = await sendMarketing(env, r.email, content, `workshop-${due.type}-${r.id}`, secret, due.type, r.id);
    if (sent) result.abandonedSent += 1;
  }
}

// ── Post-workshop sequences ─────────────────────────────────────────────────
async function runPostWorkshop(env: CronEnv, now: number, result: CronResult) {
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const secret = unsubscribeSecret(env);
  // Workshops that have ended within the scan window. Compare on starts_at
  // for the index, then filter on end. Cancelled sessions still get their
  // no-show flip (data hygiene) but never marketing email.
  const since = new Date(now - POST_SCAN_DAYS * D * MIN_MS).toISOString();
  const wRes = await env.DB
    .prepare(
      `SELECT * FROM workshops
        WHERE deleted = 0 AND is_replay = 0 AND status IN ('published','cancelled')
          AND starts_at_utc >= ? AND starts_at_utc <= ?`,
    )
    .bind(since, new Date(now).toISOString())
    .all<Workshop>();

  // Cache cross-workshop lookups per run (the same email can sit on several
  // dates inside the scan window).
  const suppressedCache = new Map<string, boolean>();
  const bought12wCache = new Map<string, boolean>();
  const boughtCertCache = new Map<string, boolean>();
  // Ownership signals for downsell offer selection — what each email already
  // owns (Drip product tags + paid product slugs), so we never pitch a product
  // they have (including one bought as an order bump).
  const dripTagCache = new Map<string, Set<string>>();
  const paidSlugCache = new Map<string, Set<string>>();

  for (const w of wRes.results ?? []) {
    // Follow-up emails (and the no-show flip) are anchored exactly one hour
    // after the start — never on the actual end, and never on when anyone
    // joined — so the sequence fires on a predictable clock for every session.
    const followUpAnchorMs = new Date(w.starts_at_utc).getTime() + 60 * MIN_MS;
    if (followUpAnchorMs > now) continue; // not due yet

    // Anyone still 'registered' becomes 'no_show'.
    const flipped = await env.DB
      .prepare(
        `UPDATE workshop_registrations
            SET attendance_status = 'no_show', updated_at = datetime('now')
          WHERE workshop_id = ? AND payment_status IN ('paid','coupon')
            AND attendance_status = 'registered'`,
      )
      .bind(w.id)
      .run();
    result.noShowsMarked += flipped.meta?.changes ?? 0;

    if (w.status !== 'published') continue; // no marketing for cancelled sessions

    // The 12-week participant discount closes 48h after the session — same
    // anchor the course page uses (end, falling back to start). This is the
    // deadline the copy quotes; it is independent of when the emails fire.
    const discountAnchorMs = anchorMsFromWorkshop(w.starts_at_utc, w.ends_at_utc) ?? followUpAnchorMs;
    const discountEndsMs = discountAnchorMs + DISCOUNT_WINDOW_HOURS * H * MIN_MS;
    // Promo-aware offer for the after-workshop emails: while the launch promo is
    // live it beats the 20% participant discount and runs to a fixed date, so
    // the copy quotes the promo (percent + its plain deadline) and the whole
    // downstream deadline (countdown, hours-left, downsell gate) rides the promo
    // end instead of the 48h window. Reverts to 20%/48h when the promo ends.
    const offer = postWorkshopEmailOffer(discountEndsMs, now);
    const effectiveDiscountEndsMs = offer.deadlineMs;
    const isMasterclass = await workshopIsMasterclass(env.DB, w);

    const regs = await env.DB
      .prepare(
        `SELECT * FROM workshop_registrations
          WHERE workshop_id = ? AND payment_status IN ('paid','coupon')`,
      )
      .bind(w.id)
      .all<WorkshopRegistration>();

    for (const reg of regs.results ?? []) {
      const email = reg.email.toLowerCase();
      if (await cached(suppressedCache, email, () => isEmailSuppressed(env.DB, email))) continue;

      // PRO: a masterclass seat, the practitioner door (audience door 3) chosen
      // on a regular workshop, or — once the pending is_pro migration lands — a
      // registration flagged pro. Door 3 matches the same signal the 12-week
      // page uses (emailIsProFromLinks); reading is_pro optionally keeps this
      // forward-compatible without the column existing yet.
      const isPro =
        isMasterclass ||
        audienceIsPro(reg.audience) ||
        (reg as WorkshopRegistration & { is_pro?: number | null }).is_pro === 1;

      const tz = reg.timezone || w.display_tz;
      // Promo: a plain calendar label ('July 15'); otherwise the 48h window's
      // local time. Either way this is the deadline the copy actually quotes.
      const discountEndsLocal =
        offer.deadlineLabel ?? formatInTz(new Date(effectiveDiscountEndsMs).toISOString(), tz);
      // Hours left on the effective window at this exact send — so the copy is
      // true even when the email was held for the recipient's local morning.
      // Floored at 1 by the email builder (deadline emails always go before it
      // shuts). Unused in promo copy, which names the calendar date instead.
      const hoursRemaining = Math.max(1, Math.round((effectiveDiscountEndsMs - now) / (60 * 60 * 1000)));
      const unsubscribeUrl = secret ? await unsubscribePageUrl(base, secret, reg.email) : undefined;
      const lc = { name: reg.name, workshopTitle: w.title, unsubscribeUrl };
      // The course + certification pages read ?email= and reveal that person's
      // price (and any live discount) immediately — prefilling the register
      // form, no typing on arrival.
      const emailQ = encodeURIComponent(reg.email);
      const courseUrl = `${base}/courses/12-week?email=${emailQ}#register`;
      const certUrl = `${base}/courses/certification?email=${emailQ}`;
      const hubUrl = successUrl(base, reg.access_token);
      // The last-chance email's animated countdown ticks to the real deadline;
      // the endpoint computes the remaining time when the image is fetched.
      const countdownGifUrl = `${base}/api/countdown.gif?ends=${effectiveDiscountEndsMs}`;

      const dueSteps = (steps: LifecycleStep[]) =>
        steps.filter((s) => {
          const dueAt = followUpAnchorMs + s.offsetMin * MIN_MS;
          return now >= dueAt && now <= dueAt + s.staleMin * MIN_MS;
        });

      if (reg.attendance_status === 'attended') {
        const steps = dueSteps(isPro ? PRO_ATTENDED_STEPS : ATTENDED_STEPS);
        for (const step of steps) {
          if (step.requires && !(await notificationExists(env.DB, reg.id, step.requires))) continue;
          let content: EmailContent;
          if (isPro) {
            // Cert promos stop once they've bought the certification — the
            // thank-you still goes out, in its product-neutral variant.
            const boughtCert = await cached(boughtCertCache, email, () =>
              hasBoughtCert(env.DB, email),
            );
            if (boughtCert && step.type !== 'post_attended') continue;
            content = boughtCert
              ? attendedEmail1({ ...lc, courseUrl, discountEndsLocal, hoursRemaining, discountPercent: offer.percent, promo: offer.promo, alreadyBoughtCourse: true })
              : step.type === 'post_attended'
                ? attendedProEmail1({ ...lc, certUrl, courseUrl, hoursRemaining, discountEndsLocal, discountPercent: offer.percent, promo: offer.promo })
                : step.type === 'post_attended_pro_2'
                  ? attendedProEmail2({ ...lc, certUrl })
                  : attendedProEmail3({ ...lc, certUrl });
          } else {
            const bought = await cached(bought12wCache, email, () =>
              hasBought12w(env.DB, email),
            );
            if (bought && step.type !== 'post_attended') continue;
            content =
              step.type === 'post_attended'
                ? attendedEmail1({ ...lc, courseUrl, discountEndsLocal, hoursRemaining, discountPercent: offer.percent, promo: offer.promo, alreadyBoughtCourse: bought })
                : step.type === 'post_attended_2'
                  ? attendedEmail2({ ...lc, courseUrl, discountEndsLocal, hoursRemaining, discountPercent: offer.percent, promo: offer.promo })
                  : attendedEmail3({ ...lc, courseUrl, discountEndsLocal, hoursRemaining, countdownGifUrl, discountPercent: offer.percent, promo: offer.promo });
          }
          // Non-urgent steps wait for the recipient's local send window; the
          // deadline-driven ones (urgent) go on schedule with an accurate
          // hours-remaining figure.
          if (!step.urgent && !withinSendWindow(tz, now)) continue;
          if (!(await claimNotification(env.DB, reg.id, step.type))) continue;
          const sent = await sendMarketing(env, reg.email, content, `workshop-${step.type}-${reg.id}`, secret, step.type, reg.id);
          if (sent) result.postSent += 1;
        }

        // Downsell: non-pro attendees who let the window close without buying
        // the course OR the certification. Promotes the gentler doors (journeys
        // + grief), each chosen from what this person doesn't already own.
        if (!isPro) {
          for (const step of dueSteps(DOWNSELL_STEPS)) {
            if (now < effectiveDiscountEndsMs) continue; // never while the discount is open (promo end while the promo runs)
            if (step.requires && !(await notificationExists(env.DB, reg.id, step.requires))) continue;
            const bought = await cached(bought12wCache, email, () => hasBought12w(env.DB, email));
            if (bought) continue;
            const boughtCert = await cached(boughtCertCache, email, () => hasBoughtCert(env.DB, email));
            if (boughtCert) continue; // "didn't buy the course or cert course"

            const owned: Ownership = {
              tags: await cachedSet(dripTagCache, email, () => dripTagsForEmail(env.DB, email)),
              slugs: await cachedSet(paidSlugCache, email, () => paidProductSlugs(env.DB, email)),
            };
            const offers = eligibleDownsellOffers(owned);
            // Owns the lot → email 1 is a no-pitch wind-down; skip 2 & 3.
            if (offers.length === 0 && step.type !== 'downsell_1') continue;

            const dctx = {
              ...lc,
              base,
              courseUrl,
              calendarUrl: `${base}/workshop`,
              offers,
              bundleEligible: bundleEligible(owned),
            };
            const content =
              step.type === 'downsell_1'
                ? downsellEmail1(dctx)
                : step.type === 'downsell_2'
                  ? downsellEmail2(dctx)
                  : downsellEmail3(dctx);
            if (!withinSendWindow(tz, now)) continue; // local-daytime only
            if (!(await claimNotification(env.DB, reg.id, step.type))) continue;
            const sent = await sendMarketing(env, reg.email, content, `workshop-${step.type}-${reg.id}`, secret, step.type, reg.id);
            if (sent) result.postSent += 1;
          }
        }
      } else if (reg.attendance_status === 'no_show') {
        for (const step of dueSteps(NO_SHOW_STEPS)) {
          if (step.requires && !(await notificationExists(env.DB, reg.id, step.requires))) continue;
          const content =
            step.type === 'post_no_show'
              ? noShowEmail1({ ...lc, hubUrl })
              : step.type === 'post_no_show_2'
                ? noShowEmail2({ ...lc, hubUrl })
                : noShowEmail3({ ...lc, hubUrl });
          if (!withinSendWindow(tz, now)) continue; // local-daytime only
          if (!(await claimNotification(env.DB, reg.id, step.type))) continue;
          const sent = await sendMarketing(env, reg.email, content, `workshop-${step.type}-${reg.id}`, secret, step.type, reg.id);
          if (sent) result.postSent += 1;
        }
      }
    }
  }
}

// ── Pre-workshop briefing (internal, ~5 min before) ─────────────────────────
// An "SD-BRIEFING" ops email to Jacob just before each live session: how many
// registered, the audience mix across the three doors, and a few signals that
// shape the hour (practitioners present, order-bump uptake, countries). Once
// per workshop, claimed in the `events` audit log like the SD-REPORT digests.
async function runPreWorkshopBriefing(env: CronEnv, now: number, result: CronResult) {
  // Live (non-replay) published sessions whose start is within the next
  // BRIEFING_LEAD_MIN minutes, and no older than BRIEFING_STALE_MIN past start
  // (so a missed tick still catches up, but a long-finished session doesn't).
  const ceil = new Date(now + BRIEFING_LEAD_MIN * MIN_MS).toISOString();
  const floor = new Date(now - BRIEFING_STALE_MIN * MIN_MS).toISOString();
  const wRes = await env.DB
    .prepare(
      `SELECT * FROM workshops
        WHERE status = 'published' AND deleted = 0 AND is_replay = 0
          AND starts_at_utc <= ? AND starts_at_utc >= ?`,
    )
    .bind(ceil, floor)
    .all<Workshop>();

  const recipients = briefingRecipients(env);
  for (const w of wRes.results ?? []) {
    const externalId = `workshop-briefing-${w.id}`;
    // Claim first (atomic) so overlapping ticks can't double-send; release on
    // failure so a later tick retries while still inside the window.
    if (!(await claimBriefing(env.DB, externalId))) continue;
    try {
      const data = await gatherBriefingData(env.DB, w);
      const content = buildBriefingEmail(data, env.PUBLIC_BASE_URL);
      await sendEmail({
        apiKey: env.RESEND_API_KEY!,
        to: recipients,
        replyTo: env.RESEND_REPLY_TO,
        subject: content.subject,
        html: content.html,
        text: content.text,
        entityRefId: externalId,
      });
      result.briefingsSent += 1;
    } catch {
      await releaseBriefing(env.DB, externalId).catch(() => {});
    }
  }
}

// Internal recipients for the briefing. Defaults to Jacob; BRIEFING_TO (then the
// shared REPORTS_TO / ADMIN_EMAIL) can override. Comma/space/semicolon-separated.
function briefingRecipients(env: CronEnv): string[] {
  const raw = (env.BRIEFING_TO ?? env.REPORTS_TO ?? env.ADMIN_EMAIL ?? '').trim();
  const list = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : [BRIEFING_DEFAULT_RECIPIENT];
}

// Claim a briefing send in the `events` log (unique external_id). Returns true
// if THIS call inserted the row (so the caller should send).
async function claimBriefing(db: D1Database, externalId: string): Promise<boolean> {
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id)
       VALUES (NULL, 'workshop.briefing.sent', 'system', ?)`,
    )
    .bind(externalId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

async function releaseBriefing(db: D1Database, externalId: string): Promise<void> {
  await db
    .prepare(`DELETE FROM events WHERE external_id = ? AND kind = 'workshop.briefing.sent'`)
    .bind(externalId)
    .run();
}

// ── Purchase lookups (engine-wide, by email) ────────────────────────────────
// Course sales land in two places: the shared course pipeline
// (course_registrations, e.g. the 12-week checkout) and the workshop engine's
// own purchase lines. Check both.
async function hasBought12w(db: D1Database, email: string): Promise<boolean> {
  return hasCoursePurchase(db, email, ['svh-12week'], ['12w-course']);
}

async function hasBoughtCert(db: D1Database, email: string): Promise<boolean> {
  return hasCoursePurchase(db, email, ['cc-cert', 'cc-bundle'], ['cert-course']);
}

async function hasCoursePurchase(
  db: D1Database,
  email: string,
  courseSlugs: string[],
  workshopProductSlugs: string[],
): Promise<boolean> {
  const coursePh = courseSlugs.map(() => '?').join(',');
  const viaCourses = await db
    .prepare(
      `SELECT 1 AS one FROM course_registrations
        WHERE lower(email) = lower(?) AND status = 'paid' AND product_slug IN (${coursePh})
        LIMIT 1`,
    )
    .bind(email, ...courseSlugs)
    .first<{ one: number }>();
  if (viaCourses) return true;

  const prodPh = workshopProductSlugs.map(() => '?').join(',');
  const viaWorkshops = await db
    .prepare(
      `SELECT 1 AS one
         FROM workshop_purchases pur
         JOIN workshop_registrations wr ON wr.id = pur.registration_id
         JOIN workshop_products p ON p.id = pur.product_id
        WHERE lower(wr.email) = lower(?) AND pur.product_type = 'course'
          AND p.slug IN (${prodPh})
        LIMIT 1`,
    )
    .bind(email, ...workshopProductSlugs)
    .first<{ one: number }>();
  return !!viaWorkshops;
}

// All paid product slugs for an email — standalone course purchases
// (course_registrations) plus workshop line items that grant a product
// (workshop_purchases bump/course slugs, e.g. the workshop's `asj-bump` order
// bump). Feeds the downsell ownership check so a bought product is never pitched.
async function paidProductSlugs(db: D1Database, email: string): Promise<Set<string>> {
  const set = new Set<string>();
  const viaCourses = await db
    .prepare(
      `SELECT DISTINCT lower(product_slug) AS slug FROM course_registrations
        WHERE lower(email) = lower(?) AND status = 'paid' AND product_slug IS NOT NULL`,
    )
    .bind(email)
    .all<{ slug: string }>();
  for (const r of viaCourses.results ?? []) if (r.slug) set.add(r.slug);

  const viaWorkshops = await db
    .prepare(
      `SELECT DISTINCT lower(p.slug) AS slug
         FROM workshop_purchases pur
         JOIN workshop_registrations wr ON wr.id = pur.registration_id
         JOIN workshop_products p ON p.id = pur.product_id
        WHERE lower(wr.email) = lower(?) AND pur.product_type IN ('bump','course')`,
    )
    .bind(email)
    .all<{ slug: string }>();
  for (const r of viaWorkshops.results ?? []) if (r.slug) set.add(r.slug);
  return set;
}

// The Drip product tags we hold locally for an email — the imported marketing
// list (contact_tags). Lowercased. Catches ownership recorded in Drip (incl.
// products granted as bumps) for anyone on the list.
async function dripTagsForEmail(db: D1Database, email: string): Promise<Set<string>> {
  const rows = await db
    .prepare(`SELECT lower(tag) AS tag FROM contact_tags WHERE lower(email) = lower(?)`)
    .bind(email)
    .all<{ tag: string }>();
  const set = new Set<string>();
  for (const r of rows.results ?? []) if (r.tag) set.add(r.tag);
  return set;
}

async function cached(
  cache: Map<string, boolean>,
  key: string,
  load: () => Promise<boolean>,
): Promise<boolean> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = await load();
  cache.set(key, v);
  return v;
}

async function cachedSet(
  cache: Map<string, Set<string>>,
  key: string,
  load: () => Promise<Set<string>>,
): Promise<Set<string>> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = await load();
  cache.set(key, v);
  return v;
}

// Marketing send: from Jacob, replies to support, with the one-click
// unsubscribe header. Returns whether the send went through (the claim is
// already burned either way — a transient failure skips rather than
// retries, like reminders).
async function sendMarketing(
  env: CronEnv,
  to: string,
  content: EmailContent,
  refId: string,
  secret: string | null,
  trackType: string,
  registrationId: number,
): Promise<boolean> {
  try {
    await sendEmail({
      apiKey: env.RESEND_API_KEY!,
      from: env.MARKETING_FROM || MARKETING_FROM_DEFAULT,
      replyTo: env.MARKETING_REPLY_TO || MARKETING_REPLY_TO_DEFAULT,
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
      entityRefId: refId,
      listUnsubscribeUrl: secret
        ? await oneClickUnsubscribeUrl(env.PUBLIC_BASE_URL, secret, to)
        : undefined,
      track: { db: env.DB, type: trackType, registrationId },
    });
    return true;
  } catch {
    return false;
  }
}
