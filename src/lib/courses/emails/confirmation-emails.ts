// The words of the course confirmations — one email per paid order, sent the
// moment the payment lands (./confirmation.ts). These replace the welcome
// emails Drip's workflows sent (recovered from Gmail; the Drip API can't read
// workflow emails): "Thank you for registering for the 12-Week Course",
// "Welcome — here's how the path unfolds", "Welcome to the Authentic Singing
// Journey", the per-journey "Your Songdance Program" mails.
//
// Written as the new CiRCLE app works: every course is already on the buyer's
// account when this arrives, so there are no activation buttons, no plan links,
// no "make sure to click BOTH buttons" — one sentence says where to sign in and
// with which address, and one button opens the course.
//
// Pure builders (no DB, no env) so /admin/emails/courses can preview and
// test-send every one of them. Transactional: never gated by unsubscribes.
// Copy book applies (docs/svh-copy-book.md): sounding not singing for the SVH
// courses (the Authentic Singing Journey IS singing — "a different door",
// ch. 6/43), acknowledgment not release, no outcome promises.

import { guarantee } from '../../guarantee';
import { shell, type EmailContent } from '../../workshops/emails';
import { CIRCLE_HOME_URL, circleAsjWeekUrl, circleUrl, type CircleArea } from '../circle';
import { asjWeek } from './asj-weeks';
import {
  accessBlock,
  accessBlockNl,
  button,
  greeting,
  join,
  list,
  orderPanel,
  para,
  signoff,
  subhead,
  type Block,
} from './layout';

export type ConfirmationCtx = {
  name: string | null;
  // The address the order was placed with — the one to sign in with.
  email: string;
  productSlug: string;
  languageChoice: 'en' | 'nl' | 'both' | null;
  activateChoice: 'now' | 'wait' | null;
  // Order bumps bought on the same checkout (12-week / certification / path).
  bumps: Array<'asj' | 'grief'>;
  // Does this buyer get the weekly ASJ emails? (The ASJ switch is on, and not
  // the Dutch-only edition.) Decides whether the email promises them.
  asjWeekly: boolean;
  // Does this buyer get the onboarding notes after the confirmation?
  onboarding: boolean;
  // Already formatted, in the buyer's language ("31 December 2026").
  certEndsOn?: string | null;
  certOpensOn?: string | null;
  order: { rows: Array<[string, string]>; payment: string };
  base: string;
};

export const COURSE_DISPLAY_NAMES: Record<string, string> = {
  'svh-12week': '12-Week Somatic Vocal Healing Course',
  'cc-cert': 'Somatic Vocal Healing Certification Course',
  'cc-bundle': '12-Week Course + Certification Course',
  'grief-course': 'The Grief Course',
  asj: 'The Authentic Singing Journey',
  'asj-pro': 'The Authentic Singing Journey — PRO',
  mmj: 'The Magical Movement Journey',
  'inner-child': 'The Inner Child Healing Journey',
  'journeys-bundle': 'The Three Journeys',
  'journeys-bundle-pro': 'The Three Journeys — with the ASJ PRO mantra pack',
};

const HAS_PRO = new Set(['asj-pro', 'journeys-bundle-pro']);

export function courseConfirmationEmail(ctx: ConfirmationCtx): EmailContent | null {
  switch (ctx.productSlug) {
    case 'svh-12week':
      return twelveWeek(ctx);
    case 'cc-cert':
      return certification(ctx);
    case 'cc-bundle':
      return path(ctx);
    case 'grief-course':
      return grief(ctx);
    case 'asj':
    case 'asj-pro':
      return ctx.languageChoice === 'nl' ? asjDutch(ctx) : asj(ctx);
    case 'mmj':
      return mmj(ctx);
    case 'inner-child':
      return innerChild(ctx);
    case 'journeys-bundle':
    case 'journeys-bundle-pro':
      return bundle(ctx);
    default:
      return null;
  }
}

