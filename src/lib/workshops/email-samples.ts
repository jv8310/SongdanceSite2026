// Sample renders of every lifecycle + transactional workshop email, with
// fixed example data. Drives the /admin/emails preview page and the
// "send me a test" endpoint, so the words can be reviewed exactly as a
// recipient would see them. Timing/audience strings here are documentation —
// the real cadence lives in cron.ts.

import {
  abandonedEmail1,
  abandonedEmail2,
  attendedEmail1,
  attendedEmail2,
  attendedEmail3,
  attendedProEmail1,
  attendedProEmail2,
  attendedProEmail3,
  confirmationEmail,
  downsellEmail1,
  downsellEmail2,
  downsellEmail3,
  noShowEmail1,
  noShowEmail2,
  noShowEmail3,
  reminderEmail,
  verificationEmail,
  type EmailContent,
} from './emails';
import { DOWNSELL_OFFERS, DOWNSELL_ORDER } from './downsell-offers';
import { LAUNCH_PROMO_PERCENT, LAUNCH_PROMO_END_LABEL } from '../promo';
import { buildOrderNotificationEmail } from '../orders/notification';
import {
  buildDailyReportEmail,
  buildWeeklyReportEmail,
  sampleDailyReportData,
  sampleWeeklyReportData,
} from './reports';
import { buildBriefingEmail, sampleBriefingData } from './briefing';

export type EmailSample = {
  id: string;
  group: string;
  label: string;
  timing: string;
  audience: string;
  content: EmailContent;
};

