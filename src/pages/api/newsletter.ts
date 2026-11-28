import type { APIRoute } from 'astro';
import { upsertSubscriber } from '../../lib/registrations/drip';
import { writeContactTags } from '../../lib/contacts/mirror';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Same Drip account the registration + lead-magnet flows write to.
const DRIP_ACCOUNT_ID = '7850773';

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Lightweight newsletter / "keep me in the loop" opt-in. Writes the address
// onto the site's contact list with a tag per source (e.g. the Forgiveness
// Course waitlist), so broadcasts can reach and segment it; Drip gets the same
// while it is still connected. A deliberate, user-initiated opt-in.
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

  const cfEnv = locals.runtime?.env;
  const db = cfEnv?.DB;
  if (!db) return json(500, { ok: false, error: 'no-db' });

  const tags = ['Newsletter'];
  if (source === 'forgiveness-course') tags.push('Forgiveness Course waitlist');

  // The contact list is where the sign-up lives (broadcasts go from there). A
  // do-not-mail row is left as it is: lifting one takes the admin's Resubscribe.
  try {
    await writeContactTags(db, { email, name: firstName ?? null, tags, source: 'newsletter', markInDrip: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[newsletter] contact write failed: ${msg}`);
    return json(502, { ok: false, error: 'upstream' });
  }

  // Drip too, while it is connected. Best-effort: the sign-up already stands.
  const apiToken = cfEnv?.DRIP_API_TOKEN ?? import.meta.env.DRIP_API_TOKEN;
  if (apiToken) {
    try {
      await upsertSubscriber(
        { apiToken, accountId: cfEnv?.DRIP_ACCOUNT_ID || DRIP_ACCOUNT_ID },
        {
          email,
          first_name: firstName,
          tags,
          custom_fields: { newsletter_source: source },
        },
      );
    } catch (err) {
      console.warn(`[newsletter] drip upsert failed: ${String(err)}`);
    }
  }

  return json(200, { ok: true });
};
