// RFC 8058 one-click unsubscribe — the POST a mail client sends to the URL in a
// List-Unsubscribe header (body "List-Unsubscribe=One-Click", form-encoded, no
// Origin header, no UI).
//
// It is answered in src/worker-entrypoint.ts BEFORE the request reaches Astro:
// Astro's origin check (security.checkOrigin, on by default) answers 403 to any
// form-encoded POST whose Origin isn't the site's own, which is exactly what
// Gmail's one-click POST looks like — so the button in Gmail silently did
// nothing. src/pages/api/unsubscribe.ts runs the same function for `astro dev`
// and as a fallback.
//
// With `topic` (a broadcast that names one), the address leaves that topic only;
// without, it is unsubscribed from everything (email_suppressions + Drip). Any
// failure on the topic path falls back to the full unsubscribe: fail toward more
// opt-out, never toward more mail. An address already unsubscribed from
// everything gets no topic row (nothing to narrow, and an erased address must
// not get a row back).

import { unsubscribeEmail, unsubscribeSecret, verifyUnsubscribeToken, isEmailSuppressed } from './unsubscribe';
import { getTopic, optOutOfTopic, TOPIC_KEY_RE } from './topics';
import { logEventSafe } from '../registrations/db';

export type OneClickEnv = {
  DB: D1Database;
  UNSUBSCRIBE_SECRET?: string;
  ADMIN_SESSION_SECRET?: string;
  DRIP_API_TOKEN?: string;
  DRIP_ACCOUNT_ID?: string;
};

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function handleOneClickUnsubscribe(request: Request, env: OneClickEnv): Promise<Response> {
  const url = new URL(request.url);
  let email = (url.searchParams.get('e') ?? '').trim().toLowerCase();
  let token = (url.searchParams.get('t') ?? '').trim();
  let topic = (url.searchParams.get('topic') ?? '').trim();

  // Params live in the header URL's query string; tolerate clients that put
  // them in the (form-encoded) body instead.
  if (!email || !token) {
    try {
      const form = new URLSearchParams(await request.text());
      email = email || (form.get('e') ?? '').trim().toLowerCase();
      token = token || (form.get('t') ?? '').trim();
      topic = topic || (form.get('topic') ?? '').trim();
    } catch {
      // unreadable body — fall through to validation
    }
  }

  const secret = unsubscribeSecret(env);
  if (!secret || !(await verifyUnsubscribeToken(secret, email, token))) {
    return text('Invalid unsubscribe link.', 400);
  }

  if (topic && TOPIC_KEY_RE.test(topic)) {
    const t = await getTopic(env.DB, topic);
    if (t) {
      try {
        if (await isEmailSuppressed(env.DB, email)) return text('You are unsubscribed.');
        await optOutOfTopic(env.DB, email, t.key, 'one_click');
        await logEventSafe(env.DB, {
          registration_id: null,
          kind: 'email.preferences.one_click',
          source: 'web',
          payload: { email, left: [t.key] },
        });
        return text(`You won't get “${t.name}” emails any more.`);
      } catch {
        // fall through to the full unsubscribe
      }
    }
  }

  await unsubscribeEmail(env, email, 'one_click');
  return text('You are unsubscribed.');
}