export function buildEmailSamples(base: string): EmailSample[] {
  const b = base.replace(/\/$/, '');
  const name = 'Maria Voss';
  const workshopTitle = 'Somatic Vocal Healing Workshop';
  const whenLocal = 'Monday 15 June 2026, 20:00 (CEST)';
  const discountEndsLocal = 'Wednesday 17 June 2026, 21:00 (CEST)';
  const resumeUrl = `${b}/workshop?resume=sample0123456789abcdef0123456789ab#register`;
  const joinUrl = `${b}/workshop/success?t=sample0123456789abcdef0123456789ab`;
  // Personalized: the course page reads ?email= and shows that person's
  // price (and any live discount) without them typing anything.
  const courseUrl = `${b}/courses/12-week?email=maria%40example.com#register`;
  const certUrl = `${b}/courses/certification?email=maria%40example.com`;
  const calendarUrl = `${b}/workshop`;
  const unsubscribeUrl = `${b}/unsubscribe?e=maria%40example.com&t=preview`;
  const lc = { name, workshopTitle, unsubscribeUrl };
  // Last-chance countdown points at a ~5h-ahead deadline so the preview clock
  // shows real time remaining.
  const countdownGifUrl = `${b}/api/countdown.gif?ends=${Date.now() + 5 * 60 * 60 * 1000}`;
  // A sample downsell with everything eligible (owns nothing) — shows the
  // feature card, the "also" mini-cards, and the bundle mention.
  const sampleOffers = DOWNSELL_ORDER.map((k) => DOWNSELL_OFFERS[k]);
  const downsellCtx = {
    ...lc,
    base: b,
    courseUrl,
    calendarUrl,
    offers: sampleOffers,
    bundleEligible: true,
  };

  return [
    // ── Abandoned checkout ──────────────────────────────────────────────
    {
      id: 'abandoned_1',
      group: 'Abandoned checkout',
      label: 'Nudge 1 — the open door',
      timing: '~45–60 min after checkout was left',
      audience: "Started checkout, didn't pay (and holds no paid seat anywhere)",
      content: abandonedEmail1({ ...lc, whenLocal, resumeUrl }),
    },
    {
      id: 'abandoned_2',
      group: 'Abandoned checkout',
      label: 'Nudge 2 — honest small print',
      timing: '~20h after, only while the date is still ahead',
      audience: 'Same — second and last touch',
      content: abandonedEmail2({ ...lc, whenLocal, resumeUrl }),
    },

    // ── Registration + reminders (transactional) ────────────────────────
    {
      id: 'confirmation',
      group: 'Registration & reminders (transactional)',
      label: 'Registration confirmation',
      timing: 'Immediately on payment',
      audience: 'Everyone who secures a seat',
      content: confirmationEmail({
        name,
        workshopTitle,
        whenLocal,
        joinUrl,
        googleCalUrl: '#',
        icsUrl: '#',
      }),
    },
    {
      id: 'reminder_7d',
      group: 'Registration & reminders (transactional)',
      label: 'Reminder — one week out (spacious heads-up)',
      timing: '7 days before the session',
      audience: 'Everyone registered',
      content: reminderEmail('reminder_7d', { name, workshopTitle, whenLocal, joinUrl }),
    },
    {
      id: 'reminder_2d',
      group: 'Registration & reminders (transactional)',
      label: 'Reminder — two days out (the practical prep list)',
      timing: '2 days before the session',
      audience: 'Everyone registered',
      content: reminderEmail('reminder_2d', { name, workshopTitle, whenLocal, joinUrl }),
    },
    {
      id: 'reminder_1d',
      group: 'Registration & reminders (transactional)',
      label: 'Reminder — tomorrow (the shape of the hour + seed practice)',
      timing: '24h before the session',
      audience: 'Everyone registered',
      content: reminderEmail('reminder_1d', { name, workshopTitle, whenLocal, joinUrl }),
    },
    {
      id: 'reminder_15m',
      group: 'Registration & reminders (transactional)',
      label: 'Reminder — 15 minutes (lean; just the door — also 6h/1h/at start)',
      timing: '15 min before the session',
      audience: 'Everyone registered',
      content: reminderEmail('reminder_15m', { name, workshopTitle, whenLocal, joinUrl }),
    },
    {
      id: 'verification',
      group: 'Registration & reminders (transactional)',
      label: 'Email verification code',
      timing: 'During registration',
      audience: 'Everyone registering',
      content: verificationEmail('482913'),
    },

    // ── Attended → 12-week course (48h / 20% window) ────────────────────
    // The `promo: false` samples are the default 20%/48h participant window.
    // The `promo: true` variants below show what actually goes out while the
    // launch promo is live — the promo percent through its calendar deadline.
    {
      id: 'attended_1',
      group: 'Attended → 12-week course',
      label: 'Email 1 — thank you + the window opens',
      timing: 'Right after the session ends',
      audience: 'Attended (non-pro)',
      content: attendedEmail1({ ...lc, courseUrl, discountEndsLocal, hoursRemaining: 47, discountPercent: 20, promo: false }),
    },
    {
      id: 'attended_1_promo',
      group: 'Attended → 12-week course',
      label: `Email 1 — during the launch promo (${LAUNCH_PROMO_PERCENT}% off)`,
      timing: 'Right after the session ends, while the launch promo runs',
      audience: 'Attended (non-pro), promo live',
      content: attendedEmail1({ ...lc, courseUrl, discountEndsLocal: LAUNCH_PROMO_END_LABEL, hoursRemaining: 47, discountPercent: LAUNCH_PROMO_PERCENT, promo: true }),
    },
    {
      id: 'attended_1_bought',
      group: 'Attended → 12-week course',
      label: 'Email 1 — variant for people who already bought',
      timing: 'Right after the session ends',
      audience: 'Attended, already owns the course (no pitch)',
      content: attendedEmail1({ ...lc, courseUrl, discountEndsLocal, hoursRemaining: 47, discountPercent: 20, promo: false, alreadyBoughtCourse: true }),
    },
    {
      id: 'attended_2',
      group: 'Attended → 12-week course',
      label: 'Email 2 — the case for the course',
      timing: '+24h (mid-window)',
      audience: "Attended, hasn't bought",
      content: attendedEmail2({ ...lc, courseUrl, discountEndsLocal, hoursRemaining: 23, discountPercent: 20, promo: false }),
    },
    {
      id: 'attended_2_promo',
      group: 'Attended → 12-week course',
      label: `Email 2 — during the launch promo (${LAUNCH_PROMO_PERCENT}% off)`,
      timing: '+24h, while the launch promo runs',
      audience: "Attended, hasn't bought, promo live",
      content: attendedEmail2({ ...lc, courseUrl, discountEndsLocal: LAUNCH_PROMO_END_LABEL, hoursRemaining: 23, discountPercent: LAUNCH_PROMO_PERCENT, promo: true }),
    },
    {
      id: 'attended_3',
      group: 'Attended → 12-week course',
      label: 'Email 3 — last chance',
      timing: '+42h (~6h before the discount ends)',
      audience: "Attended, hasn't bought",
      content: attendedEmail3({ ...lc, courseUrl, discountEndsLocal, hoursRemaining: 5, countdownGifUrl, discountPercent: 20, promo: false }),
    },
    {
      id: 'attended_3_promo',
      group: 'Attended → 12-week course',
      label: `Email 3 — during the launch promo (${LAUNCH_PROMO_PERCENT}% off)`,
      timing: 'Last touch, while the launch promo runs',
      audience: "Attended, hasn't bought, promo live",
      content: attendedEmail3({ ...lc, courseUrl, discountEndsLocal: LAUNCH_PROMO_END_LABEL, hoursRemaining: 5, countdownGifUrl, discountPercent: LAUNCH_PROMO_PERCENT, promo: true }),
    },

    // ── Attended, PRO → certification path ──────────────────────────────
    {
      id: 'attended_pro_1',
      group: 'Attended PRO → certification path',
      label: 'Email 1 — thank you + the practitioner door',
      timing: 'Right after the session ends',
      audience: 'Masterclass attendees + practitioner-door (audience 3) sign-ups (and is_pro once the column lands)',
      content: attendedProEmail1({ ...lc, certUrl, courseUrl, hoursRemaining: 47, discountEndsLocal, discountPercent: 20, promo: false }),
    },
    {
      id: 'attended_pro_2',
      group: 'Attended PRO → certification path',
      label: 'Email 2 — holding space is a craft',
      timing: '+2 days',
      audience: "PRO, hasn't bought the certification",
      content: attendedProEmail2({ ...lc, certUrl }),
    },
    {
      id: 'attended_pro_3',
      group: 'Attended PRO → certification path',
      label: 'Email 3 — last note, no deadline theatre',
      timing: '+5 days',
      audience: "PRO, hasn't bought the certification",
      content: attendedProEmail3({ ...lc, certUrl }),
    },

    // ── Missed the workshop ──────────────────────────────────────────────
    {
      id: 'no_show_1',
      group: 'Missed the workshop',
      label: 'Email 1 — seat is safe',
      timing: 'Right after the session ends',
      audience: 'Paid but never joined',
      content: noShowEmail1({ ...lc, hubUrl: joinUrl }),
    },
    {
      id: 'no_show_2',
      group: 'Missed the workshop',
      label: 'Email 2 — rebook, with permission for the hesitant',
      timing: '+2 days',
      audience: 'Still a no-show',
      content: noShowEmail2({ ...lc, hubUrl: joinUrl }),
    },
    {
      id: 'no_show_3',
      group: 'Missed the workshop',
      label: 'Email 3 — last note, then quiet',
      timing: '+6 days',
      audience: 'Still a no-show — final touch',
      content: noShowEmail3({ ...lc, hubUrl: joinUrl }),
    },

    // ── Downsell (window closed unbought) — journeys + grief, Drip-aware ──
    {
      id: 'downsell_1',
      group: 'Downsell — after the window',
      label: 'Email 1 — a gentler door (features the top not-owned offer)',
      timing: '+4 days (discount closed at +48h)',
      audience: "Attended (non-pro), didn't buy the course or cert",
      content: downsellEmail1(downsellCtx),
    },
    {
      id: 'downsell_2',
      group: 'Downsell — after the window',
      label: 'Email 2 — in your own room (next offer + the rest as mini-cards)',
      timing: '+8 days',
      audience: 'Same — still no purchase',
      content: downsellEmail2(downsellCtx),
    },
    {
      id: 'downsell_3',
      group: 'Downsell — after the window',
      label: 'Email 3 — three breaths and a tone (free practice + live calendar); series ends',
      timing: '+12 days',
      audience: 'Same — final touch',
      content: downsellEmail3(downsellCtx),
    },
    {
      id: 'downsell_1_owned',
      group: 'Downsell — after the window',
      label: 'Email 1 — variant when they already own every journey + grief (no pitch)',
      timing: '+4 days',
      audience: 'Attended, owns the lot — only this wind-down goes out',
      content: downsellEmail1({ ...downsellCtx, offers: [], bundleEligible: false }),
    },

    // ── Internal order notifications (SD-ORDER, ops only) ────────────────
    {
      id: 'order_course',
      group: 'Order notifications (internal)',
      label: 'SD-ORDER — course purchase',
      timing: 'On payment of a course order',
      audience: 'Team inbox (jacob@ + support@) — not the customer',
      content: buildOrderNotificationEmail(
        {
          orderType: 'course',
          orderId: 128,
          productName: 'SVH Certification Course',
          productSlug: 'cc-cert',
          firstName: 'Maria',
          customerName: 'Maria Voss',
          email: 'maria@example.com',
          phone: '+32 470 12 34 56',
          country: 'BE',
          companyName: 'Voss Voice Practice',
          vatNumber: 'BE0123456789',
          amountCents: 165000,
          currency: 'EUR',
          paymentPlan: '3x',
          installmentsTotal: 3,
          activateChoice: 'now',
          sourceVariant: 'returning',
          paidAt: '2026-06-12 09:14:00',
          stripePaymentIntent: 'pi_3QExample0001',
          stripeSubscriptionId: 'sub_1QExample0001',
        },
        { quadernoAccount: 'songdance', dripAccountId: '0000000', dripSubscriberId: 'abc123def456' },
      ),
    },
    {
      id: 'order_retreat',
      group: 'Order notifications (internal)',
      label: 'SD-ORDER — retreat purchase',
      timing: 'On payment of a retreat order',
      audience: 'Team inbox (jacob@ + support@) — not the customer',
      content: buildOrderNotificationEmail(
        {
          orderType: 'retreat',
          orderId: 54,
          productName: 'Somatic Vocal Healing Retreat',
          productSlug: 'svh-retreat',
          tierName: 'Shared room',
          firstName: 'Daniel',
          customerName: 'Daniel Mertens',
          email: 'daniel@example.com',
          phone: '+31 6 12 34 56 78',
          country: 'NL',
          amountCents: 145000,
          currency: 'EUR',
          dietary: 'Vegetarian',
          notes: 'Arriving the evening before.',
          paidAt: '2026-06-12 10:02:00',
          stripePaymentIntent: 'pi_3QExample0002',
        },
        { quadernoAccount: 'songdance', dripAccountId: '0000000', dripSubscriberId: 'xyz789ghi012' },
      ),
    },

    // ── Internal reports (SD-REPORT, ops only) ───────────────────────────
    {
      id: 'report_daily',
      group: 'Reports (internal)',
      label: 'SD-REPORT — daily digest',
      timing: 'Every morning (first hourly tick at/after 08:00 Brussels)',
      audience: 'Team inbox (REPORTS_TO) — registrations, course sales, bumps, revenue for yesterday',
      content: buildDailyReportEmail(sampleDailyReportData(), b),
    },
    {
      id: 'report_weekly',
      group: 'Reports (internal)',
      label: 'SD-REPORT — weekly digest',
      timing: 'Every Tuesday morning (the 7 days ending yesterday)',
      audience: 'Team inbox (REPORTS_TO) — same sections + a revenue-by-day table',
      content: buildWeeklyReportEmail(sampleWeeklyReportData(), b),
    },

    // ── Pre-workshop briefing (SD-BRIEFING, ops only) ────────────────────
    {
      id: 'briefing',
      group: 'Reports (internal)',
      label: 'SD-BRIEFING — pre-workshop roster',
      timing: 'About 5 minutes before each live workshop/masterclass',
      audience: 'Jacob (BRIEFING_TO) — registered count, the three-door audience mix, practitioners, add-on uptake, countries',
      content: buildBriefingEmail(sampleBriefingData(), b),
    },
  ];
}
