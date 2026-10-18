// Drip → site, one course at a time.
//
// Every course email used to come from a Drip workflow fired by the purchase's
// Drip tag/event. The site now holds its own version of each (the words in
// ./confirmation-emails.ts and ./sequence-emails.ts), but while a Drip workflow
// is still live, sending ours too would mail every buyer twice. So each course
// has a switch, OFF by default: off → Drip keeps sending, the site sends
// nothing; on → the site sends, and the matching Drip email steps are switched
// off in Drip the same day. Flipped on /admin/emails/courses. Nothing goes on
// before the CiRCLE app is live: every one of these emails sends the buyer
// there.
//
// "Switched off" means the email steps set to draft, one by one — never the
// workflow paused: the 12-week and certification workflows also keep fields
// and tags that other automations wait on (`drip.keep` below). The map was
// read from the Drip account itself (October 2026); re-read it before the day.
// It covers WORKFLOWS and EMAIL SERIES only: Drip's API has no endpoint for
// Rules (Automation → Rules), which also send course emails (e.g. the
// per-product "Your Songdance Program" welcome), so `RULES_PENDING` marks the
// units whose Drip side is unknown until someone lists those rules.
//
// A switch covers everything the site sends for that course: the confirmation
// on payment and any sequence that follows it. Stored in workshop_config as
// `course_emails_on:<unit>` = the UTC time it was switched on — so the hourly
// retry sweep only ever reaches orders paid after the switch, and turning it on
// never mails a backlog of buyers who already had Drip's version.

import type { CourseRegistrationSlug } from '../db';
import { isJourneySlug } from '../journeys';

export type HandoverUnit =
  | 'twelve-week'
  | 'certification'
  | 'path'
  | 'grief'
  | 'asj'
  | 'mmj'
  | 'inner-child'
  | 'journeys-bundle';

export type HandoverInfo = {
  unit: HandoverUnit;
  label: string;
  // What the site sends once this is on.
  covers: string;
  // The Drip side, read from the account itself (October 2026, read-only).
  drip: {
    // What Drip sends this course's buyers today.
    today: string;
    // Exactly what to switch off in Drip the day this goes on, in Drip's own
    // names. Empty = nothing to switch off.
    switchOff: string[];
    // Non-email steps in the same workflow that must keep running: they are
    // why the emails are set to draft one by one instead of pausing the
    // workflow.
    keep?: string[];
  };
  // Units that share Drip steps with this one: switching off those steps
  // affects their buyers too, so they go on the same day.
  together?: HandoverUnit[];
};

// The 12-Week, Certification and path switches share two Drip workflows (a
// path buyer carries both tags), so they go on together.
const SVH_TOGETHER: HandoverUnit[] = ['twelve-week', 'certification', 'path'];

