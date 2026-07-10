import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { runMetaAdSpendSync } from '../../../../lib/ads/meta-insights';

export const prerender = false;

// Manual "pull ad spend from Meta now" trigger for /admin/workshops/stats — the
// same sync the hourly cron runs, but forced (bypasses the once-a-day gate) so
// the owner can verify the token/account are wired and see today's spend land
// immediately. The scheduled cron keeps it fresh from then on.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const r = await runMetaAdSpendSync(env, { force: true });
    if (r.skipped && r.reason === 'not_configured') {
      return json(
        {
          error:
            'Meta ad-spend pull is not configured. Set META_AD_ACCOUNT_ID and an ads_read token (META_ADS_TOKEN) as secrets.',
        },
        400,
      );
    }
    return json(r);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
