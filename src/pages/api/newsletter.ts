import type { APIRoute } from 'astro';
import { upsertSubscriber } from '../../lib/registrations/drip';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Same Drip account the registration + lead-magnet flows write to.
const DRIP_ACCOUNT_ID = '7850773';

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Lightweight newsletter / "keep me in the loop" opt-in. Creates or updates a
// Drip subscriber and tags them so a source (e.g. the Forgiveness Course
// waitlist) can be segmented. This is a deliberate, user-initiated opt-in;
// Drip owns delivery + unsubscribe state from here.
export const POST: APIRoute = async ({ request, locals }) => {
  let body: { email?: string; first_name?: string; source?: string; hp?: string };
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: 'bad-json' });
  }

  // Honeypot: bots fill the hidden field. Accept silently so they move on.
  if (typeof body.hp === 'string' && body.hp.trim() !== '') {
    return json(200, { ok: true });
  }

  const email = (body.email ?? '').toString().trim().slice(0, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return json(400, { ok: false, error: 'bad-email' });
  }

  const firstName = (body.first_name ?? '').toString().slice(0, 80).trim() || undefined;
  const source = (body.source ?? '').toString().slice(0, 80).trim() || 'newsletter';

  const runtime = (
    locals as { runtime?: { env?: Record<string, string | undefined> } }
  ).runtime;
  const cfEnv = runtime?.env;
  const apiToken = cfEnv?.DRIP_API_TOKEN ?? import.meta.env.DRIP_API_TOKEN;
  if (!apiToken) {
    console.warn('[newsletter] missing DRIP_API_TOKEN');
    return json(500, { ok: false, error: 'no-token' });
  }

  const tags = ['Newsletter'];
  if (source === 'forgiveness-course') tags.push('Forgiveness Course waitlist');

  try {
    await upsertSubscriber(
      { apiToken, accountId: DRIP_ACCOUNT_ID },
      {
        email,
        first_name: firstName,
        tags,
        custom_fields: { newsletter_source: source },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[newsletter] drip upsert failed: ${msg}`);
    return json(502, { ok: false, error: 'upstream' });
  }

  return json(200, { ok: true });
};