export const HANDOVER_UNITS: HandoverInfo[] = [
  {
    unit: 'twelve-week',
    label: '12-Week Course',
    covers: 'Confirmation + the onboarding emails (day 1, day 2, week 2, week 6, week 12)',
    drip: {
      today:
        'Workflow “prod_SVH_12w” (starts on the prod_SVH_12w tag) sends six emails: SVH 12w Course - Access (on purchase), See you in Q&A? (day 1), SVH 12w Course - How to pace yourself (day 2), SVH - Week 2 Check-In (day 7), SVH - Week 6 Check-In (day 35) and SVH - Week 12 Check-In (day 77, only to buyers without the certification).',
      switchOff: [
        'In workflow “prod_SVH_12w”, set those six “Send an email” steps to draft. Don’t pause the workflow.',
      ],
      keep: [
        'The prod_SVH_week counter (1 … 12, then “Ended since …”): the certification workflow waits on it for path buyers.',
        'prod_SVH_QandA, prod_SVH_start, prod_SVH_payment and the prod_SVH_12w_end tag.',
        'The HTTP post at the end of a standalone 12-week run (Drip hides where it goes, so find out before ever removing it).',
        'Removing the buyer from “m25 | SVH Workshop”.',
      ],
    },
    together: SVH_TOGETHER,
  },
  {
    unit: 'certification',
    label: 'Certification Course (on its own)',
    covers: 'Confirmation + two onboarding emails (day 1, day 2)',
    drip: {
      today:
        'Workflow “prod_SVH_9m” (starts on the prod_SVH_9m tag) sends one of three “SVH 9m - Activation” emails (the Mighty Networks activation) — or first “SVH 9m - Wait until after 12w course”, and the activation once the 12 weeks end.',
      switchOff: [
        'In workflow “prod_SVH_9m”, set its four “Send an email” steps (the three SVH 9m - Activation, and SVH 9m - Wait until after 12w course) to draft. Don’t pause the workflow.',
      ],
      keep: ['The vsh_whitelist tag and the prod_SVH_9m_status field it sets.'],
    },
    together: SVH_TOGETHER,
  },
  {
    unit: 'path',
    label: '12-Week + Certification path',
    covers: 'Path confirmation + the 12-week onboarding + "your certification course is open" at week 12',
    drip: {
      today:
        'No workflow of its own: a path buyer carries both tags, so both workflows above run for them — the 12-week emails, and the certification activation (at once when they chose to start now; otherwise “Wait until after 12w course” first and the activation when the 12 weeks end).',
      switchOff: ['Nothing of its own — the steps in “prod_SVH_12w” and “prod_SVH_9m” above.'],
    },
    together: SVH_TOGETHER,
  },
  {
    unit: 'grief',
    label: 'The Grief Course',
    covers: 'Confirmation',
    drip: {
      today: 'No workflow or email series: whatever Grief buyers get from Drip comes from a Rule on the prod_Grief-sp tag, which the API can’t read.',
      switchOff: ['The Drip Rule(s) that email Grief buyers — to be listed from Automation → Rules.'],
    },
  },
  {
    unit: 'asj',
    label: 'Authentic Singing Journey',
    covers: 'Confirmation (ASJ / ASJ PRO) + the weekly session emails for everyone who holds the journey — standalone, in a bundle, or as an order bump; in Dutch (Authentiek Zingen) for the Dutch edition',
    drip: {
      today:
        'Workflow “prod_ASJ” subscribes every prod_ASJ buyer to the email series “prod_ASJ” (41 emails at 08:00 their time: Welcome, Discover the Additional Videos on day 3, then Week 2 … Week 40), every link pointing into Mighty Networks. The Dutch side (workflow and series “prod_JAZ”) is paused; whatever Dutch-edition buyers get now comes from a Drip Rule on prod_JAZ, which the API can’t read.',
      switchOff: [
        'In workflow “prod_ASJ”, set the “Subscribe to email series prod_ASJ” step to draft (keep its tag steps).',
        'Pause the email series “prod_ASJ” itself — everyone still in it would otherwise keep getting Mighty Networks links — then press “Bring in earlier buyers” on the weekly series below. Buyers from before the site took payments have no order here and have to be brought over from Drip.',
      ],
      keep: [
        'ASJ_start and the tag swap: the workflow removes prod_ASJ within seconds and leaves prod_ASJ_end, which is the lasting marker.',
      ],
    },
    together: ['journeys-bundle'],
  },
  {
    unit: 'mmj',
    label: 'Magical Movement Journey',
    covers: 'Confirmation',
    drip: {
      today: 'Workflow “prod_MMJ” (MMJ Welcome Email) is paused; the welcome buyers get now comes from a Drip Rule, which the API can’t read.',
      switchOff: ['The Drip Rule(s) that email MMJ buyers — to be listed from Automation → Rules.'],
    },
  },
  {
    unit: 'inner-child',
    label: 'Inner Child Healing Journey',
    covers: 'Confirmation',
    drip: {
      today: 'Workflow “prod_Inner Child” and its welcome series are paused; the welcome buyers get now (the “Your Songdance Program” mail) comes from a Drip Rule, which the API can’t read.',
      switchOff: ['The Drip Rule(s) that email Inner Child buyers — to be listed from Automation → Rules.'],
    },
  },
  {
    unit: 'journeys-bundle',
    label: 'The Three Journeys (bundle)',
    covers: 'Confirmation (bundle / bundle PRO)',
    drip: {
      today:
        'No workflow of its own: the bundle’s prod_ASJ tag starts the ASJ series (its Welcome and the weekly emails), and any Rules on prod_MMJ / prod_InnerChild / prod_SJB send their own mails.',
      switchOff: ['The ASJ steps above, and the Drip Rules on the bundle’s tags — to be listed from Automation → Rules.'],
    },
    together: ['asj'],
  },
];

