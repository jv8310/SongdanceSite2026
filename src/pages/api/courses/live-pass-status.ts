// POST { email } → what a live pass bought today would look like for this
// address: each length's dates, whether the certification-window add-on would
// buy anything, and their certification window as it stands. The live-pass page
// asks once the email is known (typed, or ?email= from the member app / the SVH
// app). Email is the credential here, as on /access and the course gates; the
// answer is only ever dates about the address that was typed.

import type { APIRoute } from 'astro';
import { planLivePass } from '../../../lib/courses/live-pass-plan';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return json(400, { error: 'bad-json' });
  }
  const email = String(body.email ?? '').trim().slice(0, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return json(400, { error: 'Please enter a valid email address.' });

  try {
    const plan = await planLivePass(env.DB, email);
    return json(200, {
      email,
      live_until: plan.liveUntil,
      periods: plan.periods,
      certification: {
        holds_course: plan.window.holdsCourse,
        may_certify: plan.window.mayCertify,
        ends_on: plan.window.endsOn,
        open: plan.window.open,
      },
    });
  } catch (err) {
    console.error('[live-pass] status failed', String(err));
    return json(500, { error: 'Could not look this address up right now.' });
  }
};
