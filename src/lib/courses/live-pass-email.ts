// "Your live pass is confirmed" — the buyer's own email when a live pass is
// paid. Called from notifyCourseOrder, so every fulfilment path sends it
// (Stripe webhook, PayPal, admin mark-paid, and the hourly reconcile).
//
// It names what the pass holds ("12 Q&As and 3 deepening sessions"), the day
// it starts and why that day when it is not today (their course's live
// sessions still run, or an earlier pass comes first), and — with the add-on —
// how long the window to apply for certification now stays open. Never an end
// date for the pass: it ends with its last session, which only the member app's
// calendar knows, and the app writes "1 session left" and "ended" itself
// (songdance-app, apps/api/src/lib/live-pass-notices.ts).
//
// Transactional (it is the receipt of access), so never suppression-gated.
// Idempotent on its own `events` claim (`live-pass-confirmed-<id>`), released on
// failure so a webhook redelivery or the reconcile retries. Never throws into
// the caller — a mail hiccup must not roll back a paid order.

import { getCourseRegistrationById, type CourseRegistration } from './db';
import { logEvent } from '../registrations/db';
import { livePassConfirmedEmail } from '../workshops/emails';
import { sendEmail } from '../workshops/resend';
import { businessDayOf } from '../workshops/periods';
import { certWindowForEmail } from './cert-window';
import { hasCertExtension, isLivePassSlug, livePassContents, livePassMonthsOf } from './live-pass';
import { planLivePass, settleLivePassPeriod } from './live-pass-plan';

// Where the sessions are: the member app's Events tab (circle.songdance.co
// moves from Mighty to the app at cutover; the path is the same in both).
export const LIVE_PASS_EVENTS_URL = 'https://circle.songdance.co/events';

type MailEnv = { DB: D1Database; RESEND_API_KEY?: string; RESEND_REPLY_TO?: string };

const fmtDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export async function sendLivePassConfirmation(env: MailEnv, passed: CourseRegistration): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  if (!isLivePassSlug(passed.product_slug)) return;
  // The Stripe webhook hands over the row as it was before it was marked paid:
  // read it again, and write only for a pass that really is paid.
  const reg = await getCourseRegistrationById(env.DB, passed.id).catch(() => null);
  if (!reg || reg.status !== 'paid') return;
  const months = livePassMonthsOf(reg.product_slug);
  if (!months) return;

  const externalId = `live-pass-confirmed-${reg.id}`;
  let claimed = false;
  try {
    const r = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id)
         VALUES (NULL, 'live_pass.confirmation.sent', 'system', ?)`,
      )
      .bind(externalId)
      .run();
    claimed = (r.meta?.changes ?? 0) > 0;
    if (!claimed) return; // already confirmed for this order

    // The dates the payment fixed (settled once; a second call reads them back).
    const period = await settleLivePassPeriod(env.DB, reg);
    if (!period) throw new Error('live pass period not settled');
    const paidOn = businessDayOf(reg.paid_at ?? reg.created_at);
    const plan = await planLivePass(env.DB, reg.email, { today: paidOn, onlyPassesBefore: reg.id });
    const extension = hasCertExtension(reg.bumps);
    const window = extension ? await certWindowForEmail(env.DB, reg.email) : null;

    const content = livePassConfirmedEmail({
      name: reg.first_name,
      loginEmail: reg.email,
      contents: livePassContents(months),
      startsLabel: fmtDay(period.startsOn),
      startsToday: period.startsOn <= paidOn,
      courseUntilLabel: plan.liveUntil && period.startsOn > paidOn ? fmtDay(plan.liveUntil) : null,
      passRunning: plan.passRunning,
      certWindowUntilLabel: window?.endsOn ? fmtDay(window.endsOn) : null,
      eventsUrl: LIVE_PASS_EVENTS_URL,
    });
    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      replyTo: env.RESEND_REPLY_TO,
      to: reg.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      entityRefId: externalId,
      track: { db: env.DB, type: 'live_pass_confirmed' },
    });
  } catch (err) {
    if (claimed) {
      await env.DB
        .prepare(`DELETE FROM events WHERE external_id = ? AND kind = 'live_pass.confirmation.sent'`)
        .bind(externalId)
        .run()
        .catch(() => {});
    }
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'live_pass.confirmation.error',
      source: 'system',
      payload: { course_registration_id: reg.id, error: String(err) },
    }).catch(() => {});
  }
}
