// POST { email } → email the monthly live pass's manage link to that address,
// if it has a monthly (running, or cancelled with its paid month still to run).
// The pass page's "Manage my monthly pass", for anyone who has lost the
// confirmation. The answer is the same whether or not a monthly was found, and
// the link only ever goes to the inbox on the order: stopping a subscription
// takes the inbox, not just the address.

import type { APIRoute } from 'astro';
import { LIVE_PASS_MONTHLY_SLUG } from '../../../lib/courses/live-pass';
import { sendLivePassManageLink } from '../../../lib/courses/live-pass-email';
import type { CourseRegistration } from '../../../lib/courses/db';

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

  const answer = {
    ok: true,
    message: 'If there is a monthly live pass under that address, the link to manage it is on its way there now.',
  };
  try {
    // Its latest monthly that took a payment; a link to one long ended still
    // says so in plain words and leads back to the pass page.
    const reg = await env.DB
      .prepare(
        `SELECT * FROM course_registrations
          WHERE product_slug = ? AND lower(email) = ? AND installments_paid > 0
          ORDER BY id DESC LIMIT 1`,
      )
      .bind(LIVE_PASS_MONTHLY_SLUG, email)
      .first<CourseRegistration>();
    if (!reg) return json(200, answer);
    // At most one a minute per order, so the button can't be used to flood an inbox.
    const claim = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id)
         VALUES (NULL, 'live_pass.monthly.manage_link', 'system', ?)`,
      )
      .bind(`live-pass-manage-link-${reg.id}-${new Date().toISOString().slice(0, 16)}`)
      .run();
    if ((claim.meta?.changes ?? 0) === 0) return json(200, answer);
    await sendLivePassManageLink(env, reg);
    return json(200, answer);
  } catch (err) {
    console.error('[live-pass] manage link not sent', String(err));
    return json(500, { error: 'We could not send the link just now. Please try again in a minute, or write to support@songdance.co.' });
  }
};
