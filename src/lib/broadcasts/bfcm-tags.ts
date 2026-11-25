// Black Friday to Cyber Monday 2026: the `bfcm:` tags on the contact list, so
// each of the sale's broadcasts reaches the people its offer is for and nobody
// who should not hear of it (Jacob, 25 Nov 2026). The sale itself is promo.ts.
//
// Who gets which email is decided by where a person stood WHEN THE SALE OPENED
// (LAUNCH_PROMO_STARTS_AT_MS), so nobody changes segment between the first
// notice and the last chance: someone who takes the half-price workshop seat on
// Friday is not then sent "half price on the courses" on Saturday. Whoever buys
// or registers during the sale gets `bfcm:bought` instead, which every one of
// its broadcasts excludes, so the reminders stop for them.
//
// One segment per person, the first that fits:
//
//   bfcm:cert        holds the certification course (site order, the path, the
//                    Drip-only holders, the CEEE cohort). No offer: they have
//                    everything the sale discounts, and many bought recently.
//   bfcm:recent      paid for a live pass in the 30 days before the sale. No
//                    offer: we do not tell someone who just paid the full price.
//   bfcm:12w-early   on the 12-week course, in its first 6 weeks when the sale
//                    opens: the certification course at half price.
//   bfcm:12w-late    on the 12-week course, week 7 to 12: the certification
//                    course at half price, or a live pass at 20% off.
//   bfcm:12w-ended   did the 12-week course, its 12 weeks are over (or it was
//                    bought before the site took payments, so no date): the
//                    same two offers.
//   bfcm:german      the German 12-week course or workshop only. No offer: the
//                    emails are in English and their certification price is its
//                    own (path.ts).
//   bfcm:workshop    registered for a workshop or a masterclass before the sale
//                    (a seat on the site, or the Drip years' workshop tags) and
//                    holds neither course: both courses at half price.
//
// Everyone above also carries `bfcm:known`. Whoever carries NO bfcm: tag never
// registered for a workshop or masterclass and holds neither course: that is
// the first segment (the workshop and the masterclass at half price), aimed as
// "the whole list, excluding bfcm:known and bfcm:bought". Buyers of the other
// courses only (Grief, the journeys, the old intro courses) are in it: the
// workshop is the right door for them too.
//
// The sync follows cert-tags.ts: everything under `bfcm:` is this module's — a
// tag it no longer computes comes off, nothing outside the prefix is touched;
// one D1 batch, diffed first, so steady state writes nothing. Only people who
// are already contacts are tagged (every registrant and buyer is mirrored onto
// the list). When: on the hourly cron until a week after the sale, and just
// before a broadcast that names a `bfcm:` tag is launched or refreshed
// (segment-refresh.ts). The tags stay on the list afterwards, for the record.

import { listCertAccess } from '../courses/cert-access';
import { listLegacyCertAccess } from '../courses/cert-access-legacy';
import { LAUNCH_PROMO_ENDS_AT_MS, LAUNCH_PROMO_STARTS_AT_MS } from '../promo';
import { logEventSafe } from '../registrations/db';

export const BFCM_TAG_PREFIX = 'bfcm:';
export const BFCM_KNOWN_TAG = 'bfcm:known';
export const BFCM_BOUGHT_TAG = 'bfcm:bought';
export const BFCM_SEGMENT_TAGS = {
  cert: 'bfcm:cert',
  recent: 'bfcm:recent',
  twelveEarly: 'bfcm:12w-early',
  twelveLate: 'bfcm:12w-late',
  twelveEnded: 'bfcm:12w-ended',
  german: 'bfcm:german',
  workshop: 'bfcm:workshop',
} as const;
export type BfcmSegment = keyof typeof BFCM_SEGMENT_TAGS;

// A live pass paid for within this many days before the sale = "recently".
export const BFCM_RECENT_DAYS = 30;
// The 12-week course: its live weeks, and the week from which the live pass is
// offered beside the certification course ("past week 6").
const TWELVE_WEEK_DAYS = 84;
const LATE_FROM_DAY = 42;
// The hourly sync stops a week after the sale closes.
const SYNC_UNTIL_MS = LAUNCH_PROMO_ENDS_AT_MS + 7 * 86400_000;

