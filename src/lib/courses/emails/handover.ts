// Drip → site, one course at a time.
//
// Every course email used to come from a Drip workflow fired by the purchase's
// Drip tag/event. The site now holds its own version of each (the words in
// ./confirmation-emails.ts and ./sequence-emails.ts), but while a Drip workflow
// is still live, sending ours too would mail every buyer twice. So each course
// has a switch, OFF by default: off → Drip keeps sending, the site sends
// nothing; on → the site sends, and the matching Drip workflow should be
// switched off in Drip the same day. Flipped on /admin/emails/courses.
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
  // The Drip side to switch off the same day.
  dripToStop: string;
};

export const HANDOVER_UNITS: HandoverInfo[] = [
  {
    unit: 'twelve-week',
    label: '12-Week Course',
    covers: 'Confirmation + the onboarding emails (day 1, day 2, week 2, week 6, week 12)',
    dripToStop: 'The 12-Week Course workflow (prod_SVH_12w): "Thank you for registering…", "See you in Q&A?", "How to pace yourself", "Welcome to Week 2/6"',
  },
  {
    unit: 'certification',
    label: 'Certification Course (on its own)',
    covers: 'Confirmation + two onboarding emails (day 1, day 2)',
    dripToStop: 'The certification welcome for prod_SVH_9m buyers',
  },
  {
    unit: 'path',
    label: '12-Week + Certification path',
    covers: 'Path confirmation + the 12-week onboarding + "your certification course is open" at week 12',
    dripToStop: 'The path workflow ("here\'s how the path unfolds", "Activate the Certification Course Now") and the 12-week workflow for path buyers',
  },
  {
    unit: 'grief',
    label: 'The Grief Course',
    covers: 'Confirmation',
    dripToStop: 'The Grief Course welcome (prod_Grief-sp)',
  },
  {
    unit: 'asj',
    label: 'Authentic Singing Journey',
    covers: 'Confirmation (ASJ / ASJ PRO) + the 40 weekly session emails for everyone who holds the journey — standalone, in a bundle, or as an order bump',
    dripToStop: 'The ASJ welcome and the weekly series ("Weekly sessions of the Year Course Authentic Singing", prod_ASJ)',
  },
  {
    unit: 'mmj',
    label: 'Magical Movement Journey',
    covers: 'Confirmation',
    dripToStop: 'The Magical Movement welcome (prod_MMJ)',
  },
  {
    unit: 'inner-child',
    label: 'Inner Child Healing Journey',
    covers: 'Confirmation',
    dripToStop: 'The Inner Child welcome (prod_InnerChild)',
  },
  {
    unit: 'journeys-bundle',
    label: 'The Three Journeys (bundle)',
    covers: 'Confirmation (bundle / bundle PRO)',
    dripToStop: 'The welcome emails Drip sends a bundle buyer for each journey',
  },
];

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
