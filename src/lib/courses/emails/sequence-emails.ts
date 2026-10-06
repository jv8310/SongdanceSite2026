// The words of the course sequences — what follows a confirmation, one note at
// a time (./sequences.ts decides when). Pure builders, previewed and
// test-sent from /admin/emails/courses.
//
//   • The Authentic Singing Journey — one email a week, Week 2 … Week 40, each
//     opening that week's session. The copy is the Drip series', week by week
//     (./asj-weeks.ts says exactly what changed).
//   • The 12-Week Course — the Drip workflow's notes ("See you in Q&A?", "How
//     to pace yourself", "Welcome to Week 2", "Welcome to Week 6"), plus a
//     week-12 note when the live Q&As close, and — for path buyers who chose to
//     wait — "your certification course is open" when the twelve weeks end
//     (Drip's "Activate the Certification Course Now", minus the activating).
//   • The Certification Course — the 12-week notes' certification twins (Drip
//     sent no welcome sequence for a standalone certification buyer).
//
// Every one carries a visible "stop these emails" button (and the
// List-Unsubscribe header the sender adds) that stops THIS series only — never
// an unsubscribe from Songdance, never the course itself.

import { MAILING_ADDRESS, shell, type EmailContent } from '../../workshops/emails';
import { CIRCLE_HOME_URL, circleAsjWeekUrl, circleUrl } from '../circle';
import { ASJ_WEEK_COUNT, asjWeek, asjWeekImagePath } from './asj-weeks';
import {
  button,
  eyebrow,
  greeting,
  join,
  list,
  para,
  quietButton,
  signoff,
  subhead,
  type Block,
} from './layout';

export type SequenceEmailCtx = {
  name: string | null;
  base: string;
  // The signed /courses/emails?t=… page for this person's series.
  stopUrl: string;
  // 'path-wait' / 'path-now' for a certification-path buyer riding the 12-week
  // series; null for everyone else.
  variant: string | null;
  // Already formatted ("31 December 2026").
  certEndsOn?: string | null;
};

type Built = {
  subject: string;
  preheader: string;
  heading: string;
  body: Array<Block | null | false>;
  closing?: string;
  heroImage?: { src: string; alt: string };
  stop: { label: string; note: string };
  footerNote: string;
};

function render(ctx: SequenceEmailCtx, b: Built): EmailContent {
  const content = join([
    ...b.body,
    signoff(b.closing ?? 'With love,'),
    quietButton(b.stop.label, ctx.stopUrl, b.stop.note),
  ]);
  return {
    subject: b.subject,
    html: shell({
      preheader: b.preheader,
      heading: b.heading,
      heroImage: b.heroImage,
      bodyHtml: content.html,
      footerNote: b.footerNote,
      address: MAILING_ADDRESS,
    }),
    text: `${content.text}\n\n—\n${b.footerNote}\n${MAILING_ADDRESS}`,
  };
}

// ── The Authentic Singing Journey, weekly ──────────────────────────────────

export const ASJ_STOP = {
  label: 'Stop these weekly emails',
  note: 'Your sessions stay yours either way — this only stops the weekly emails.',
};

export function asjWeeklyEmail(week: number, ctx: SequenceEmailCtx): EmailContent | null {
  const w = asjWeek(week);
  if (!w) return null;
  const last = week === ASJ_WEEK_COUNT;
  return render(ctx, {
    subject: `Authentic Singing Week ${week} — ${w.title}`,
    preheader: last
      ? 'The last session of your Authentic Singing Journey.'
      : `Session ${week} of ${ASJ_WEEK_COUNT} of your Authentic Singing Journey.`,
    heading: w.title,
    heroImage: { src: `${ctx.base.replace(/\/+$/, '')}${asjWeekImagePath(week)}`, alt: `Week ${week} — ${w.title}` },
    closing: 'Much love to you,',
    body: [
      eyebrow(`Week ${week} of ${ASJ_WEEK_COUNT}`),
      greeting(ctx.name),
      ...w.paragraphs.map((p) => para(p, ctx.base)),
      button(`Open Week ${week}`, circleAsjWeekUrl(week)),
    ],
    stop: ASJ_STOP,
    footerNote: 'You’re receiving this because you’re on the Authentic Singing Journey · Songdance · songdance.co',
  });
}

