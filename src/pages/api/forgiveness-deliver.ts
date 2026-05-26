import type { APIRoute } from 'astro';
import templateHtml from '../../../email-templates/forgiveness-prayer.html?raw';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBJECT = 'Your forgiveness prayer';
const DEFAULT_FROM = 'Songdance <prayer@site.songdance.co>';
const DRIP_ACCOUNT_ID = '7850773';

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPlainText(prayer: string): string {
  return [
    'Your forgiveness prayer',
    '',
    'A few lines, shaped for what you brought. Return to it whenever you need to.',
    '',
    prayer,
    '',
    '—',
    '',
    'The Forgiveness Course is the longer walk — 26 minutes a day for one season, with sound and guidance.',
    'https://site.songdance.co/forgiveness',
    '',
    'Songdance · site.songdance.co',
  ].join('\n');
}

// Side-write to Drip so the audit trail / list growth survives the move
// off Drip-as-mailer. The actual prayer is now sent via Resend; this call
// only records the subscriber + tag + custom fields. Errors are logged
// but never block the user — the Resend send already succeeded.
async function recordInDrip(args: {
  token: string;
  email: string;
  prayer: string;
  situation: string;
  relationship: string;
}): Promise<void> {
  const { token, email, prayer, situation, relationship } = args;
  const auth = 'Basic ' + btoa(`${token}:`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
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
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(
        `[forgiveness-deliver] drip side-write ${res.status}: ${errText.slice(0, 300)}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[forgiveness-deliver] drip side-write error: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

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

  const situation = (body.situation ?? '').toString().slice(0, 600).trim();
  const relationship = (body.relationship ?? '').toString().slice(0, 80).trim();
  const prayer = (body.prayer ?? '').toString().slice(0, 4000).trim();
  if (!prayer) {
    return json(400, { ok: false, error: 'missing-prayer' });
  }

  const runtime = (
    locals as {
      runtime?: {
        env?: Record<string, string | undefined>;
        ctx?: { waitUntil?: (p: Promise<unknown>) => void };
      };
    }
  ).runtime;
  const cfEnv = runtime?.env;
  const apiKey = cfEnv?.RESEND_API_KEY ?? import.meta.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[forgiveness-deliver] missing RESEND_API_KEY');
    return json(500, { ok: false, error: 'no-token' });
  }
  const from = cfEnv?.RESEND_FROM ?? import.meta.env.RESEND_FROM ?? DEFAULT_FROM;
  const dripToken = cfEnv?.DRIP_API_TOKEN ?? import.meta.env.DRIP_API_TOKEN;

  const prayerHtml = escapeHtml(prayer).replace(/\n/g, '<br/>');
  const html = templateHtml.replace('{{PRAYER_HTML}}', prayerHtml);
  const text = buildPlainText(prayer);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

  try {
    const upstream = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: SUBJECT,
        html,
        text,
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      console.warn(
        `[forgiveness-deliver] resend upstream ${upstream.status}: ${errText.slice(0, 300)}`,
      );
      return json(502, { ok: false, error: 'upstream-' + upstream.status });
    }

    // Fire-and-forget the Drip side-write. waitUntil keeps the worker alive
    // long enough to finish it after the response goes out; if ctx isn't
    // available (local dev), we just drop the promise — failure is logged
    // and never affects the user-facing send.
    if (dripToken) {
      const dripPromise = recordInDrip({
        token: dripToken,
        email,
        prayer,
        situation,
        relationship,
      });
      if (runtime?.ctx?.waitUntil) {
        runtime.ctx.waitUntil(dripPromise);
      } else {
        dripPromise.catch(() => {});
      }
    } else {
      console.warn('[forgiveness-deliver] DRIP_API_TOKEN missing — skipping side-write');
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
