import type { APIRoute } from 'astro';
import {
  normalizeSignupEmail,
  normalizeSignupPage,
  recordNewsletterSignup,
} from '../../lib/contacts/newsletter';

export const prerender = false;

// POST /api/newsletter — the newsletter signup ("Stay in touch" in the footer of
// every SiteLayout page, NewsletterFooter.astro). Writes the address onto the
// site's own contacts list (tag `newsletter`, the signup recorded in `custom`),
// which feeds broadcasts and /admin/people — see src/lib/contacts/newsletter.ts.
// It no longer writes to Drip.
//
// Body: JSON { email, first_name?, source?, page?, hp? } from the footer's
// script, or the same fields form-encoded when the browser runs no script —
// then the answer is a 303 back to the page the form was on.
//
// `hp` is a honeypot the form hides from people: a bot that fills it is told
// "ok" and nothing is written.

type Body = { email?: unknown; first_name?: unknown; source?: unknown; page?: unknown; hp?: unknown };

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request, locals, url }) => {
  // Same-site only: a page elsewhere must not be able to sign addresses up by
  // posting a form at us. (A request with no Origin — a script, an old
  // browser — is let through; the honeypot and the email check still apply.)
  const origin = request.headers.get('origin');
  if (origin) {
    let sameSite = false;
    try {
      sameSite = new URL(origin).host === url.host;
    } catch {
      sameSite = false;
    }
    if (!sameSite) return json(403, { ok: false, error: 'origin' });
  }

  const type = request.headers.get('content-type') ?? '';
  const isForm =
    type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data');

  let body: Body;
  try {
    if (isForm) {
      const form = await request.formData();
      body = Object.fromEntries(
        ['email', 'first_name', 'source', 'page', 'hp'].map((k) => [k, form.get(k)?.toString()]),
      );
    } else {
      body = (await request.json()) as Body;
    }
  } catch {
    return json(400, { ok: false, error: 'bad-body' });
  }

  // A no-script post goes back to the page it came from (the footer sits at
  // #newsletter); a script gets JSON.
  const page = normalizeSignupPage(body.page);
  const back = (state: 'thanks' | 'check' | 'error') =>
    new Response(null, {
      status: 303,
      headers: { Location: `${page ?? '/'}?newsletter=${state}#newsletter`, 'Cache-Control': 'no-store' },
    });

  if (typeof body.hp === 'string' && body.hp.trim() !== '') {
    return isForm ? back('thanks') : json(200, { ok: true });
  }

  const email = normalizeSignupEmail(body.email);
  if (!email) return isForm ? back('check') : json(400, { ok: false, error: 'bad-email' });

  try {
    await recordNewsletterSignup(locals.runtime.env.DB, {
      email,
      firstName: typeof body.first_name === 'string' ? body.first_name : null,
      source: typeof body.source === 'string' ? body.source : null,
      page,
    });
  } catch (err) {
    console.error(`[newsletter] signup failed: ${String(err)}`);
    return isForm ? back('error') : json(500, { ok: false, error: 'server' });
  }

  return isForm ? back('thanks') : json(200, { ok: true });
};
