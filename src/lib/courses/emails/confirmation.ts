// Sending a course confirmation, and putting the buyer on what follows it.
//
// welcomeCourseOrder() runs from notifyCourseOrder (src/lib/orders/
// notification.ts), so every paid path reaches it at once — Stripe webhook,
// PayPal, free checkout, admin mark-paid, manual order — plus the hourly sweep
// below for anything a hiccup dropped. It re-reads the row itself: two of
// those callers hand over a row read before it was marked paid.
//
// Gated per course by the handover switch (./handover.ts): until a course is
// switched over, Drip sends its welcome and the site sends nothing. Only orders
// paid after the switch went on are ever confirmed from here, so flipping it
// never mails people who already had Drip's version.
//
// Transactional: never suppression-gated (it is the receipt and the way in).
// Idempotent on an `events` claim (`course-confirmation-<id>`), released if the
// send fails so the sweep retries. Never throws into a payment path.

import { BUMPS, isBumpSlug, type BumpSlug } from '../bumps';
import { FOUNDATION_WEEKS, getCertAccessForEmail } from '../cert-access';
import type { CourseRegistration } from '../db';
import { getCourseRegistrationById, parsePurchasedBumps } from '../db';
import { DECK_GIFT_BUMP_SLUG } from '../deck-promo';
import { logEvent } from '../../registrations/db';
import { formatMoney } from '../../workshops/currency';
import { sendEmail } from '../../workshops/resend';
import type { EmailContent } from '../../workshops/emails';
import { COURSE_DISPLAY_NAMES, courseConfirmationEmail, type ConfirmationCtx } from './confirmation-emails';
import { confirmationUnitFor, loadHandover, type HandoverUnit } from './handover';
import { enrollCourseSequences, sequencesForOrder, utcMs } from './sequences';

type WelcomeEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  RESEND_REPLY_TO?: string;
  PUBLIC_BASE_URL?: string;
  ADMIN_SESSION_SECRET?: string;
  MARKETING_FROM?: string;
  MARKETING_REPLY_TO?: string;
};

const CLAIM_KIND = 'course.confirmation.sent';

export function confirmationClaimId(courseRegistrationId: number): string {
  return `course-confirmation-${courseRegistrationId}`;
}

// The whole welcome for one paid order: sequences first (idempotent), then the
// confirmation (claimed). Never throws.
export async function welcomeCourseOrder(
  env: WelcomeEnv,
  regOrId: CourseRegistration | number,
  opts?: { handover?: Map<HandoverUnit, string> },
): Promise<void> {
  try {
    const id = typeof regOrId === 'number' ? regOrId : regOrId.id;
    const reg = await getCourseRegistrationById(env.DB, id);
    if (!reg || reg.status !== 'paid') return;
    const handover = opts?.handover ?? (await loadHandover(env.DB));
    if (!handover.size) return; // everything still with Drip
    await enrollCourseSequences(env, reg, handover);
    await sendCourseConfirmation(env, reg, handover);
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'course.confirmation.error',
      source: 'system',
      payload: {
        course_registration_id: typeof regOrId === 'number' ? regOrId : regOrId.id,
        error: String(err),
      },
    }).catch(() => {});
  }
}

// The order's own confirmation, when its course is switched over. And when it
// is NOT, but an order bump's course is (the ASJ or Grief bump on a 12-week /
// certification checkout): that bump gets its own welcome — otherwise turning
// the ASJ over (and its Drip welcome off) would leave a bump buyer on a
// Drip-run 12-week order with no way in to the journey at all.
async function sendCourseConfirmation(
  env: WelcomeEnv,
  reg: CourseRegistration,
  handover: Map<HandoverUnit, string>,
): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  const unit = confirmationUnitFor(reg.product_slug);
  if (!unit) return;
  const paidMs = utcMs(reg.paid_at) || utcMs(reg.created_at);
  const isOn = (u: HandoverUnit) => {
    const since = handover.get(u);
    return !!since && paidMs >= utcMs(since);
  };

  if (isOn(unit)) {
    await sendClaimed(env, reg, confirmationClaimId(reg.id), `course_confirmation_${unit}`, async () =>
      courseConfirmationEmail(await buildConfirmationCtx(env, reg, handover)),
    );
    return;
  }

  for (const bump of parsePurchasedBumps(reg.bumps)) {
    const bumpUnit: HandoverUnit | null = bump.slug === 'asj' ? 'asj' : bump.slug === 'grief' ? 'grief' : null;
    if (!bumpUnit || !isOn(bumpUnit)) continue;
    await sendClaimed(env, reg, `${confirmationClaimId(reg.id)}-${bump.slug}`, `course_confirmation_${bumpUnit}`, async () => {
      const ctx = await buildConfirmationCtx(env, reg, handover);
      const nameOf = BUMPS[bump.slug as BumpSlug].label;
      return courseConfirmationEmail({
        ...ctx,
        productSlug: bump.slug === 'asj' ? 'asj' : 'grief-course',
        languageChoice: null, // the bump is sold in English only
        bumps: [],
        onboarding: false,
        order: {
          rows: [[nameOf, bump.amount_cents > 0 ? formatMoney(bump.amount_cents, reg.currency) : 'free']],
          payment: `Added to your ${COURSE_DISPLAY_NAMES[reg.product_slug] ?? 'course'} order.`,
        },
      });
    });
  }
}