// ── The 12-Week Course ─────────────────────────────────────────────────────

const COURSE_STOP = {
  label: 'Stop these course emails',
  note: 'The course stays yours either way — this only stops these notes.',
};
const TWELVE_WEEK_FOOTER = 'You’re receiving this because you joined the 12-Week Course · Songdance · songdance.co';

function isPath(ctx: SequenceEmailCtx): boolean {
  return ctx.variant === 'path-wait' || ctx.variant === 'path-now';
}

// The Drip Q&A explainer, with one word changed: "release" → acknowledgment
// (copy book, law 2), and "emerge and resolve" → "come up and be acknowledged".
const QA_EXPLAINED = [
  'Somatic Vocal Healing Q&As are live, spacious gatherings where teaching, inquiry and real-time vocal processes come together in an organic way. Each one unfolds differently: sometimes beginning with simple regulation, sometimes moving straight into questions, and often evolving into deep guided journeys where sound reveals emotional, relational, ancestral or nervous-system layers. You may bring strong emotions, subtle sensations, life situations, facilitation questions — or simply a wish to listen and be held by the group field. Through live demonstrations and shared inquiry, the Q&As show how sound can support grounding, acknowledgment, clarity, compassion and reconnection — without forcing, without fixing, and without needing a clear story of “what happened.”',
  'You can join actively or quietly: ask a question, share an experience, or offer your voice when it feels right. Sessions often include teaching on how to work with sound in different emotional states, how to track shifts in frequency and quality, how to tell surface emotions from deeper body-level layers, and how relational or ancestral material can come up and be acknowledged in sound. Above all, the Q&As are a place to learn by witnessing, to feel supported by community, and to see how Somatic Vocal Healing unfolds in real life.',
];