// ── Shared pieces ──────────────────────────────────────────────────────────

const ONE_TONE =
  'And before you even open it: one breath in, one tone out. What is the sound of this moment?';

function finish(
  ctx: ConfirmationCtx,
  opts: {
    subject: string;
    preheader: string;
    heading: string;
    body: Array<Block | null | false>;
    closing?: string;
    lang?: 'en' | 'nl';
  },
): EmailContent {
  const nl = opts.lang === 'nl';
  const footnotes = [
    para(nl ? GUARANTEE_NL : guarantee.line, ctx.base, { small: true }),
    para(
      nl
        ? 'Vragen, of klopt er iets niet? Antwoord gewoon op deze e-mail — iemand leest elk bericht.'
        : 'Questions, or something not as it should be? Just reply to this email — a person reads every one.',
      ctx.base,
      { small: true },
    ),
  ];
  const content = join([
    greeting(ctx.name, nl ? 'nl' : 'en'),
    ...opts.body,
    signoff(opts.closing ?? (nl ? 'Met warme groeten,' : 'With love,')),
    orderBlock(ctx, nl),
    ...footnotes,
  ]);
  return {
    subject: opts.subject,
    html: shell({ preheader: opts.preheader, heading: opts.heading, bodyHtml: content.html }),
    text: content.text,
  };
}

const GUARANTEE_NL = `Neem de volle ${guarantee.days} dagen. Is de cursus niets voor jou, schrijf ons dan en je krijgt het volledige bedrag terug.`;

function orderBlock(ctx: ConfirmationCtx, nl: boolean): Block {
  return orderPanel(nl ? 'Je bestelling' : 'Your order', ctx.order.rows, ctx.order.payment);
}

// "Also in your order" — the order bumps of a course checkout.
function bumpBlocks(ctx: ConfirmationCtx): Block[] {
  if (!ctx.bumps.length) return [];
  const out: Block[] = [subhead('Also in your order')];
  if (ctx.bumps.includes('asj')) {
    out.push(
      para(
        `The Authentic Singing Journey — forty sessions of music, mantras and your own voice — is on your account too. Begin with [Week 1, Discover Your Voice](${circleAsjWeekUrl(1)})${ctx.asjWeekly ? '; after that, I’ll send you one session a week' : ''}.`,
        ctx.base,
      ),
    );
  }
  if (ctx.bumps.includes('grief')) {
    out.push(
      para(
        `The Grief Course — four sessions with Daniela Hess and me — is on your account too. [Open it here](${circleUrl('grief')}) whenever you’re ready; take the sessions one at a time, with some space after each.`,
        ctx.base,
      ),
    );
  }
  return out;
}

function open(label: string, area: CircleArea): Block {
  return button(label, circleUrl(area));
}

// ── The 12-Week Course ─────────────────────────────────────────────────────

const TWELVE_WEEK_INSIDE = list([
  {
    lead: 'The classes —',
    rest: 'six main classes and six deepening sessions, chaptered so it’s easy to find your way. Yours for life.',
  },
  {
    lead: 'Your five bonus mantras —',
    rest: 'five of my original mantras, for the pleasure of a voice doing something beautiful.',
  },
  {
    lead: 'The live Q&As —',
    rest: 'an hour with me every week, on a rotating schedule so every timezone gets a turn, with replays. These are yours for the twelve weeks of the course.',
  },
  {
    lead: 'The community —',
    rest: 'a place to share where you are, and to hear where others are.',
  },
]);

