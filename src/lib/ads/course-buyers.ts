// New customers vs returning ones among course buyers (November 2026): the
// split in the Forgiveness box (forgiveness-report.ts) and in the SD-REPORT
// emails (stats.ts computeCourseCustomerMix).
//
// A buyer is RETURNING when, before this order was paid, they had already
// bought from Songdance. Two sources say so:
//
//   1. songdance.co — an earlier order under the same address that took money:
//      a course / pass / album / session row, a course line in the workshop
//      ledger, a paid retreat booking.
//   2. Drip — a product tag (prod_…, prodG_…, client, klant) that no order on
//      the site explains: they bought before the site took payments. Read from
//      Drip itself and from the contact list, which holds the Drip export of
//      the people since removed from Drip (their old tags live only there).
//      The site pushes a tag to both for every order it takes, so the tags of
//      this buyer's own site orders (this order, anything later, a workshop
//      order bump) are taken out first; what is left came from somewhere else.
//
// A WORKSHOP OR MASTERCLASS SEAT is the front door, not a purchase history
// (Jacob, 25 Nov 2026): someone who only ever registered for a workshop and
// now buys the 12-week course is a NEW customer. The one exception is the
// Forgiveness Course, which is sold to the list rather than out of a workshop:
// there an earlier paid seat does make the buyer returning (`seatsCount`).
//
// Everyone else is NEW. Of those, `onList` marks who was already on the email
// list a day or more before the order (a Drip subscriber, or a contact row) —
// a new customer, but not a stranger.
//
// Without Drip connected (DRIP_API_TOKEN removed, or DRIP_READS = off) the
// contact list is the whole answer: the daily copy keeps every Drip subscriber
// there, unsubscribed ones included, with their tags and first-seen date.
//
// Drip is asked once per order and the answer kept in `events`
// (`course-buyer-drip-<order id>`), so no page or report calls Drip twice for
// an order. An order Drip could not be read for is classified on the rest and
// counted in `dripUnread`; the next read tries again.

import { getSubscriber, type DripConfig } from '../registrations/drip';
import { logEventSafe } from '../registrations/db';
import { courseDripTags } from '../courses/drip-tags';
import { albumIdFromProductSlug, isAlbumProductSlug } from '../music/product';
import type { JourneyLanguageChoice } from '../courses/journeys';
import { FORGIVENESS_PRODUCT_SLUG } from '../courses/forgiveness';

export type BuyerVerdict = {
  kind: 'new' | 'returning';
  // What made them returning: an earlier order on the site, or only Drip's tags.
  via: 'site' | 'drip' | null;
  // New customers only: already on the email list a day or more before.
  onList: boolean;
};

export type BuyerOrder = { id: number; email: string; paidAt: string; productSlug: string };

// Whether an earlier paid workshop / masterclass seat makes this order's buyer
// a returning customer: only for the Forgiveness Course.
export const seatsCountFor = (productSlug: string) => productSlug === FORGIVENESS_PRODUCT_SLUG;

const DRIP_CACHE_KIND = 'course.buyer.drip';
const DRIP_CACHE_PREFIX = 'course-buyer-drip-';
const dripCacheId = (orderId: number) => `${DRIP_CACHE_PREFIX}${orderId}`;
// Drip lookups per call (ten at a time, 8s each at the outside).
const MAX_DRIP_LOOKUPS = 30;
const DRIP_PARALLEL = 10;
const ON_LIST_MARGIN_MS = 24 * 3600 * 1000;

// A tag that says "bought something". Drip's product tags are prod_… (German:
// prodG_…, an old one Prod_…) and the early client / klant tags. The free
// variants and the site-era `product:<retreat>` tag (an order on the site, which
// source 1 already reads with its date) are left out.
export function isCustomerTag(tag: string): boolean {
  const t = tag.trim().toLowerCase();
  if (!t) return false;
  if (/(^|[_-])free$/.test(t)) return false;
  return /^prod[a-z]?_/.test(t) || /^(client|klant)(_|$)/.test(t);
}

const norm = (email: string) => email.trim().toLowerCase();

// UTC stamps arrive as 'YYYY-MM-DD HH:MM:SS' (datetime('now')) or ISO.
function ms(stamp: string | null | undefined): number {
  if (!stamp) return NaN;
  const s = stamp.trim();
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(s)) return Date.parse(s);
  return Date.parse(s.replace(' ', 'T') + 'Z');
}

