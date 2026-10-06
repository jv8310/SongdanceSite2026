// GET /api/app/cert-window?email=… → the window to apply for certification for
// one address (src/lib/courses/cert-window.ts), for the SVH app
// (app.songdance.co → "Apply for Certification"), which asks it server to
// server. No secret: email is the credential in this system, and the live-pass
// page's own status call already answers the same for any address typed into it
// (the 12-week and certification gates do likewise from Drip).
//
// {
//   found,          // holds the certification course in some form
//   may_certify,    // false: the course without the right (CEEE 2025), no extension
//   ends_on,        // YYYY-MM-DD, the last day of the window (Brussels)
//   course_ends_on, // the course's own end, before any extension
//   extended_to,    // the last day of an extension, when it reaches further
//   open,           // may_certify and today ≤ ends_on
//   upgrade_url     // the live pass with the extension ticked, email prefilled
// }

import type { APIRoute } from 'astro';
import { certWindowForEmail } from '../../../lib/courses/cert-window';
import { LIVE_PASS_PAGE_PATH } from '../../../lib/courses/live-pass';

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
    const w = await certWindowForEmail(env.DB, email);
    const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
    return json(200, {
      found: w.holdsCourse,
      may_certify: w.mayCertify,
      ends_on: w.endsOn,
      course_ends_on: w.courseEndsOn,
      extended_to: w.extendedTo,
      open: w.open,
      upgrade_url: `${base}${LIVE_PASS_PAGE_PATH}?email=${encodeURIComponent(email)}&extend=1#get`,
    });
  } catch (err) {
    console.error('[cert-window] lookup failed', String(err));
    return json(500, { error: 'lookup-failed' });
  }
};