function twelveWeek(ctx: ConfirmationCtx): EmailContent {
  return finish(ctx, {
    subject: 'Welcome to the 12-Week Course',
    preheader: 'Your place is confirmed — the course is already waiting for you in the CiRCLE.',
    heading: 'Welcome to the 12-Week Course',
    body: [
      para('Thank you for joining the 12-Week Somatic Vocal Healing Course. Your place is confirmed.', ctx.base),
      accessBlock(ctx.email, 'the course'),
      subhead('What’s waiting for you'),
      TWELVE_WEEK_INSIDE,
      subhead('How to begin'),
      para(
        `Watch the first class when you have an unhurried hour. One class a week is a good rhythm — your own pace is a better one.${ctx.onboarding ? ' Over the next days I’ll send you a few short notes to help you find your way in.' : ''}`,
        ctx.base,
      ),
      open('Open the course', 'twelve-week'),
      para(ONE_TONE, ctx.base),
      ...bumpBlocks(ctx),
    ],
  });
}

// ── The Certification Course ───────────────────────────────────────────────

function certInside(opts: { includeQa: boolean }) {
  return list([
    {
      lead: 'The complete class library —',
      rest: 'every class with a detailed written manual, self-paced, open from today.',
    },
    ...(opts.includeQa
      ? [
          {
            lead: 'Weekly live Q&As —',
            rest: 'an hour with me every week (now and then hosted by Karen Evans), with replays.',
          },
        ]
      : []),
    {
      lead: 'Monthly deepening sessions —',
      rest: 'two hours, live, with the wider community of practitioners. Every one is recorded into the library.',
    },
    {
      lead: 'Hosted practice sessions —',
      rest: 'to give and receive with peers. The quiet heart of the course.',
    },
    {
      lead: 'The Somatic Vocal Healing app —',
      rest: 'to record, tag and revisit your own sounds, train your ear, and keep practising between sessions.',
    },
    {
      lead: 'Feedback from me on your video —',
      rest: 'when you feel ready, you submit a session you have held, and I watch it with you in mind. That is the step toward certification.',
    },
  ]);
}

function certYear(ctx: ConfirmationCtx): Block | null {
  return ctx.certEndsOn
    ? para(
        `Your live course year runs until ${ctx.certEndsOn}: the Q&As and the deepening sessions are yours until then. The materials stay yours for life.`,
        ctx.base,
      )
    : null;
}

function certification(ctx: ConfirmationCtx): EmailContent {
  return finish(ctx, {
    subject: 'Welcome to the Certification Course',
    preheader: 'Your place is confirmed — everything is already waiting for you in the CiRCLE.',
    heading: 'Welcome to the Certification Course',
    body: [
      para('Thank you for joining the Somatic Vocal Healing Certification Course. Your place is confirmed.', ctx.base),
      para(
        'This is where the work goes deeper — into your own voice first, and from there toward holding space for others: in the work you already do, in a practice of your own, or simply as a deeper personal path. You don’t need to know yet which it will be.',
        ctx.base,
      ),
      accessBlock(ctx.email, 'the course'),
      subhead('What’s waiting for you'),
      certInside({ includeQa: true }),
      certYear(ctx),
      open('Open the course', 'certification'),
      para(
        `Begin wherever you like${ctx.onboarding ? ' — over the next days I’ll send you two short notes on finding your rhythm' : ''}. ${ONE_TONE.replace('And before you even open it: ', 'And today: ')}`,
        ctx.base,
      ),
      ...bumpBlocks(ctx),
    ],
  });
}

// ── The path: 12-Week Course + Certification ───────────────────────────────