async function byEmails<T>(
  db: D1Database,
  emails: string[],
  sql: (placeholders: string) => string,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < emails.length; i += 90) {
    const chunk = emails.slice(i, i + 90);
    const res = await db
      .prepare(sql(chunk.map(() => '?').join(',')))
      .bind(...chunk)
      .all<T>();
    out.push(...(res.results ?? []));
  }
  return out;
}

// A read that must never take the page down: a table a preview hasn't got yet,
// a column renamed — the split then leans on the sources that did answer.
async function safe<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch (err) {
    console.error(`forgiveness-buyers: ${String(err)}`);
    return [];
  }
}

type CourseRow = {
  id: number;
  email: string;
  product_slug: string;
  paid_at: string;
  amount_cents: number;
  bumps: string | null;
  language_choice: JourneyLanguageChoice | null;
};

type DripCache = { tags: string[]; since: string | null };

export async function classifyCourseBuyers(
  db: D1Database,
  orders: BuyerOrder[],
  opts: { drip?: DripConfig | null; maxDripLookups?: number } = {},
): Promise<{ verdicts: Map<number, BuyerVerdict>; dripUnread: number }> {
  const verdicts = new Map<number, BuyerVerdict>();
  if (orders.length === 0) return { verdicts, dripUnread: 0 };
  const emails = [...new Set(orders.map((o) => norm(o.email)).filter(Boolean))];

  const [courseRows, seatRows, ledgerRows, retreatRows, tagRows, contactRows, bumpTagRows, albumRows, cacheRows] =
    await Promise.all([
      safe(() =>
        byEmails<CourseRow>(db, emails, (p) =>
          `SELECT id, lower(email) AS email, product_slug, paid_at, amount_cents, bumps, language_choice
             FROM course_registrations
            WHERE lower(email) IN (${p}) AND paid_at IS NOT NULL AND status NOT IN ('pending','expired')`),
      ),
      // A paid seat. `created_at` is the moment the form was sent, minutes
      // before the payment at most.
      safe(() =>
        byEmails<{ email: string; at: string; wants_bump: number }>(db, emails, (p) =>
          `SELECT lower(email) AS email, created_at AS at, wants_bump
             FROM workshop_registrations
            WHERE lower(email) IN (${p}) AND payment_status IN ('paid','refunded','chargeback')`),
      ),
      // A course bought through the workshop engine (the ledger's course lines).
      safe(() =>
        byEmails<{ email: string; at: string }>(db, emails, (p) =>
          `SELECT lower(r.email) AS email, pu.created_at AS at
             FROM workshop_purchases pu
             JOIN workshop_registrations r ON r.id = pu.registration_id
            WHERE lower(r.email) IN (${p}) AND pu.product_type = 'course' AND pu.amount_minor > 0`),
      ),
      safe(() =>
        byEmails<{ email: string; at: string }>(db, emails, (p) =>
          `SELECT lower(email) AS email, paid_at AS at
             FROM registrations
            WHERE lower(email) IN (${p}) AND paid_at IS NOT NULL AND host = 0 AND amount_cents > 0`),
      ),
      safe(() =>
        byEmails<{ email: string; tag: string }>(db, emails, (p) =>
          `SELECT lower(email) AS email, tag FROM contact_tags WHERE lower(email) IN (${p})`),
      ),
      safe(() =>
        byEmails<{ email: string; created_at: string; drip_since: string | null }>(db, emails, (p) =>
          `SELECT email, created_at,
                  json_extract(CASE WHEN json_valid(custom) THEN custom END, '$.drip_created_at') AS drip_since
             FROM contacts WHERE email IN (${p})`),
      ),
      safe(async () =>
        (await db
          .prepare(`SELECT slug, drip_tag FROM workshop_products WHERE type = 'bump'`)
          .all<{ slug: string; drip_tag: string | null }>()).results ?? [],
      ),
      safe(async () =>
        (await db
          .prepare(`SELECT id, drip_tag FROM music_albums WHERE drip_tag IS NOT NULL`)
          .all<{ id: string | number; drip_tag: string }>()).results ?? [],
      ),
      safe(async () =>
        (await db
          .prepare(`SELECT external_id, payload_json FROM events WHERE kind = ?`)
          .bind(DRIP_CACHE_KIND)
          .all<{ external_id: string; payload_json: string | null }>()).results ?? [],
      ),
    ]);

  // --- Drip, once per order ---------------------------------------------------
  const drip = new Map<number, DripCache>();
  for (const row of cacheRows) {
    const id = Number(row.external_id.slice(DRIP_CACHE_PREFIX.length));
    try {
      const p = JSON.parse(row.payload_json ?? '{}') as Partial<DripCache>;
      drip.set(id, { tags: Array.isArray(p.tags) ? p.tags : [], since: p.since ?? null });
    } catch {
      /* unreadable cache row: ask Drip again below */
    }
  }
  let dripUnread = 0;
  const missing = orders.filter((o) => !drip.has(o.id));
  if (missing.length > 0 && opts.drip) {
    const cfg = opts.drip;
    const batch = missing.slice(0, opts.maxDripLookups ?? MAX_DRIP_LOOKUPS);
    dripUnread += missing.length - batch.length;
    for (let i = 0; i < batch.length; i += DRIP_PARALLEL) {
      await Promise.all(
        batch.slice(i, i + DRIP_PARALLEL).map(async (o) => {
          try {
            const sub = await getSubscriber(cfg, norm(o.email));
            const entry: DripCache = {
              tags: (sub?.tags ?? []).filter(isCustomerTag).map((t) => t.trim().toLowerCase()),
              since: sub?.created_at ?? null,
            };
            drip.set(o.id, entry);
            await logEventSafe(db, {
              registration_id: null,
              kind: DRIP_CACHE_KIND,
              external_id: dripCacheId(o.id),
              payload: entry,
            });
          } catch {
            dripUnread += 1;
          }
        }),
      );
    }
  } else if (opts.drip) {
    dripUnread += missing.length;
  }
  // Without Drip the contact list is the whole answer (it holds Drip's copy,
  // unsubscribed people included), so nothing counts as unread.

  // --- per address ------------------------------------------------------------
  const group = <T extends { email: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r.email);
      if (list) list.push(r);
      else m.set(r.email, [r]);
    }
    return m;
  };
  const coursesOf = group(courseRows);
  const seatsOf = group(seatRows);
  const ledgerOf = group(ledgerRows);
  const retreatsOf = group(retreatRows);
  const tagsOf = group(tagRows);
  // When the list first knew them: Drip's own first-seen date where the copy
  // kept it (a contact made by the copy is younger than the subscriber).
  const contactSince = new Map(
    contactRows.map((c) => [c.email, c.drip_since && ms(c.drip_since) < ms(c.created_at) ? c.drip_since : c.created_at]),
  );
  const workshopBumpTags = bumpTagRows.map((b) => (b.drip_tag || `prod_${b.slug}`).toLowerCase());
  const albumTag = new Map(albumRows.map((a) => [String(a.id), a.drip_tag.toLowerCase()]));

  for (const o of orders) {
    const email = norm(o.email);
    const paid = ms(o.paidAt);
    const courses = coursesOf.get(email) ?? [];
    const seats = seatsOf.get(email) ?? [];

    // 1. An earlier order on the site that took money.
    const earlierOnSite =
      courses.some((c) => c.id !== o.id && c.amount_cents > 0 && ms(c.paid_at) < paid) ||
      (ledgerOf.get(email) ?? []).some((l) => ms(l.at) < paid) ||
      (seatsCountFor(o.productSlug) && seats.some((s) => ms(s.at) < paid)) ||
      (retreatsOf.get(email) ?? []).some((r) => ms(r.at) < paid);
    if (earlierOnSite) {
      verdicts.set(o.id, { kind: 'returning', via: 'site', onList: true });
      continue;
    }

    // 2. A product tag the site's own orders don't explain.
    const explained = new Set<string>();
    for (const c of courses) {
      for (const t of courseDripTags(c)) explained.add(t.toLowerCase());
      if (isAlbumProductSlug(c.product_slug)) {
        const t = albumTag.get(String(albumIdFromProductSlug(c.product_slug)));
        if (t) explained.add(t);
      }
    }
    if (seats.some((s) => s.wants_bump)) for (const t of workshopBumpTags) explained.add(t);
    const held = [
      ...(tagsOf.get(email) ?? []).map((t) => t.tag.toLowerCase()),
      ...(drip.get(o.id)?.tags ?? []),
    ];
    if (held.some((t) => isCustomerTag(t) && !explained.has(t))) {
      verdicts.set(o.id, { kind: 'returning', via: 'drip', onList: true });
      continue;
    }

    const knownSince = [ms(drip.get(o.id)?.since), ms(contactSince.get(email))].filter(
      (v) => Number.isFinite(v),
    );
    verdicts.set(o.id, {
      kind: 'new',
      via: null,
      onList: knownSince.some((v) => v < paid - ON_LIST_MARGIN_MS),
    });
  }

  return { verdicts, dripUnread };
}