// Drip automations that belong to no single switch but change when the CiRCLE
// replaces Mighty Networks. Shown under the switches on /admin/emails/courses.
export const DRIP_ELSEWHERE: Array<{ name: string; does: string; when: string }> = [
  {
    name: 'Workflow “Access to Products”',
    does: 'Sends “Your Songdance Products” / “Jouw Songdance Programma’s” — the Mighty Networks activation links — whenever the prod_access tag is applied, which is what /access → “Activate all my products” does (about 150 a year).',
    when: 'Pause it the day the CiRCLE goes live; the /access button changes on the site the same day.',
  },
  {
    name: 'Two Zapier webhooks (subscriber.applied_tag, April 2026)',
    does: 'Fire on every tag Drip applies and feed the Zapier automations behind the Mighty Networks access.',
    when: 'Jacob turns the Zapier automations off when the CiRCLE goes live.',
  },
  {
    name: 'Workflows “m25 | SVH Workshop” and “m26g | SVH Workshop”',
    does: 'The old workshop lifecycle (reminders, 12-week coupon, register again). The site never applies their tags or the svh_workshop event, so it doesn’t feed them; the site’s own workshop emails do this job.',
    when: 'Not tied to the app — they can be paused once nobody is left inside.',
  },
  {
    name: 'Email series “Join CEEE Monthly” (“Continue your journey”)',
    does: 'Tells a 12-week finisher their course has ended and offers the CEEE monthly membership — which the live pass (1, 3 or 6 months) has replaced. 96 people are in it; no workflow subscribes anyone, so it is fed from outside the workflows (most likely the HTTP post at the end of “prod_SVH_12w”, or a Rule). Its button, songdance.co/ceee-2026, now redirects to the live pass page.',
    when: 'Switch it off the day the 12-Week switch goes on: from then the site’s week-12 note offers the live pass.',
  },
  {
    name: '“CEEE Renewal / Registration”, “Songdeck Account Welcome”',
    does: 'CEEE membership renewal mail and the Songdeck account welcome — not course purchases on the site.',
    when: 'Stay in Drip for now.',
  },
];

// Units whose Drip side includes Rules nobody has listed yet (see the header).
export const RULES_PENDING: HandoverUnit[] = ['grief', 'asj', 'mmj', 'inner-child', 'journeys-bundle'];
export const RULES_NOTE = 'Drip Rules (Automation → Rules) send emails too, and no API can read them — so this column is incomplete until the rules are listed.';

// One line for the confirm dialog on the switch.
export function dripSwitchOffSummary(u: HandoverInfo): string {
  return u.drip.switchOff.length ? u.drip.switchOff.join(' ') : 'nothing — Drip sends nothing for this course today.';
}

const KEY_PREFIX = 'course_emails_on:';

export function isHandoverUnit(v: unknown): v is HandoverUnit {
  return typeof v === 'string' && HANDOVER_UNITS.some((u) => u.unit === v);
}

// Which switch decides a paid order's confirmation. Albums have their own
// delivery email (src/lib/music/delivery.ts) and no Drip version, so none.
export function confirmationUnitFor(slug: CourseRegistrationSlug | string): HandoverUnit | null {
  switch (slug) {
    case 'svh-12week':
      return 'twelve-week';
    case 'cc-cert':
      return 'certification';
    case 'cc-bundle':
      return 'path';
    case 'grief-course':
      return 'grief';
    case 'asj':
    case 'asj-pro':
      return 'asj';
    case 'mmj':
      return 'mmj';
    case 'inner-child':
      return 'inner-child';
    case 'journeys-bundle':
    case 'journeys-bundle-pro':
      return 'journeys-bundle';
    default:
      return isJourneySlug(slug) ? 'journeys-bundle' : null;
  }
}

// unit → the UTC time it was switched on ('YYYY-MM-DD HH:MM:SS'). A unit that
// is absent is off. Never throws: a read failure reads as "everything off",
// which is the safe direction (Drip keeps sending).
export async function loadHandover(db: D1Database): Promise<Map<HandoverUnit, string>> {
  const out = new Map<HandoverUnit, string>();
  try {
    const { results } = await db
      .prepare(`SELECT key, value FROM workshop_config WHERE key LIKE ?`)
      .bind(`${KEY_PREFIX}%`)
      .all<{ key: string; value: string }>();
    for (const r of results ?? []) {
      const unit = r.key.slice(KEY_PREFIX.length);
      if (isHandoverUnit(unit) && r.value) out.set(unit, r.value);
    }
  } catch {
    /* off */
  }
  return out;
}

export async function setHandover(db: D1Database, unit: HandoverUnit, on: boolean): Promise<void> {
  const key = `${KEY_PREFIX}${unit}`;
  if (on) {
    // Keep the original switch-on time if it is already on: re-pressing must
    // not move the line the retry sweep draws.
    await db
      .prepare(
        `INSERT INTO workshop_config (key, value) VALUES (?, datetime('now'))
         ON CONFLICT(key) DO NOTHING`,
      )
      .bind(key)
      .run();
  } else {
    await db.prepare(`DELETE FROM workshop_config WHERE key = ?`).bind(key).run();
  }
}
