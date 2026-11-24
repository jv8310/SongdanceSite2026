// New customers vs returning ones among the Forgiveness Course's buyers
// (November 2026) — the split in the Forgiveness box (forgiveness-report.ts).
//
// A buyer is RETURNING when, before this order was paid, they had already
// bought something from Songdance. Two sources say so:
//
//   1. songdance.co — an earlier order under the same address that took money:
//      a course / pass / album / session row, a paid workshop or masterclass
//      seat, a paid retreat booking.
//   2. Drip — a product tag (prod_…, prodG_…, client, klant) that no order on
//      the site explains: they bought before the site took payments. Read from
//      Drip itself and from the contact list, which holds the Drip export of
//      the people since removed from Drip (their old tags live only there).
//      The site pushes a tag to both for every order it takes, so the tags of
//      this buyer's own site orders (the Forgiveness order and anything later)
//      are taken out first; what is left came from somewhere else.
//
// Everyone else is NEW. Of those, `onList` marks who was already on the email
// list a day or more before the order (a Drip subscriber, or a contact row) —
// a new customer, but not a stranger.
//
// Drip is asked once per order and the answer kept in `events`
// (`forgiveness-buyer-drip-<order id>`), so the pages don't call Drip on every
// load. An order Drip could not be read for is classified on the rest and
// counted in `dripUnread`; the next page load tries again.

import { getSubscriber, type DripConfig } from '../registrations/drip';
import { logEventSafe } from '../registrations/db';
import { courseDripTags } from '../courses/drip-tags';
import { albumIdFromProductSlug, isAlbumProductSlug } from '../music/product';
import type { JourneyLanguageChoice } from '../courses/journeys';

export type BuyerVerdict = {
  kind: 'new' | 'returning';
  // What made them returning: an earlier order on the site, or only Drip's tags.
  via: 'site' | 'drip' | null;
  // New customers only: already on the email list a day or more before.
  onList: boolean;
};

export type BuyerOrder = { id: number; email: string; paidAt: string };

const DRIP_CACHE_KIND = 'forgiveness.buyer.drip';
const DRIP_CACHE_PREFIX = 'forgiveness-buyer-drip-';
const dripCacheId = (orderId: number) => `${DRIP_CACHE_PREFIX}${orderId}`;
// Drip lookups per page load (in parallel, 8s each at the outside).
const MAX_DRIP_LOOKUPS = 30;
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

export async function classifyForgivenessBuyers(
  db: D1Database,
  orders: BuyerOrder[],
  opts: { drip?: DripConfig | null } = {},
): Promise<{ verdicts: Map<number, BuyerVerdict>; dripUnread: number }> {
  const verdicts = new Map<number, BuyerVerdict>();
  if (orders.length === 0) return { verdicts, dripUnread: 0 };
  const emails = [...new Set(orders.map((o) => norm(o.email)).filter(Boolean))];

  const [courseRows, seatRows, retreatRows, tagRows, contactRows, bumpTagRows, albumRows, cacheRows] =
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
        byEmails<{ email: string; created_at: string }>(db, emails, (p) =>
          `SELECT email, created_at FROM contacts WHERE email IN (${p})`),
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
    const batch = missing.slice(0, MAX_DRIP_LOOKUPS);
    dripUnread += missing.length - batch.length;
    await Promise.all(
      batch.map(async (o) => {
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
  } else {
    dripUnread += missing.length;
  }

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
  const retreatsOf = group(retreatRows);
  const tagsOf = group(tagRows);
  const contactSince = new Map(contactRows.map((c) => [c.email, c.created_at]));
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
      seats.some((s) => ms(s.at) < paid) ||
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
