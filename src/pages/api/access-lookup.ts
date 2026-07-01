// POST { email, hp } → {
//   ok, email, first_name?,
//   sessions: [{ title, kind, when, url, replay }],
//   circle: { has, products[] }
// }
//
// The pre-purchase account lookup behind /access. Given an email we run two
// checks in parallel and merge them:
//   1. D1 — the email's secured (paid/comped) workshop + masterclass seats, so
//      we can deep-link straight to each one's countdown page. The countdown
//      URL is keyed on the per-registration access token, which only lives in
//      D1 (never in Drip), so this lookup is what makes "go to your countdown"
//      possible.
//   2. Drip — the subscriber's tags, to tell whether they hold any product that
//      lives in the Songdance CiRCLE (courses, journeys, the grief course, …).
//      Also grabs a first name to greet them.
//
// Nothing here writes: it's a read-only "what do you have with us?" probe. The
// actual activation request stays on /api/access-products.

import type { APIRoute } from 'astro';
import { getSubscriber } from '../../lib/registrations/drip';
import { listCountdownLinksByEmail } from '../../lib/workshops/db';
import { formatInTz } from '../../lib/workshops/time';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Tags that mean "owns something that lives in the Songdance CiRCLE" → a nice
// display name. Any other `prod_*` tag (or a legacy VSH training tag) still
// counts as a CiRCLE product for the `has` flag, just without a named line.
// `prod_access` is the activation-request marker, not a product — excluded.
const CIRCLE_PRODUCT_LABELS: Record<string, string> = {
  prod_SVH_9m: 'SVH Certification Course',
  prod_SVH_12w: '12-Week SVH Foundation Course',
  prod_ASJ: 'The Authentic Singing Journey',
  prod_JAZ: 'The Authentic Singing Journey',
  prod_ASJ_PRO: 'ASJ PRO — mantra pack',
  prod_JAZ_PRO: 'ASJ PRO — mantra pack',
  prod_MMJ: 'The Magical Movement Journey',
  prod_InnerChild: 'Inner Child Healing Journey',
  'prod_Grief-sp': 'The Grief Course',
};

function circleProductsFromTags(tags: string[]): { has: boolean; products: string[] } {
  const names = new Set<string>();
  let has = false;
  for (const raw of tags) {
    const t = (raw ?? '').trim();
    if (!t || t === 'prod_access') continue;
    const isProduct = t.startsWith('prod_') || t.toLowerCase().includes('vsh');
    if (!isProduct) continue;
    has = true;
    const label = CIRCLE_PRODUCT_LABELS[t];
    if (label) names.add(label);
  }
  return { has, products: [...names] };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  let body: { email?: string; hp?: string };
  try {
    body = (await request.json()) as { email?: string; hp?: string };
  } catch {
    return json(400, { ok: false, error: 'bad-json' });
  }

  // Honeypot: bots fill the hidden field. Return an empty (but ok) result so
  // they get nothing and move on.
  if (typeof body.hp === 'string' && body.hp.trim() !== '') {
    return json(200, { ok: true, email: '', sessions: [], circle: { has: false, products: [] } });
  }

  const email = (body.email ?? '').toString().trim().slice(0, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return json(400, { ok: false, error: 'bad-email' });
  }

  const nowMs = Date.now();

  // 1. Workshop / masterclass countdown links (D1). Never let this fail the
  //    whole lookup — an empty list just means "no live sessions".
  let sessions: Array<{
    title: string;
    kind: 'Workshop' | 'Masterclass';
    when: string;
    url: string;
    replay: boolean;
  }> = [];
  try {
    const links = await listCountdownLinksByEmail(env.DB, email);
    sessions = links
      // Keep sessions that still have a live countdown: anything upcoming, plus
      // on-demand replays (always watchable). A past live date without a replay
      // has no countdown to send them to.
      .filter((l) => l.is_replay === 1 || new Date(l.starts_at_utc).getTime() >= nowMs)
      .map((l) => {
        const tz = l.timezone || l.display_tz || 'Europe/Brussels';
        return {
          title: l.title,
          kind: (l.is_masterclass === 1 ? 'Masterclass' : 'Workshop') as
            | 'Workshop'
            | 'Masterclass',
          when: l.is_replay === 1 ? 'On demand — start anytime' : formatInTz(l.starts_at_utc, tz),
          url: `/workshop/success?t=${encodeURIComponent(l.access_token)}`,
          replay: l.is_replay === 1,
        };
      });
  } catch (err) {
    console.warn(`[access-lookup] countdown lookup failed: ${String(err)}`);
  }

  // 2. Drip subscriber → CiRCLE products + first name. Best-effort: if Drip is
  //    unreachable we simply report no products rather than failing the lookup.
  let circle = { has: false, products: [] as string[] };
  let firstName: string | undefined;
  if (env.DRIP_API_TOKEN && env.DRIP_ACCOUNT_ID) {
    try {
      const sub = await getSubscriber(
        { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID },
        email,
      );
      if (sub) {
        circle = circleProductsFromTags(sub.tags ?? []);
        firstName = sub.first_name || undefined;
      }
    } catch (err) {
      console.warn(`[access-lookup] drip lookup failed: ${String(err)}`);
    }
  }

  return json(200, { ok: true, email, first_name: firstName, sessions, circle });
};
