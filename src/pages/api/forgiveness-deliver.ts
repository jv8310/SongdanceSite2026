import type { APIRoute } from 'astro';

export const prerender = false;

const DRIP_ACCOUNT_ID = '7850773';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request, locals }) => {
  let body: {
    email?: string;
    situation?: string;
    relationship?: string;
    prayer?: string;
    hp?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: 'bad-json' });
  }

  if (typeof body.hp === 'string' && body.hp.trim() !== '') {
    return json(200, { ok: true });
  }

  const email = (body.email ?? '').toString().trim().slice(0, 254);
  if (!EMAIL_RE.test(email)) {
    return json(400, { ok: false, error: 'bad-email' });
  }

  // Custom field names stay as the v1 names so the existing Drip workflow
  // and email template (which references {{ subscriber.custom_fields.forgiveness_mantra }})
  // continue to fire without reconfiguration.
  const situation = (body.situation ?? '').toString().slice(0, 600).trim();
  const relationship = (body.relationship ?? '').toString().slice(0, 80).trim();
  const prayer = (body.prayer ?? '').toString().slice(0, 4000);

  const cfEnv = (locals as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
  const token = cfEnv?.DRIP_API_TOKEN ?? import.meta.env.DRIP_API_TOKEN;
  if (!token) {
    console.warn('[forgiveness-deliver] missing DRIP_API_TOKEN');
    return json(500, { ok: false, error: 'no-token' });
  }

  const auth = 'Basic ' + btoa(`${token}:`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

  try {
    const upstream = await fetch(
      `https://api.getdrip.com/v2/${DRIP_ACCOUNT_ID}/subscribers`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.api+json',
          Authorization: auth,
          'User-Agent': 'songdance-site (forgiveness-magnet)',
        },
        body: JSON.stringify({
          subscribers: [
            {
              email,
              tags: ['m26_Forgiveness'],
              custom_fields: {
                forgiveness_mantra: prayer,
                forgiveness_other_word: situation,
                forgiveness_self_word: relationship,
              },
            },
          ],
        }),
        signal: controller.signal,
      },
    );

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      console.warn(
        `[forgiveness-deliver] drip upstream ${upstream.status}: ${errText.slice(0, 300)}`,
      );
      return json(502, { ok: false, error: 'upstream-' + upstream.status });
    }

    return json(200, { ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[forgiveness-deliver] error: ${msg}`);
    return json(504, {
      ok: false,
      error: msg.includes('abort') ? 'timeout' : 'fetch-error',
    });
  } finally {
    clearTimeout(timer);
  }
};
