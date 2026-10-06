// Where a course lives: the Songdance CiRCLE app at circle.songdance.co.
//
// Every course, journey and live session a buyer gets is in the CiRCLE, and
// access is automatic after purchase — the app reads the order, so there is no
// plan link to click and nothing to activate. Every email the site sends about
// a course (src/lib/courses/emails/) links here, and nowhere else builds a
// CiRCLE URL — so when the app's routes settle, this file is the one place to
// change. (The old Mighty Networks plan/space links — /plans/<id>?bundle_token,
// /spaces/<id>/feed — are gone with it; none of them belong in an email.)
//
// Kept free of imports so email builders, pages and the cron can all use it.

export const CIRCLE_ORIGIN = 'https://circle.songdance.co';

// The CiRCLE home: the buyer's own courses, the community, the calendar.
export const CIRCLE_HOME_URL = CIRCLE_ORIGIN;

export type CircleArea =
  | 'twelve-week'
  | 'certification'
  | 'grief'
  | 'asj'
  | 'asj-mantra-pack'
  | 'mmj'
  | 'inner-child'
  | 'live'; // the calendar of live Q&As and deepening sessions + their replays

const AREA_PATHS: Record<CircleArea, string> = {
  'twelve-week': '/courses/12-week',
  certification: '/courses/certification',
  grief: '/courses/grief',
  asj: '/journeys/authentic-singing',
  'asj-mantra-pack': '/journeys/authentic-singing/mantra-pack',
  mmj: '/journeys/magical-movement',
  'inner-child': '/journeys/inner-child',
  live: '/live',
};

export function circleUrl(area?: CircleArea): string {
  return area ? `${CIRCLE_ORIGIN}${AREA_PATHS[area]}` : CIRCLE_HOME_URL;
}

// One session of the Authentic Singing Journey (1–40), so a weekly email opens
// on the week it is about.
export function circleAsjWeekUrl(week: number): string {
  return `${circleUrl('asj')}/week-${week}`;
}
