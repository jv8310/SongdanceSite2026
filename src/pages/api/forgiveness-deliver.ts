import type { APIRoute } from 'astro';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBJECT = 'Your forgiveness prayer';
const DEFAULT_FROM = 'Songdance <prayer@site.songdance.co>';
const DEFAULT_REPLY_TO = 'jacob@songdance.co';
const LOGO_URL = 'https://site.songdance.co/brand/logo-wordmark-dark.png';
const HERO_IMAGE_URL = 'https://site.songdance.co/imagery/forgiveness/Heart%20%2B%20candle.jpeg';
const FORGIVENESS_URL = 'https://site.songdance.co/forgiveness';
const DRIP_ACCOUNT_ID = '7850773';

// The email HTML is rendered inline (rather than loaded via ?raw) so the
// {{PRAYER}} substitution can't be defeated by any bundler / loader
// quirk in Cloudflare Workers' build. A companion HTML reference for
// designers lives at email-templates/forgiveness-prayer.html.
function renderEmailHtml(prayerHtml: string): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <title>Your forgiveness prayer</title>
    <style type="text/css">
      body, table, td, p, a, h1, h2, h3 { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
      table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
      body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
      a { color: #A14826; text-decoration: none; }
      a:hover { text-decoration: underline; }
      @media screen and (max-width: 600px) {
        .container { width: 100% !important; }
        .px-outer { padding-left: 24px !important; padding-right: 24px !important; }
        .prayer   { font-size: 19px !important; line-height: 1.65 !important; }
        .h1       { font-size: 26px !important; line-height: 1.18 !important; }
      }
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:#F4ECDF; font-family: Georgia, 'Times New Roman', serif; color:#2A1B2A;">
    <div style="display:none; font-size:1px; color:#F4ECDF; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
      A few lines, shaped for what you brought.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4ECDF;">
      <tr>
        <td align="center" style="padding: 40px 16px;">
          <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="center" style="padding: 0 0 28px;">
                <a href="${FORGIVENESS_URL}" style="display:block;">
                  <img src="${HERO_IMAGE_URL}" alt="" width="560" style="display:block; width:100%; max-width:560px; height:auto; border:0;" />
                </a>
              </td>
            </tr>
            <tr>
              <td align="center" class="px-outer" style="padding: 8px 24px 8px;">
                <h1 class="h1" style="margin:0; font-family: Georgia, 'Times New Roman', serif; font-weight:400; font-size:30px; line-height:1.18; letter-spacing:-0.012em; color:#2A1B2A;">
                  Your forgiveness prayer
                </h1>
              </td>
            </tr>
            <tr>
              <td align="center" class="px-outer" style="padding: 14px 24px 8px;">
                <p style="margin:0; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size:15px; line-height:1.55; color:#4A3848; max-width:38ch;">
                  A few lines, shaped for what you brought. Return to it whenever you need to.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" class="px-outer" style="padding: 28px 24px 32px;">
                <p class="prayer" style="margin:0; font-family: Georgia, 'Times New Roman', serif; font-style:italic; font-size:20px; line-height:1.75; color:#2A1B2A; letter-spacing:0.005em; white-space: pre-line;">${prayerHtml}</p>
              </td>
            </tr>
            <tr>
              <td align="center" class="px-outer" style="padding: 12px 24px 8px;">
                <p style="margin:0; font-family: Georgia, 'Times New Roman', serif; font-size:14px; line-height:1.6; color:#4A3848; max-width: 42ch; margin-left:auto; margin-right:auto;">
                  If this opened something — the Forgiveness Course is the longer walk. Four live Sundays in July 2026. <a href="https://site.songdance.co/forgiveness" style="color:#A14826; text-decoration:underline;">Read more</a>.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 40px 24px 8px;">
                <a href="https://songdance.co" style="display:inline-block;">
                  <img src="${LOGO_URL}" alt="Songdance" width="110" style="display:block; width:110px; height:auto; opacity:0.55;" />
                </a>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 12px 24px 24px;">
                <p style="margin:0; font-family: Georgia, 'Times New Roman', serif; font-size:11px; line-height:1.6; color:#B6A8B4;">
                  You asked for a prayer; we sent one. No list, no follow-ups.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

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
    'If this opened something — the Forgiveness Course is the longer walk. Four live Sundays in July 2026.',
    'https://site.songdance.co/forgiveness',
    '',
    'Songdance',
    'https://songdance.co',
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
  const replyTo = cfEnv?.RESEND_REPLY_TO ?? import.meta.env.RESEND_REPLY_TO ?? DEFAULT_REPLY_TO;
  const dripToken = cfEnv?.DRIP_API_TOKEN ?? import.meta.env.DRIP_API_TOKEN;

  const prayerHtml = escapeHtml(prayer).replace(/\n/g, '<br/>');
  const html = renderEmailHtml(prayerHtml);
  const text = buildPlainText(prayer);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);

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
        reply_to: replyTo,
        subject: SUBJECT,
        html,
        text,
        // Transactional signals to keep Gmail from filing this under
        // Promotions. We never include an unsubscribe link (this is a
        // one-shot send, not a list), and we mark the message as
        // auto-generated so MTAs treat it as a notification.
        headers: {
          'Auto-Submitted': 'auto-generated',
          'X-Auto-Response-Suppress': 'All',
          'X-Entity-Ref-ID': `forgiveness-prayer-${Date.now()}`,
        },
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      // Pull a human-readable message out of the Resend error envelope so
      // we can surface it for diagnosis (domain not verified, rate limit,
      // invalid 'from', etc.) instead of just a status code.
      let detail = '';
      try {
        const parsed = JSON.parse(errText) as { message?: string; name?: string };
        detail = parsed?.message || parsed?.name || '';
      } catch {
        detail = errText.slice(0, 200);
      }
      console.warn(
        `[forgiveness-deliver] resend upstream ${upstream.status} from=${from}: ${errText.slice(0, 500)}`,
      );
      return json(502, {
        ok: false,
        error: 'upstream-' + upstream.status,
        detail: detail || undefined,
      });
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