// The contact list's tags (lowercase there) that say "registered for a workshop
// or a masterclass" from the years Drip took the registrations, beside the
// site's own seats.
const WORKSHOP_TAGS = [
  'm25_svh_workshop',
  'm25_svh_workshop_replay',
  'm25_svh_workshop_again',
  'm26_svh_workshop',
  'm26_svh_masterclass',
  'svh_workshop_live',
  'svh_masterclass_live',
];
const TWELVE_WEEK_TAG = 'prod_svh_12w';
const CERT_TAGS = ['prod_svh_9m', 'prod_ceee-25'];
const GERMAN_TAGS = ['prodg_svh_12w', 'm26g_svh_workshop', 'm26g_svh_workshop_again'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHUNK = 400;
const clean = (e: string | null | undefined) => String(e ?? '').trim().toLowerCase();

export function usesBfcmTags(tags: Iterable<string>): boolean {
  for (const t of tags) if (t.startsWith(BFCM_TAG_PREFIX)) return true;
  return false;
}

// D1 stamps are UTC 'YYYY-MM-DD HH:MM:SS'.
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const stampMs = (s: string) => Date.parse(`${s.replace(' ', 'T').slice(0, 19)}Z`);

export type BfcmInput = {
  startMs: number; // the moment the sale opens
  cert: Iterable<string>; // holds the certification course
  recentPass: Iterable<string>; // paid for a live pass in the days before the sale
  // The 12-week course on its own: the moment of its latest paid order before
  // the sale, or null when only the Drip tag says so (bought before the site).
  twelveWeek: Iterable<[string, string | null]>;
  german: Iterable<string>;
  workshop: Iterable<string>; // a seat or a workshop tag from before the sale
  bought: Iterable<string>; // bought or registered since the sale opened
};

/** Pure: each known address's segment, and who bought during the sale. */
export function bfcmSegmentsFor(input: BfcmInput): Map<string, { segment: BfcmSegment | null; bought: boolean }> {
  const out = new Map<string, { segment: BfcmSegment | null; bought: boolean }>();
  const ok = (e: string) => EMAIL_RE.test(e) && e.length <= 254 && !e.endsWith('.invalid');
  // Lowest priority first: a later, stronger fact overwrites.
  const put = (emails: Iterable<string>, segment: BfcmSegment) => {
    for (const raw of emails) {
      const e = clean(raw);
      if (ok(e)) out.set(e, { segment, bought: false });
    }
  };
  put(input.workshop, 'workshop');
  put(input.german, 'german');
  for (const [raw, paidAt] of input.twelveWeek) {
    const e = clean(raw);
    if (!ok(e)) continue;
    let segment: BfcmSegment = 'twelveEnded';
    if (paidAt) {
      const days = Math.floor((input.startMs - stampMs(paidAt)) / 86400_000);
      if (days < LATE_FROM_DAY) segment = 'twelveEarly';
      else if (days < TWELVE_WEEK_DAYS) segment = 'twelveLate';
    }
    // Two orders on one address: the one that is furthest from over decides.
    const prev = out.get(e)?.segment;
    const rank = { twelveEnded: 0, twelveLate: 1, twelveEarly: 2 } as Record<string, number>;
    if (prev && prev in rank && rank[prev] > rank[segment]) continue;
    out.set(e, { segment, bought: false });
  }
  put(input.recentPass, 'recent');
  put(input.cert, 'cert');
  for (const raw of input.bought) {
    const e = clean(raw);
    if (!ok(e)) continue;
    const cur = out.get(e);
    if (cur) cur.bought = true;
    else out.set(e, { segment: null, bought: true });
  }
  return out;
}

function tagsOf(v: { segment: BfcmSegment | null; bought: boolean }): string[] {
  const tags: string[] = [];
  if (v.segment) tags.push(BFCM_KNOWN_TAG, BFCM_SEGMENT_TAGS[v.segment]);
  if (v.bought) tags.push(BFCM_BOUGHT_TAG);
  return tags;
}

async function emails(db: D1Database, sql: string, ...binds: unknown[]): Promise<string[]> {
  const r = await db.prepare(sql).bind(...binds).all<{ e: string }>();
  return (r.results ?? []).map((x) => x.e);
}

async function loadInput(db: D1Database): Promise<BfcmInput> {
  const startMs = LAUNCH_PROMO_STARTS_AT_MS;
  const start = stamp(startMs);
  const recentFrom = stamp(startMs - BFCM_RECENT_DAYS * 86400_000);
  const inList = (xs: string[]) => xs.map((x) => `'${x}'`).join(',');

  const site = await listCertAccess(db);
  const legacy = await listLegacyCertAccess(db, new Set(site.map((a) => clean(a.email))));
  const certTagged = await emails(db, `SELECT email AS e FROM contact_tags WHERE lower(tag) IN (${inList(CERT_TAGS)})`);

  const recentPass = await emails(
    db,
    `SELECT DISTINCT lower(trim(email)) AS e FROM course_registrations
      WHERE status = 'paid' AND (product_slug LIKE 'live-pass-%' OR product_slug = 'qa-plan-deepening')
        AND COALESCE(paid_at, created_at) >= ?1 AND COALESCE(paid_at, created_at) < ?2`,
    recentFrom,
    start,
  );

  // The 12-week course on its own (the path is a certification order): site
  // orders and the workshop ledger's course line, each with its moment; then
  // the Drip tag for the buyers from before the site, with none.
  const twelveWeek: Array<[string, string | null]> = [];
  const orders = await db
    .prepare(
      `SELECT lower(trim(email)) AS e, COALESCE(paid_at, created_at) AS at FROM course_registrations
        WHERE status = 'paid' AND product_slug = 'svh-12week' AND COALESCE(paid_at, created_at) < ?1`,
    )
    .bind(start)
    .all<{ e: string; at: string }>();
  for (const r of orders.results ?? []) twelveWeek.push([r.e, r.at]);
  const ledger = await db
    .prepare(
      `SELECT lower(trim(wr.email)) AS e, pur.created_at AS at
         FROM workshop_purchases pur
         JOIN workshop_registrations wr ON wr.id = pur.registration_id
         JOIN workshop_products p ON p.id = pur.product_id
        WHERE pur.product_type = 'course' AND p.slug = '12w-course'
          AND wr.payment_status IN ('paid','coupon') AND pur.created_at < ?1`,
    )
    .bind(start)
    .all<{ e: string; at: string }>()
    .catch(() => ({ results: [] as Array<{ e: string; at: string }> }));
  for (const r of ledger.results ?? []) twelveWeek.push([r.e, r.at]);
  // A course bought during the sale puts its Drip tag on the contact at once:
  // that tag must not read as "bought before the site".
  const twelveSince = new Set(
    (
      await emails(
        db,
        `SELECT DISTINCT lower(trim(email)) AS e FROM course_registrations
          WHERE status = 'paid' AND product_slug IN ('svh-12week','cc-bundle') AND COALESCE(paid_at, created_at) >= ?1`,
        start,
      )
    ).map(clean),
  );
  const dated = new Set(twelveWeek.map(([e]) => e));
  for (const e of await emails(db, `SELECT email AS e FROM contact_tags WHERE lower(tag) = '${TWELVE_WEEK_TAG}'`)) {
    if (!dated.has(clean(e)) && !twelveSince.has(clean(e))) twelveWeek.push([e, null]);
  }

  const german = await emails(db, `SELECT email AS e FROM contact_tags WHERE lower(tag) IN (${inList(GERMAN_TAGS)})`);

  const workshop = [
    ...(await emails(
      db,
      `SELECT DISTINCT lower(trim(email)) AS e FROM workshop_registrations
        WHERE payment_status IN ('paid','coupon') AND created_at < ?1`,
      start,
    )),
    ...(await emails(db, `SELECT email AS e FROM contact_tags WHERE lower(tag) IN (${inList(WORKSHOP_TAGS)})`)),
  ];

  const bought = [
    ...(await emails(
      db,
      `SELECT DISTINCT lower(trim(email)) AS e FROM workshop_registrations
        WHERE payment_status IN ('paid','coupon') AND created_at >= ?1`,
      start,
    )),
    ...(await emails(
      db,
      `SELECT DISTINCT lower(trim(email)) AS e FROM course_registrations
        WHERE status = 'paid' AND COALESCE(paid_at, created_at) >= ?1
          AND (product_slug IN ('svh-12week','cc-cert','cc-bundle') OR product_slug LIKE 'live-pass-%' OR product_slug = 'qa-plan-deepening')`,
      start,
    )),
  ];

  // Segments are as the sale opened, but listCertAccess and the tags read
  // today: whoever's only certification order is from during the sale is taken
  // out again and keeps the segment they had.
  const certOrders = async (cmp: '>=' | '<') =>
    new Set(
      (
        await emails(
          db,
          `SELECT DISTINCT lower(trim(email)) AS e FROM course_registrations
            WHERE status = 'paid' AND product_slug IN ('cc-cert','cc-bundle') AND COALESCE(paid_at, created_at) ${cmp} ?1`,
          start,
        )
      ).map(clean),
    );
  const certSince = await certOrders('>=');
  const certBefore = await certOrders('<');
  const cert = [...site.map((a) => a.email), ...legacy.map((a) => a.email), ...certTagged].filter((raw) => {
    const e = clean(raw);
    return !(certSince.has(e) && !certBefore.has(e));
  });

  return { startMs, cert, recentPass, twelveWeek, german, workshop, bought };
}

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}
const pairKey = (email: string, tag: string) => `${email}\u0000${tag}`;