// Claim, build, send — releasing the claim if anything fails, so the hourly
// sweep tries again.
async function sendClaimed(
  env: WelcomeEnv,
  reg: CourseRegistration,
  externalId: string,
  trackType: string,
  build: () => Promise<EmailContent | null>,
): Promise<void> {
  let claimed = false;
  try {
    const r = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id)
         VALUES (NULL, '${CLAIM_KIND}', 'system', ?)`,
      )
      .bind(externalId)
      .run();
    claimed = (r.meta?.changes ?? 0) > 0;
    if (!claimed) return; // already sent

    const content = await build();
    if (!content) throw new Error(`no confirmation template for ${reg.product_slug}`);
    await sendEmail({
      apiKey: env.RESEND_API_KEY!,
      replyTo: env.RESEND_REPLY_TO,
      to: reg.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      entityRefId: externalId,
      track: { db: env.DB, type: trackType, registrationId: null },
    });
  } catch (err) {
    if (claimed) {
      await env.DB
        .prepare(`DELETE FROM events WHERE external_id = ? AND kind = '${CLAIM_KIND}'`)
        .bind(externalId)
        .run()
        .catch(() => {});
    }
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'course.confirmation.error',
      source: 'system',
      payload: { course_registration_id: reg.id, claim: externalId, error: String(err) },
    }).catch(() => {});
  }
}

function formatDay(d: Date, lang: 'en' | 'nl' = 'en'): string {
  return new Intl.DateTimeFormat(lang === 'nl' ? 'nl-BE' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

export async function buildConfirmationCtx(
  env: WelcomeEnv,
  reg: CourseRegistration,
  handover: Map<HandoverUnit, string>,
): Promise<ConfirmationCtx> {
  const base = (env.PUBLIC_BASE_URL || 'https://songdance.co').replace(/\/+$/, '');
  const nl = reg.language_choice === 'nl';
  const paidMs = utcMs(reg.paid_at) || utcMs(reg.created_at) || Date.now();
  const purchased = parsePurchasedBumps(reg.bumps);
  const bumps = purchased
    .map((b) => b.slug)
    .filter((s): s is 'asj' | 'grief' => s === 'asj' || s === 'grief');

  // Does this order put them on the weekly ASJ series (and the onboarding)?
  const seqs = sequencesForOrder(reg);
  const asjSince = handover.get('asj');
  const asjWeekly = seqs.some((s) => s.key === 'asj-weekly') && !!asjSince && paidMs >= utcMs(asjSince);
  const onboarding = seqs.some((s) => s.key === 'twelve-week' || s.key === 'certification');

  let certEndsOn: string | null = null;
  let certOpensOn: string | null = null;
  if (reg.product_slug === 'cc-cert' || reg.product_slug === 'cc-bundle') {
    try {
      const access = await getCertAccessForEmail(env.DB, reg.email);
      if (access?.endsOn) certEndsOn = formatDay(new Date(`${access.endsOn}T12:00:00Z`));
    } catch {
      /* the email reads fine without it */
    }
    if (reg.product_slug === 'cc-bundle' && reg.activate_choice !== 'now') {
      certOpensOn = formatDay(new Date(paidMs + FOUNDATION_WEEKS * 7 * 86_400_000));
    }
  }

  // The order panel: the course, the add-ons, how it was paid.
  const money = (minor: number) => (minor > 0 ? formatMoney(minor, reg.currency) : nl ? 'gratis' : 'free');
  const plan = reg.payment_plan !== 'full' && reg.installments_total > 1;
  const rows: Array<[string, string]> = [
    [
      COURSE_DISPLAY_NAMES[reg.product_slug] ?? reg.product_slug,
      plan
        ? `${formatMoney(Math.round(reg.amount_cents / reg.installments_total), reg.currency)} × ${reg.installments_total}`
        : money(reg.amount_cents),
    ],
  ];
  for (const b of purchased) {
    if (isBumpSlug(b.slug)) rows.push([BUMPS[b.slug as BumpSlug].label, money(b.amount_cents)]);
    else if (b.slug === DECK_GIFT_BUMP_SLUG) rows.push(['The Song Deck — our gift', nl ? 'gratis' : 'free']);
  }
  const payment =
    reg.amount_cents <= 0
      ? nl
        ? 'Geen betaling nodig.'
        : 'No payment needed.'
      : plan
        ? `Paid in ${reg.installments_total} monthly payments — the first is done; the rest follow automatically each month.`
        : nl
          ? 'Volledig betaald.'
          : 'Paid in full.';

  return {
    name: reg.first_name,
    email: reg.email,
    productSlug: reg.product_slug,
    languageChoice: reg.language_choice ?? null,
    activateChoice: reg.activate_choice ?? null,
    bumps,
    asjWeekly,
    onboarding,
    certEndsOn,
    certOpensOn,
    order: { rows, payment },
    base,
  };
}

// The hourly safety net: paid orders from the last 7 days, paid after their
// course's switch went on, that still have no confirmation claim — plus
// enrolment for anyone a dropped call missed (enrolment is idempotent, so
// re-running it for an order that already has its rows is a no-op).
export async function reconcileCourseWelcomes(env: WelcomeEnv, opts?: { limit?: number }): Promise<{ checked: number }> {
  const handover = await loadHandover(env.DB);
  if (!handover.size) return { checked: 0 };
  // Nothing paid before the earliest switch can be ours to send.
  const earliest = [...handover.values()].sort()[0];
  const { results } = await env.DB
    .prepare(
      `SELECT r.id FROM course_registrations r
        WHERE r.status = 'paid'
          AND COALESCE(r.paid_at, r.created_at) >= datetime('now', '-7 days')
          AND COALESCE(r.paid_at, r.created_at) >= ?
          AND r.product_slug NOT LIKE 'album-%'
        ORDER BY r.id DESC
        LIMIT ?`,
    )
    .bind(earliest, opts?.limit ?? 200)
    .all<{ id: number }>();
  let checked = 0;
  for (const r of results ?? []) {
    checked++;
    await welcomeCourseOrder(env, r.id, { handover });
  }
  return { checked };
}