export function twelveWeekStepEmail(step: number, ctx: SequenceEmailCtx): EmailContent | null {
  const path = isPath(ctx);
  const base = ctx.base;
  switch (step) {
    case 1:
      return render(ctx, {
        subject: 'See you in Q&A?',
        preheader: 'The live Q&As, and where to find them.',
        heading: 'See you in Q&A?',
        body: [
          greeting(ctx.name),
          para('Yesterday you joined the course, and you may already have watched the first class.', base),
          para(
            'Today I’d love to invite you to the live Q&As. They’re all in the calendar in the CiRCLE — join the ones you can, and watch the replays of the ones you can’t.',
            base,
          ),
          para(
            path
              ? 'Good to know: for you, the live Q&As carry on into your certification course, so they’re yours well beyond these twelve weeks. The video classes stay yours for life.'
              : 'Please note: the live Q&As and their replays are yours for the twelve weeks of the course. The video classes stay yours for life.',
            base,
          ),
          button('Go to the Q&A calendar', circleUrl('live')),
          subhead('What are the Q&As?'),
          ...QA_EXPLAINED.map((p) => para(p, base)),
          para('See you in Q&A!', base),
        ],
        stop: COURSE_STOP,
        footerNote: TWELVE_WEEK_FOOTER,
      });
    case 2:
      return render(ctx, {
        subject: 'How to pace yourself',
        preheader: 'Follow your own flow — there is no right speed.',
        heading: 'How to pace yourself',
        body: [
          greeting(ctx.name),
          para('You’re now two days into the course. Beautiful.', base),
          para('This note is here to help you find your own rhythm along the way. A few gentle reminders:', base),
          list([
            'Your own pace is what matters most. There is no “right” speed.',
            'You have lifetime access to all the course materials. Nothing is lost if you slow down.',
            'Feel free to alternate between the classes and the deepening sessions — you’ll find the deepening sessions just underneath the classes in the course materials.',
            path
              ? 'Join the live Q&As when you can, or watch the replays. For you they carry on into the certification course.'
              : 'Join the live Q&As when you can, or watch the replays during the twelve weeks. These aren’t lifetime access, so make the most of them if you feel called.',
          ]),
          para(
            `Finally, good to know: the [community feed](${CIRCLE_HOME_URL}) in the CiRCLE is there for you — to share thoughts, comment, and ask the group questions.`,
            base,
          ),
          button('Go to the course materials', circleUrl('twelve-week')),
        ],
        stop: COURSE_STOP,
        footerNote: TWELVE_WEEK_FOOTER,
      });
    case 3:
      return render(ctx, {
        subject: 'Welcome to Week 2',
        preheader: 'Explore the deepening sessions.',
        heading: 'Welcome to Week 2',
        body: [
          greeting(ctx.name),
          para('Welcome to Week 2 of the course! How are you feeling on your journey so far?', base),
          para('Today I’d love to tell you a little more about the deepening sessions.', base),
          para(
            'Alongside the six main classes, you also have six deepening sessions. They’re supportive, complementary sessions, made to help you integrate the work more deeply and meet your process with more clarity and richness. Some help you understand the core material more fully; others expand and enrich your sound journey.',
            base,
          ),
          para(
            'I recommend gently alternating between the main classes and the deepening sessions — that rhythm often supports the learning in a balanced way. That said, this is your journey, so follow what feels right for you.',
            base,
          ),
          para(
            'In some of the deepening sessions, you may notice a photograph and a candle for my late wife, Upala. These sessions were recorded shortly after her passing. We chose to include them because many students have found them deeply touching, grounding and supportive.',
            base,
          ),
          para('I hope these sessions accompany you well in this next part of your journey.', base),
          button('Go to the course materials', circleUrl('twelve-week')),
          para('Don’t hesitate to reach out if you have questions or comments — just reply. See you in Q&A?', base),
        ],
        stop: COURSE_STOP,
        footerNote: TWELVE_WEEK_FOOTER,
      });
    case 4:
      return render(ctx, {
        subject: 'Welcome to Week 6',
        preheader: 'Where are you in your process?',
        heading: 'Halfway',
        body: [
          greeting(ctx.name),
          para('You are now six weeks into the course. Halfway.', base),
          para('A beautiful moment to pause and check in with yourself. Where are you in your process right now — and what is the sound of it?', base),
          para('Remember: you have lifetime access to all the videos. There is truly no rush. You can move at your own rhythm.', base),
          para(
            path
              ? 'And the live Q&As carry on into your certification course, so there’s no clock on those for you either.'
              : 'The only time-bound part is the twelve weeks of live Q&As and their replays. If, after that, you’d like to keep joining the live sessions with me, there are options for that — just reply and I’ll tell you more.',
            base,
          ),
          para('I hope this second half of the journey brings you even more depth, clarity and ease.', base),
          button('Go to the Q&A calendar', circleUrl('live')),
          para('See you in Q&A?', base),
        ],
        stop: COURSE_STOP,
        footerNote: TWELVE_WEEK_FOOTER,
      });
    case 5:
      // Standalone 12-week only: the live Q&As close after this week. (New —
      // Drip had no week-12 note.)
      if (path) return null;
      return render(ctx, {
        subject: 'Your last week of live Q&As',
        preheader: 'The classes stay yours for life; the live Q&As close after this week.',
        heading: 'The twelfth week',
        body: [
          greeting(ctx.name),
          para('You’re in the twelfth week of the course — the last week of the live Q&As and their replays.', base),
          para(
            'If there’s a question you’ve been carrying, this is a good week to bring it. And if there’s a replay you meant to watch, this is the week for it.',
            base,
          ),
          para(
            'The classes, the deepening sessions and your bonus mantras stay yours for life. Come back to them whenever you like — the practice doesn’t end with the course. One tone, today, is still the whole instruction.',
            base,
          ),
          para('If you’d like to keep joining live sessions after this week, just reply and I’ll tell you what’s possible.', base),
          button('Go to the Q&A calendar', circleUrl('live')),
          para('Thank you for these twelve weeks.', base),
        ],
        stop: COURSE_STOP,
        footerNote: TWELVE_WEEK_FOOTER,
      });
    case 6:
      // Path buyers who chose to wait: the certification course opens on its
      // own when the twelve weeks are done (the CiRCLE reads the order).
      if (ctx.variant !== 'path-wait') return null;
      return render(ctx, {
        subject: 'Your certification course is open',
        preheader: 'It’s already on your account — there’s nothing to activate.',
        heading: 'Your certification course is open',
        body: [
          greeting(ctx.name),
          para('Congratulations on making your way through the 12-Week Course. Are you ready for what’s next?', base),
          para('Your certification course is open — it’s already on your account in the CiRCLE. There’s nothing to activate.', base),
          para('Inside, you’ll find:', base),
          list([
            { lead: 'A feed —', rest: 'a space to share, connect, respond to others and set your intentions.' },
            { lead: 'Course materials —', rest: 'the self-paced classes, each with its written manual, and more to support your journey.' },
            { lead: 'The monthly deepening sessions —', rest: 'a two-hour live experience each month, with past replays to explore.' },
            { lead: 'Hosted practice sessions —', rest: 'to give and receive with peers.' },
          ]),
          para(
            `And of course, the weekly live Q&As and their replays simply carry on${ctx.certEndsOn ? `, until ${ctx.certEndsOn}` : ''}.`,
            base,
          ),
          button('Open the certification course', circleUrl('certification')),
          para('A heartfelt welcome, and enjoy the certification course!', base),
        ],
        stop: COURSE_STOP,
        footerNote: 'You’re receiving this because you’re on the Somatic Vocal Healing Certification Path · Songdance · songdance.co',
      });
    default:
      return null;
  }
}

