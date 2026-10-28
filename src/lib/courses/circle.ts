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
// The paths below are the app's own routes (songdance-app, apps/app/src/app),
// checked against it in October 2026: a course is /course/<course key> — the
// key IS the product key that unlocks it (svh-12week, cc-cert, grief-course,
// forgiveness-course, asj, jaz, mantra-pack, mmj, inner-child) — a lesson is /lesson/<lesson id>,
// and the live calendar is the Events tab, /events. Mind the near misses: the
// app sends Mighty's old /courses/* to the library, and /live or /journeys/…
// are "Not found". A signed-out visitor is signed in first, then lands on the
// page the link named.
//
// Until the app goes live, circle.songdance.co IS the Mighty Networks
// community, and every Drip email links into it (the ASJ series to
// /posts/<N>-<slug>, /spaces/<id>/content). The app redirects those old
// addresses itself (apps/app/public/_redirects → GET /mighty/*), so the links
// in old inboxes keep working after the cutover.
//
// Kept free of imports so email builders, pages and the cron can all use it.

export const CIRCLE_ORIGIN = 'https://circle.songdance.co';

// The CiRCLE home: the buyer's own courses, the community, the calendar.
export const CIRCLE_HOME_URL = CIRCLE_ORIGIN;

export type CircleArea =
  | 'twelve-week'
  | 'certification'
  | 'grief'
  | 'forgiveness'
  | 'asj'
  | 'asj-nl' // the Dutch edition, Authentiek Zingen
  | 'asj-mantra-pack'
  | 'mmj'
  | 'inner-child'
  | 'live'; // the calendar of live Q&As and deepening sessions + their replays

const AREA_PATHS: Record<CircleArea, string> = {
  'twelve-week': '/course/svh-12week',
  certification: '/course/cc-cert',
  grief: '/course/grief-course',
  forgiveness: '/course/forgiveness-course',
  asj: '/course/asj',
  'asj-nl': '/course/jaz',
  'asj-mantra-pack': '/course/mantra-pack',
  mmj: '/course/mmj',
  'inner-child': '/course/inner-child',
  live: '/events',
};

export function circleUrl(area?: CircleArea): string {
  return area ? `${CIRCLE_ORIGIN}${AREA_PATHS[area]}` : CIRCLE_HOME_URL;
}

// Any course by its key — for the courses that come and go with what the site
// sells, like a music album the app plays (src/lib/music/in-app.ts), so this
// list of areas need not grow with them.
export function circleCourseUrl(courseKey: string): string {
  return `${CIRCLE_ORIGIN}/course/${encodeURIComponent(courseKey)}`;
}

// One session of the Authentic Singing Journey (1–40), so a weekly email opens
// on the week it is about — in the English edition, or the Dutch one
// (Authentiek Zingen). Week N is lesson asj-lNN / jaz-lNN in the app (asj-l00
// is the introductory session, before week 1).
export function circleAsjWeekUrl(week: number, lang: 'en' | 'nl' = 'en'): string {
  const n = String(Math.max(1, Math.min(40, Math.trunc(week)))).padStart(2, '0');
  return `${CIRCLE_ORIGIN}/lesson/${lang === 'nl' ? 'jaz' : 'asj'}-l${n}`;
}
