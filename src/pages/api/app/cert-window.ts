// GET /api/app/cert-window?email=… → the window to apply for certification for
// one address (src/lib/courses/cert-window.ts), for the SVH app
// (app.songdance.co), which asks it server to server. No secret: email is the
// credential in this system, and the live-pass page's own status call already
// answers the same for any address typed into it (the 12-week and certification
// gates do likewise from Drip).
//
// The same answer decides who may use the SVH app at all (October 2026 — it
// replaced the whitelist Drip kept by tag): anyone holding the certification
// course, until `ends_on` (the course's end, or a later certification-window
// extension bought with a live pass). The app turns everyone else away with a
// way on: a 12-week student to the certification course
// (`certification_url`), a student whose time has run out to the live pass
// with the extension ticked (`upgrade_url`).
//
// {
//   found,             // holds the certification course in some form
//   may_certify,       // false: the course without the right (CEEE 2025), no extension
//   ends_on,           // YYYY-MM-DD, the last day of the window (Brussels)
//   course_ends_on,    // the course's own end, before any extension
//   extended_to,       // the last day of an extension, when it reaches further
//   open,              // may_certify and today ≤ ends_on
//   app_access,        // found and today ≤ ends_on: may use the SVH app
//   twelve_week,       // holds the 12-week course
//   upgrade_url,       // the live pass with the extension ticked, email prefilled
//   certification_url  // the certification course, email prefilled
// }

import type { APIRoute } from 'astro';
import { certWindowForEmail } from '../../../lib/courses/cert-window';
import { LIVE_PASS_PAGE_PATH } from '../../../lib/courses/live-pass';
import { loadTwelveWeek } from '../../../lib/courses/live-pass-plan';
import { brusselsToday } from '../../../lib/workshops/periods';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;
  const email = (url.searchParams.get('email') ?? '').trim().slice(0, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return json(400, { error: 'bad-email' });

  try {
    const today = brusselsToday();
    const [w, twelveWeek] = await Promise.all([certWindowForEmail(env.DB, email, today), loadTwelveWeek(env.DB, email, today)]);
    const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
    const q = encodeURIComponent(email);
    return json(200, {
      found: w.holdsCourse,
      may_certify: w.mayCertify,
      ends_on: w.endsOn,
      course_ends_on: w.courseEndsOn,
      extended_to: w.extendedTo,
      open: w.open,
      app_access: w.holdsCourse && (!w.endsOn || today <= w.endsOn),
      twelve_week: twelveWeek.holds,
      upgrade_url: `${base}${LIVE_PASS_PAGE_PATH}?email=${q}&extend=1#get`,
      certification_url: `${base}/courses/certification?email=${q}`,
    });
  } catch (err) {
    console.error('[cert-window] lookup failed', String(err));
    return json(500, { error: 'lookup-failed' });
  }
};