function path(ctx: ConfirmationCtx): EmailContent {
  const now = ctx.activateChoice === 'now';
  const certLine = now
    ? 'You chose to open it straight away, so it’s already on your account too: the class library with written manuals, the monthly live deepening sessions, hosted practice sessions and the Somatic Vocal Healing app.'
    : `It opens on its own when your twelve weeks are complete${ctx.certOpensOn ? ` — on ${ctx.certOpensOn}` : ''} — and I’ll write to you that day. It brings the class library with written manuals, the monthly live deepening sessions, hosted practice sessions and the Somatic Vocal Healing app; the weekly Q&As simply carry on.`;
  return finish(ctx, {
    subject: 'Welcome — here’s how the path unfolds',
    preheader: now
      ? 'Both courses are already waiting for you in the CiRCLE.'
      : 'The 12-Week Course is open now; the certification course follows on its own.',
    heading: 'Here’s how the path unfolds',
    body: [
      para('Thank you for choosing the Somatic Vocal Healing Certification Path.', ctx.base),
      para(
        'This journey begins with your own voice and your own healing. From there, we’ll gradually turn toward holding others — in your current work, a future practice, or simply as a deeper personal path. You don’t need to know yet which it will be.',
        ctx.base,
      ),
      accessBlock(ctx.email, now ? 'both courses' : 'the 12-Week Course'),
      subhead('The rhythm I suggest'),
      list([
        {
          lead: 'First, the 12-Week Course —',
          rest: 'one class a week at your own pace (six main classes, six deepening sessions), weekly live Q&As with replays, and five bonus mantras.',
        },
        { lead: 'Then the Certification Course —', rest: certLine },
      ]),
      now
        ? null
        : para(
            'Moving faster than twelve weeks? Just reply to this email and we’ll open the certification course early.',
            ctx.base,
          ),
      certYear(ctx),
      open('Open the 12-Week Course', 'twelve-week'),
      para(ONE_TONE, ctx.base),
      ...bumpBlocks(ctx),
    ],
  });
}

// ── The Grief Course ───────────────────────────────────────────────────────

function grief(ctx: ConfirmationCtx): EmailContent {
  return finish(ctx, {
    subject: 'Welcome to the Grief Course',
    preheader: 'Everything is waiting for you in the CiRCLE — at the pace grief sets.',
    heading: 'Welcome to the Grief Course',
    body: [
      para('Thank you for joining The Grief Course, with Daniela Hess and me.', ctx.base),
      accessBlock(ctx.email, 'the course'),
      subhead('What’s waiting for you'),
      list([
        { lead: 'Four sessions of 120 minutes,', rest: 'recorded live, to walk in your own time.' },
        {
          lead: 'Teachings, practices and guided journeys —',
          rest: 'on grief as a process rather than a single feeling, on the beliefs and emotions wrapped around a loss, and on the voice as a way to give grief its sound.',
        },
        { lead: 'Lifetime access —', rest: 'return whenever you need to.' },
      ]),
      subhead('A word before you begin'),
      para(
        'Grief has its own calendar. Take the sessions one at a time, and leave some space after each — a walk, a cup of tea, an early night. Nothing here needs you to be ready.',
        ctx.base,
      ),
      para(
        'When grief comes, it is welcome. And if it is heavy right now, keep good support around you as well — this course walks beside that; it doesn’t replace it.',
        ctx.base,
      ),
      open('Open the course', 'grief'),
    ],
  });
}

// ── The Authentic Singing Journey ──────────────────────────────────────────