export type BfcmTagSyncResult =
  | { ok: true; known: number; counts: Record<string, number>; added: number; removed: number }
  | { ok: false; error: string };

/** Compute the sale's `bfcm:` tags and write them onto the contact list. */
export async function syncBfcmTags(db: D1Database): Promise<BfcmTagSyncResult> {
  try {
    const want = bfcmSegmentsFor(await loadInput(db));
    if (want.size === 0) return { ok: false, error: 'Nobody was found for the bfcm: tags; they were left as they were.' };

    // Only contacts can carry a tag (and be mailed): one read of who is on the list.
    const onList = new Set<string>();
    for (const part of chunks([...want.keys()])) {
      const r = await db
        .prepare(`SELECT email FROM contacts WHERE email IN (SELECT value FROM json_each(?1))`)
        .bind(JSON.stringify(part))
        .all<{ email: string }>();
      for (const x of r.results ?? []) onList.add(x.email);
    }

    const current =
      (await db.prepare(`SELECT email, tag FROM contact_tags WHERE tag LIKE 'bfcm:%'`).all<{ email: string; tag: string }>()).results ?? [];
    const have = new Set(current.map((r) => pairKey(r.email, r.tag)));
    const wanted = new Set<string>();
    const added: Array<[string, string]> = [];
    const counts: Record<string, number> = {};
    for (const [email, v] of want) {
      if (!onList.has(email)) continue;
      for (const t of tagsOf(v)) {
        counts[t] = (counts[t] ?? 0) + 1;
        const k = pairKey(email, t);
        wanted.add(k);
        if (!have.has(k)) added.push([email, t]);
      }
    }
    const removed: Array<[string, string]> = current
      .filter((r) => !wanted.has(pairKey(r.email, r.tag)))
      .map((r) => [r.email, r.tag]);

    const statements: D1PreparedStatement[] = [];
    for (const part of chunks(removed)) {
      statements.push(
        db
          .prepare(
            `DELETE FROM contact_tags
              WHERE tag LIKE 'bfcm:%'
                AND (email, tag) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1))`,
          )
          .bind(JSON.stringify(part)),
      );
    }
    for (const part of chunks(added)) {
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO contact_tags (email, tag)
               SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1)`,
          )
          .bind(JSON.stringify(part)),
      );
    }
    const touched = [...new Set([...added, ...removed].map(([e]) => e))];
    for (const part of chunks(touched)) {
      statements.push(
        db
          .prepare(
            `UPDATE contacts
                SET tags = (SELECT group_concat(tag, ', ') FROM (SELECT tag FROM contact_tags t WHERE t.email = contacts.email ORDER BY tag)),
                    updated_at = datetime('now')
              WHERE email IN (SELECT value FROM json_each(?1))`,
          )
          .bind(JSON.stringify(part)),
      );
    }
    // D1 takes a batch as one transaction; a first run tags several thousand
    // contacts, so it goes in slices that each stay well inside its limits.
    for (let i = 0; i < statements.length; i += 20) await db.batch(statements.slice(i, i + 20));

    const result = { ok: true as const, known: counts[BFCM_KNOWN_TAG] ?? 0, counts, added: added.length, removed: removed.length };
    if (result.added || result.removed) {
      await logEventSafe(db, {
        registration_id: null,
        kind: 'broadcast.bfcm_tags.synced',
        source: 'system',
        payload: { counts, added: result.added, removed: result.removed },
      });
    }
    return result;
  } catch (err) {
    console.error('[broadcasts/bfcm-tags] sync failed', err);
    return { ok: false, error: String((err as Error)?.message ?? err).slice(0, 200) };
  }
}

/** The hourly cron's door: nothing once the sale is a week behind us. */
export async function syncBfcmTagsOnSchedule(db: D1Database, nowMs: number = Date.now()): Promise<BfcmTagSyncResult | null> {
  if (nowMs >= SYNC_UNTIL_MS) return null;
  return syncBfcmTags(db);
}
