// POST { email, hp } → {
//   ok, email, first_name?,
//   sessions: [{ title, kind, when, url, status }],
//   circle: { has, products[] },
//   music: [{ title, url, cover }],
//   progress: { state, week, total_weeks, label, can_activate_cert } | null
// }
//
// The pre-purchase account lookup behind /access. Given an email we run two
// checks in parallel and merge them:
//   1. D1 — the email's secured (paid/comped) workshop + masterclass seats, so
//      we can deep-link straight to each one's countdown page. The countdown
//      URL is keyed on the per-registration access token, which only lives in
//      D1 (never in Drip), so this lookup is what makes "go to your countdown"
//      possible. Past live dates the person missed are kept too — their link
//      lands on the same page's "this session has passed" view, where they can
//      watch the replay or move onto a new date for free.
//   1b. D1 — their 12-week counter (src/lib/courses/week-progress.ts): which
//      week of the foundation course they're in, or "Ongoing Certification".
//      Someone inside weeks 1-12 who also holds the certification gets
//      `can_activate_cert`, which puts the "open it now" button on the page.
//   2. Drip — the subscriber's tags, to tell whether they hold any product that
//      lives in the Songdance CiRCLE (courses, journeys, the grief course, …).
//      Also grabs a first name to greet them. The same tag set decides which
//      gated music albums (src/lib/music/) the email holds — those come back in
//      `music`, each with its player link, and finding any also sets the signed
//      sd_music cookie so the linked player opens without asking again.
//
// Nothing here writes: it's a read-only "what do you have with us?" probe. The
// actual activation request stays on /api/access-products.

import type { APIRoute } from 'astro';
import { getSubscriber } from '../../lib/registrations/drip';
import { listCountdownLinksByEmail } from '../../lib/workshops/db';
import { workshopBumpTagsForEmail } from '../../lib/workshops/bump';
import { formatInTz } from '../../lib/workshops/time';
import { albumCoverUrl, albumUrl, listAlbumsForTags } from '../../lib/music/db';
import { listenerCookieHeader, signListener } from '../../lib/music/access';
import { describeWeekProgress, getWeekProgress } from '../../lib/courses/week-progress';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
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
  //    status: 'upcoming' (live date ahead), 'replay' (on-demand), or 'missed'
  //    (a past live date — the same page shows its replay + free rebook).
  let sessions: Array<{
    title: string;
    kind: 'Workshop' | 'Masterclass';
    when: string;
    url: string;
    status: 'upcoming' | 'replay' | 'missed';
  }> = [];
  try {
    const links = await listCountdownLinksByEmail(env.DB, email);
    sessions = links
      .map((l) => {
        const tz = l.timezone || l.display_tz || 'Europe/Brussels';
        const startMs = new Date(l.starts_at_utc).getTime();
        const status: 'upcoming' | 'replay' | 'missed' =
          l.is_replay === 1 ? 'replay' : startMs >= nowMs ? 'upcoming' : 'missed';
        return {
          title: l.title,
          kind: (l.is_masterclass === 1 ? 'Masterclass' : 'Workshop') as
            | 'Workshop'
            | 'Masterclass',
          when: status === 'replay' ? 'On demand — start anytime' : formatInTz(l.starts_at_utc, tz),
          url: `/workshop/success?t=${encodeURIComponent(l.access_token)}`,
          status,
          _sort: startMs,
        };
      })
      // Upcoming first (soonest → furthest), then on-demand replays, then the
      // missed dates (most recent first — the ones they're likeliest to revisit).
      .sort((a, b) => {
        const rank = { upcoming: 0, replay: 1, missed: 2 } as const;
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        return a.status === 'missed' ? b._sort - a._sort : a._sort - b._sort;
      })
      .map(({ _sort, ...s }) => s);
  } catch (err) {
    console.warn(`[access-lookup] countdown lookup failed: ${String(err)}`);
  }

  // 2. Drip subscriber → CiRCLE products + first name. Best-effort: if Drip is
  //    unreachable we simply report no products rather than failing the lookup.
  let circle = { has: false, products: [] as string[] };
  let firstName: string | undefined;
  let subscriberTags: string[] = [];
  if (env.DRIP_API_TOKEN && env.DRIP_ACCOUNT_ID) {
    try {
      const sub = await getSubscriber(
        { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID },
        email,
      );
      if (sub) {
        subscriberTags = sub.tags ?? [];
        circle = circleProductsFromTags(subscriberTags);
        firstName = sub.first_name || undefined;
      }
    } catch (err) {
      console.warn(`[access-lookup] drip lookup failed: ${String(err)}`);
    }
  }

  // 3. Gated music albums the tag set holds (src/lib/music/). Finding any also
  //    sets the signed listener cookie, so the player links open straight into
  //    the music instead of asking for the email a second time.
  //
  //    The tag set is Drip's PLUS the order-bump tags this email has actually
  //    paid for in D1 (workshopBumpTagsForEmail). Drip alone was a single point
  //    of failure: tagging on a paid registration is best-effort and never
  //    retried, so a buyer whose tag never landed saw no "Your music" block at
  //    all — for something they'd paid for. The local read settles it.
  let music: Array<{ title: string; url: string; cover: string | null }> = [];
  const extraHeaders: Record<string, string> = {};
  try {
    const localTags = await workshopBumpTagsForEmail(env.DB, email);
    const albums = await listAlbumsForTags(env.DB, [...subscriberTags, ...localTags]);
    music = albums.map((a) => ({ title: a.title, url: albumUrl(a), cover: albumCoverUrl(a) }));
    if (albums.length > 0) {
      extraHeaders['Set-Cookie'] = listenerCookieHeader(
        await signListener(env.ADMIN_SESSION_SECRET, email),
      );
    }
  } catch (err) {
    console.warn(`[access-lookup] music lookup failed: ${String(err)}`);
  }

  // 4. The 12-week counter. Read from D1, so it survives a Drip outage — and
  //    so does the activation offer beside it: owning the certification is
  //    settled by the `prod_SVH_9m` tag OR a paid cert/path order here.
  let progress: {
    state: string;
    week: number | null;
    total_weeks: number;
    label: string;
    can_activate_cert: boolean;
  } | null = null;
  try {
    const row = await getWeekProgress(env.DB, email);
    if (row) {
      const status = describeWeekProgress(row);
      const ownsCert =
        subscriberTags.includes('prod_SVH_9m') ||
        (await ownsCertificationLocally(env.DB, email));
      progress = {
        state: status.state,
        week: status.week,
        total_weeks: status.totalWeeks,
        label: status.label,
        can_activate_cert: status.inTwelveWeek && ownsCert,
      };
    }
  } catch (err) {
    console.warn(`[access-lookup] week progress lookup failed: ${String(err)}`);
  }

  return json(
    200,
    { ok: true, email, first_name: firstName, sessions, circle, music, progress },
    extraHeaders,
  );
};

// A paid certification / certification-path order under this address. The local
// half of "do they own the certification?" — see /api/courses/activate-now,
// which re-checks both halves before it moves anyone.
async function ownsCertificationLocally(
  db: D1Database,
  email: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM course_registrations
        WHERE LOWER(TRIM(email)) = ?
          AND product_slug IN ('cc-cert','cc-bundle')
          AND status = 'paid'
        LIMIT 1`,
    )
    .bind(email)
    .first<{ ok: number }>();
  return !!row;
}