function asj(ctx: ConfirmationCtx): EmailContent {
  const week1 = asjWeek(1)!;
  const pro = HAS_PRO.has(ctx.productSlug);
  return finish(ctx, {
    subject: 'Welcome to the Authentic Singing Journey',
    preheader: 'Week 1 is waiting for you — forty weeks of music, mantras and your own voice.',
    heading: 'A warm welcome to you',
    closing: 'Much love to you,',
    body: [
      para('I’m so glad you’ve chosen to begin your Authentic Singing Journey!', ctx.base),
      para(
        'Over the next forty weeks you’ll spend time with your voice in a playful yet profound way — singing, making music, meditating, learning, and finding a lot of new energy along the way.',
        ctx.base,
      ),
      para(
        'The sessions were made one week at a time, in a difficult season, by Upala and me — we used them on ourselves before anyone else heard them.',
        ctx.base,
      ),
      accessBlock(ctx.email, pro ? 'all forty sessions, and your PRO mantra pack,' : 'all forty sessions'),
      ctx.languageChoice === 'both'
        ? para('You chose both editions, so the Dutch sessions — Authentiek Zingen — are on your account as well.', ctx.base)
        : null,
      para(
        ctx.asjWeekly
          ? 'Go at your own pace. If a rhythm helps, I’ll send you one session a week from here on: what it is, where it came from, what it invites. Each of those emails has a button to stop them, if you’d rather walk it on your own.'
          : 'Go at your own pace. One session a week is a lovely rhythm, but there is no wrong one.',
        ctx.base,
      ),
      subhead(`Begin with Week 1 — ${week1.title}`),
      ...week1.paragraphs.map((p) => para(p, ctx.base)),
      button('Open Week 1', circleAsjWeekUrl(1)),
      pro
        ? para(
            `Your PRO mantra pack is on your account too: every mantra and soundscape of the journey without my guidance, in a format made for singing along — and licensed for your own groups, clients and events. [Open the mantra pack](${circleUrl('asj-mantra-pack')}).`,
            ctx.base,
          )
        : null,
      para('I wish you a beautiful journey.', ctx.base),
    ],
  });
}

function asjDutch(ctx: ConfirmationCtx): EmailContent {
  const pro = HAS_PRO.has(ctx.productSlug);
  return finish(ctx, {
    lang: 'nl',
    subject: 'Welkom bij Authentiek Zingen',
    preheader: 'Week 1 staat voor je klaar — veertig weken muziek, mantra’s en je eigen stem.',
    heading: 'Een warm welkom',
    body: [
      para('Wat fijn dat je kiest voor de reis van Authentiek Zingen!', ctx.base),
      para(
        'De komende veertig weken ga je op een speelse en toch diepe manier met je stem aan de slag: zingen, muziek maken, mediteren, leren — en onderweg veel nieuwe energie vinden.',
        ctx.base,
      ),
      para(
        'De sessies zijn week na week ontstaan, in een moeilijke periode, door Upala en mij — we gebruikten ze eerst op onszelf, nog voor iemand anders ze hoorde.',
        ctx.base,
      ),
      accessBlockNl(ctx.email, pro ? 'alle veertig sessies, en je PRO-mantrapakket,' : 'alle veertig sessies'),
      para(
        ctx.asjWeekly
          ? 'Ga in je eigen tempo. Wil je een ritme? Dan stuur ik je vanaf nu elke week de volgende sessie: wat ze is, waar ze vandaan komt, waartoe ze uitnodigt. In elke mail zit een knop om ze te stoppen, als je de reis liever op je eigen manier loopt.'
          : 'Ga in je eigen tempo. Eén sessie per week is een mooi ritme, maar er is geen verkeerd ritme.',
        ctx.base,
      ),
      subhead('Begin met Week 1 — Discover Your Voice'),
      para(
        'Sessie 1 vraagt niets anders dan luisteren — naar jezelf, naar de klank die je al hebt. Doe ze zo vaak je wil: elke keer brengt ze iets nieuws.',
        ctx.base,
      ),
      button('Open Week 1', circleAsjWeekUrl(1, 'nl')),
      pro
        ? para(
            `Je PRO-mantrapakket staat ook op je account: alle mantra’s en klanklandschappen van de reis, zonder mijn begeleiding, in een vorm om mee te zingen — met licentie voor je eigen groepen, cliënten en events. [Open het mantrapakket](${circleUrl('asj-mantra-pack')}).`,
            ctx.base,
          )
        : null,
      para('Ik wens je een prachtige reis.', ctx.base),
    ],
  });
}

// ── The other journeys ─────────────────────────────────────────────────────

