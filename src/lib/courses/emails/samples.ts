// Sample renders of every course email the site can send instead of Drip —
// the confirmations, the weekly Authentic Singing Journey sessions and the
// 12-week / certification onboarding — with fixed example data. Drives the
// previews on /admin/emails/courses and the [Test] send (which looks here as
// well as in the workshop samples). Timing strings are documentation; the real
// cadence lives in ./sequences.ts.

import type { EmailSample } from '../../workshops/email-samples';
import { formatMoney } from '../../workshops/currency';
import { courseConfirmationEmail, type ConfirmationCtx } from './confirmation-emails';
import { SEQUENCES, type SequenceKey } from './sequences';
import type { SequenceEmailCtx } from './sequence-emails';

const ORIGIN_NOTE: Record<string, string> = {
  drip: 'copy: Drip, as it was',
  'drip-adapted': 'copy: Drip, adapted (new app, copy book)',
  new: 'copy: new — Drip had no email here',
};

export const COURSE_SAMPLE_GROUPS = {
  confirmations: 'Course confirmations',
  asj: 'Authentic Singing Journey — weekly sessions',
  twelveWeek: '12-Week Course — onboarding',
  certification: 'Certification Course — onboarding',
} as const;

export function buildCourseEmailSamples(base: string): EmailSample[] {
  const b = (base || 'https://songdance.co').replace(/\/$/, '');
  const email = 'maria@example.com';
  const eur = (n: number) => formatMoney(n * 100, 'EUR');

  const conf = (over: Partial<ConfirmationCtx> & Pick<ConfirmationCtx, 'productSlug'>): ConfirmationCtx => ({
    name: 'maria voss',
    email,
    languageChoice: null,
    activateChoice: null,
    bumps: [],
    asjWeekly: true,
    onboarding: true,
    certEndsOn: null,
    certOpensOn: null,
    order: { rows: [], payment: 'Paid in full.' },
    base: b,
    ...over,
  });

  const confirmations: Array<{ id: string; label: string; audience: string; ctx: ConfirmationCtx }> = [
    {
      id: 'course_conf_12week',
      label: '12-Week Course — welcome (with the ASJ order bump)',
      audience: 'Buyers of the 12-Week Course (svh-12week). The "Also in your order" block appears only for bumps they took.',
      ctx: conf({
        productSlug: 'svh-12week',
        bumps: ['asj'],
        order: {
          rows: [
            ['12-Week Somatic Vocal Healing Course', eur(440)],
            ['The Authentic Singing Journey', eur(99)],
          ],
          payment: 'Paid in full.',
        },
      }),
    },
    {
      id: 'course_conf_cert',
      label: 'Certification Course — welcome',
      audience: 'Buyers of the certification course on its own (cc-cert). The end date is their own (cert-access.ts).',
      ctx: conf({
        productSlug: 'cc-cert',
        certEndsOn: '6 July 2027',
        order: { rows: [['Somatic Vocal Healing Certification Course', `${eur(266)} × 3`]], payment: 'Paid in 3 monthly payments — the first is done; the rest follow automatically each month.' },
      }),
    },
    {
      id: 'course_conf_path_wait',
      label: 'Certification path — welcome (certification opens after 12 weeks; with the Grief bump)',
      audience: 'Path buyers (cc-bundle) who chose to start the certification when the 12 weeks end.',
      ctx: conf({
        productSlug: 'cc-bundle',
        activateChoice: 'wait',
        bumps: ['grief'],
        certOpensOn: '29 December 2026',
        certEndsOn: '29 September 2027',
        order: {
          rows: [
            ['12-Week Course + Certification Course', eur(1075)],
            ['The Grief Course', eur(49)],
          ],
          payment: 'Paid in full.',
        },
      }),
    },
    {
      id: 'course_conf_path_now',
      label: 'Certification path — welcome (both open now)',
      audience: 'Path buyers (cc-bundle) who chose to open the certification straight away.',
      ctx: conf({
        productSlug: 'cc-bundle',
        activateChoice: 'now',
        certEndsOn: '29 September 2027',
        order: { rows: [['12-Week Course + Certification Course', `${eur(375)} × 3`]], payment: 'Paid in 3 monthly payments — the first is done; the rest follow automatically each month.' },
      }),
    },
    {
      id: 'course_conf_grief',
      label: 'The Grief Course — welcome',
      audience: 'Buyers of the Grief Course on its own (grief-course). Drip had no welcome on record for it.',
      ctx: conf({ productSlug: 'grief-course', order: { rows: [['The Grief Course', eur(99)]], payment: 'Paid in full.' } }),
    },
    {
      id: 'course_conf_asj',
      label: 'Authentic Singing Journey — welcome (opens Week 1)',
      audience: 'Buyers of the ASJ (asj), English edition. Week 1 rides this email; the weekly series starts at Week 2.',
      ctx: conf({ productSlug: 'asj', order: { rows: [['The Authentic Singing Journey', eur(150)]], payment: 'Paid in full.' } }),
    },
    {
      id: 'course_conf_asj_pro_both',
      label: 'Authentic Singing Journey PRO — welcome (both editions)',
      audience: 'ASJ PRO buyers (asj-pro) who chose English + Dutch.',
      ctx: conf({
        productSlug: 'asj-pro',
        languageChoice: 'both',
        order: { rows: [['The Authentic Singing Journey — PRO', eur(200)]], payment: 'Paid in full.' },
      }),
    },
    {
      id: 'course_conf_asj_nl',
      label: 'Authentiek Zingen — welkom (Dutch edition)',
      audience: 'ASJ buyers who chose the Dutch edition only (language_choice = nl). No weekly series for them yet.',
      ctx: conf({
        productSlug: 'asj',
        languageChoice: 'nl',
        asjWeekly: false,
        order: { rows: [['The Authentic Singing Journey', eur(150)]], payment: 'Volledig betaald.' },
      }),
    },
    {
      id: 'course_conf_mmj',
      label: 'Magical Movement Journey — welcome',
      audience: 'Buyers of the Magical Movement Journey (mmj).',
      ctx: conf({ productSlug: 'mmj', order: { rows: [['The Magical Movement Journey', eur(49)]], payment: 'Paid in full.' } }),
    },
    {
      id: 'course_conf_inner_child',
      label: 'Inner Child Healing Journey — welcome',
      audience: 'Buyers of the Inner Child Healing Journey (inner-child).',
      ctx: conf({ productSlug: 'inner-child', order: { rows: [['The Inner Child Healing Journey', eur(29)]], payment: 'Paid in full.' } }),
    },
    {
      id: 'course_conf_bundle_pro',
      label: 'The Three Journeys — welcome (bundle PRO)',
      audience: 'Buyers of the journeys bundle (journeys-bundle / journeys-bundle-pro); the PRO paragraph only for PRO.',
      ctx: conf({
        productSlug: 'journeys-bundle-pro',
        order: { rows: [['The Three Journeys — with the ASJ PRO mantra pack', eur(232)]], payment: 'Paid in full.' },
      }),
    },
  ];

  const out: EmailSample[] = [];
  for (const c of confirmations) {
    const content = courseConfirmationEmail(c.ctx);
    if (!content) continue;
    out.push({
      id: c.id,
      group: COURSE_SAMPLE_GROUPS.confirmations,
      label: c.label,
      timing: 'On payment — every fulfilment path, plus the hourly safety net',
      audience: c.audience,
      content,
    });
  }

  const seqCtx = (variant: string | null, certEndsOn: string | null = null): SequenceEmailCtx => ({
    name: 'maria voss',
    base: b,
    stopUrl: `${b}/courses/emails?t=42.0a1b2c3d4e5f60718293a4b5`,
    variant,
    certEndsOn,
  });

  const seqSamples = (
    key: SequenceKey,
    group: string,
    audience: string,
    ctxFor: (onlyVariants?: Array<string | null>) => SequenceEmailCtx,
  ) => {
    for (const step of SEQUENCES[key].steps) {
      const content = step.build(ctxFor(step.onlyVariants));
      if (!content) continue;
      out.push({
        id: `course_seq_${key}_${step.n}`,
        group,
        label: step.label,
        timing: `${step.dayOffset === 1 ? 'Day 1' : `Day ${step.dayOffset}`} after payment, at 09:00 in their timezone · ${ORIGIN_NOTE[step.origin]}`,
        audience,
        content,
      });
    }
  };

  seqSamples(
    'asj-weekly',
    COURSE_SAMPLE_GROUPS.asj,
    'Everyone who holds the ASJ in English (standalone, bundle, or the order bump on a course checkout). Stops on the button, a one-click unsubscribe, a full refund or a suppressed address.',
    () => seqCtx(null),
  );
  seqSamples(
    'twelve-week',
    COURSE_SAMPLE_GROUPS.twelveWeek,
    '12-Week Course buyers, and path buyers (who read their own lines about the Q&As carrying on).',
    (only) => seqCtx(only?.includes('path-wait') ? 'path-wait' : null, '29 September 2027'),
  );
  seqSamples(
    'certification',
    COURSE_SAMPLE_GROUPS.certification,
    'Buyers of the certification course on its own (cc-cert).',
    () => seqCtx(null, '6 July 2027'),
  );
  return out;
}