// ── The Certification Course ───────────────────────────────────────────────

const CERT_FOOTER = 'You’re receiving this because you joined the Certification Course · Songdance · songdance.co';

export function certificationStepEmail(step: number, ctx: SequenceEmailCtx): EmailContent | null {
  const base = ctx.base;
  switch (step) {
    case 1:
      return render(ctx, {
        subject: 'See you in the live sessions?',
        preheader: 'The weekly Q&As and the monthly deepening sessions, and where to find them.',
        heading: 'See you in the live sessions?',
        body: [
          greeting(ctx.name),
          para('Yesterday you joined the certification course, and you may already have opened the first class.', base),
          para(
            'Today I’d love to invite you to the live sessions: the weekly Q&As and the monthly deepening sessions. They’re all in the calendar in the CiRCLE — join the ones you can, and watch the replays of the ones you can’t.',
            base,
          ),
          ctx.certEndsOn
            ? para(`They’re yours until ${ctx.certEndsOn}. The class library stays yours for life.`, base)
            : null,
          button('Go to the calendar', circleUrl('live')),
          subhead('What are the Q&As?'),
          ...QA_EXPLAINED.map((p) => para(p, base)),
          para(
            'The deepening sessions are two hours, once a month, with the wider community of practitioners — and every one is recorded into the library.',
            base,
          ),
          para('See you there!', base),
        ],
        stop: COURSE_STOP,
        footerNote: CERT_FOOTER,
      });
    case 2:
      return render(ctx, {
        subject: 'How to pace yourself',
        preheader: 'Classes, manuals, practice — in your own rhythm.',
        heading: 'How to pace yourself',
        body: [
          greeting(ctx.name),
          para('You’re now two days into the course. Beautiful.', base),
          para('A few gentle reminders, to help you find your own rhythm:', base),
          list([
            'Your own pace is what matters most. There is no “right” speed.',
            'Every class comes with a written manual — read it before the class or after it, whichever helps you more.',
            'The hosted practice sessions are where the work becomes yours: giving and receiving with peers. Join them early, even before you feel ready. Nothing here needs you to be ready.',
            'Between sessions, the Somatic Vocal Healing app is there: record your sounds, tag them, come back to them, and train your ear.',
            'Join the live sessions when you can, or watch the replays.',
          ]),
          para(
            `Finally, good to know: the [community feed](${CIRCLE_HOME_URL}) in the CiRCLE is there for you — to share thoughts, comment, and ask the group questions.`,
            base,
          ),
          button('Go to the course', circleUrl('certification')),
        ],
        stop: COURSE_STOP,
        footerNote: CERT_FOOTER,
      });
    default:
      return null;
  }
}