function mmj(ctx: ConfirmationCtx): EmailContent {
  return finish(ctx, {
    subject: 'Welcome to the Magical Movement Journey',
    preheader: 'Ten sessions, ten ways back into the body — already waiting for you in the CiRCLE.',
    heading: 'Welcome to the Magical Movement Journey',
    body: [
      para('Thank you for choosing the Magical Movement Journey.', ctx.base),
      accessBlock(ctx.email, 'the journey'),
      list([
        'Ten guided movement sessions, each with its own original music.',
        'Done at home — standing, or seated in a chair.',
        'No steps, no choreography, nothing to get right.',
        'Yours for life — come back to any session, any time.',
      ]),
      para(
        'Put on one session, push the furniture back — or don’t — and move how you like, with no one keeping score.',
        ctx.base,
      ),
      open('Open the journey', 'mmj'),
    ],
  });
}

function innerChild(ctx: ConfirmationCtx): EmailContent {
  return finish(ctx, {
    subject: 'Welcome to the Inner Child Healing Journey',
    preheader: 'Five sessions, no rush — already waiting for you in the CiRCLE.',
    heading: 'Welcome to the Inner Child Healing Journey',
    body: [
      para('Thank you for choosing the Inner Child Healing Journey.', ctx.base),
      para(
        'Five sessions, no rush — turning toward the child you were, with a little more kindness than they were shown.',
        ctx.base,
      ),
      accessBlock(ctx.email, 'the journey'),
      list([
        'Five self-paced sessions — visualisation, music and mantra.',
        'Go as slowly as you need, and repeat any session as often as you like.',
        'Yours for life.',
      ]),
      para(
        'It moves at your pace — nothing pushes, nothing pries. If you’d like 1:1 support alongside it, just reply to this email and tell us; we’ll let you know what’s possible.',
        ctx.base,
      ),
      open('Open the journey', 'inner-child'),
    ],
  });
}

function bundle(ctx: ConfirmationCtx): EmailContent {
  const pro = HAS_PRO.has(ctx.productSlug);
  const dutchOnly = ctx.languageChoice === 'nl';
  const dutch =
    ctx.languageChoice === 'nl'
      ? ` You chose the Dutch edition — Authentiek Zingen${ctx.asjWeekly ? ', so the weekly emails come in Dutch' : ''}.`
      : ctx.languageChoice === 'both'
        ? ' You chose both editions, so the Dutch sessions — Authentiek Zingen — are there too.'
        : '';
  const asjWeekly = ctx.asjWeekly ? ' I’ll send you one session a week after that.' : '';
  return finish(ctx, {
    subject: 'Welcome to the Three Journeys',
    preheader: 'Singing, movement and the inner child — all three are already waiting in the CiRCLE.',
    heading: 'Welcome to the Three Journeys',
    body: [
      para('Thank you for choosing all three journeys.', ctx.base),
      accessBlock(ctx.email, pro ? 'all three journeys, and your PRO mantra pack,' : 'all three journeys'),
      para(
        `[The Authentic Singing Journey](${circleUrl(dutchOnly ? 'asj-nl' : 'asj')}) — forty sessions of music, mantras and your own voice. Begin with [Week 1, Discover Your Voice](${circleAsjWeekUrl(1, dutchOnly ? 'nl' : 'en')}).${asjWeekly}${dutch}`,
        ctx.base,
      ),
      para(
        `[The Magical Movement Journey](${circleUrl('mmj')}) — ten guided movement sessions with original music. No steps, no choreography, nothing to get right.`,
        ctx.base,
      ),
      para(
        `[The Inner Child Healing Journey](${circleUrl('inner-child')}) — five sessions of visualisation, music and mantra, at your own pace.`,
        ctx.base,
      ),
      pro
        ? para(
            `Your PRO mantra pack is there too: every mantra and soundscape of the singing journey without my guidance, in a format made for singing along — and licensed for your own groups, clients and events. [Open the mantra pack](${circleUrl('asj-mantra-pack')}).`,
            ctx.base,
          )
        : null,
      button('Open the CiRCLE', CIRCLE_HOME_URL),
      para('All three are yours for life. Begin wherever you feel the pull.', ctx.base),
    ],
  });
}
