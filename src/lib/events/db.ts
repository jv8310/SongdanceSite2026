// DB-backed events catalogue.
//
// One source of truth for the /events grid, the homepage "Upcoming" strip,
// and the RetreatBand. The grid stores card data only — each event's rich
// content lives on its own landing page, linked via `href`.

import { getProductBySlug, computeBookedPercent } from '../registrations/db';
import { launchPromoActive, LAUNCH_PROMO_PERCENT } from '../promo';

export type EventCategory = 'retreat' | 'online' | 'course';
export type EventLanguage = 'en' | 'de' | 'nl';
export type EventStatus = 'open' | 'waitlist' | 'closed';

export interface EventRow {
  id: string;
  title: string;
  category: EventCategory;
  language: EventLanguage;
  facilitators: string | null; // JSON array string as stored
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  capacity: number | null;
  price: string | null;
  status: EventStatus;
  summary: string | null;
  href: string | null;
  image_key: string | null;
  product_slug: string | null; // links to a registrations product for live "% booked"
  ongoing: number;
  published: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Shape the public site and the JSON API consume — facilitators parsed,
// image resolved to a URL, dates kept as ISO strings.
export interface EventCard {
  id: string;
  title: string;
  category: EventCategory;
  language: EventLanguage;
  facilitators: string[];
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  capacity: number | null;
  price: string | null;
  status: EventStatus;
  summary: string | null;
  href: string | null;
  imageUrl: string | null;
  productSlug: string | null;
  bookedPercent: number | null; // live "% booked" when linked to a product, else null
  ongoing: boolean;
  promoPrice: PromoPrice | null; // launch-promo struck list + discounted price, else null
}

// The struck list price + discounted price shown while the launch promo runs.
export interface PromoPrice {
  was: string; // the normal price, struck through (e.g. "9€")
  now: string; // the discounted price in the same style (e.g. "4.50€")
}

export const CATEGORIES: EventCategory[] = ['retreat', 'online', 'course'];
export const STATUSES: EventStatus[] = ['open', 'waitlist', 'closed'];
export const LANGUAGES: EventLanguage[] = ['en', 'de', 'nl'];

export function parseFacilitators(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x)).filter(Boolean);
  } catch {
    // Fall back to a comma-separated string if it isn't valid JSON.
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function rowToCard(row: EventRow): EventCard {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    language: row.language,
    facilitators: parseFacilitators(row.facilitators),
    startDate: row.start_date,
    endDate: row.end_date,
    location: row.location,
    capacity: row.capacity,
    price: row.price,
    status: row.status,
    summary: row.summary,
    href: row.href,
    imageUrl: row.image_key ? `/media/${row.image_key}` : null,
    productSlug: row.product_slug,
    bookedPercent: null, // filled in by listPublicEvents for linked products
    ongoing: row.ongoing === 1,
    promoPrice: null, // filled in by listPublicEvents while the promo runs
  };
}

// The launch promo (50% off) applies to online events and courses only — never
// retreats, which are physical events priced on their own path (mirrors the
// scope in src/lib/promo.ts). Keep these two in lock-step.
const PROMO_EVENT_CATEGORIES: ReadonlySet<EventCategory> = new Set(['online', 'course']);

// While the launch promo is live, derive the struck list price + discounted
// price for a promo-eligible event whose free-text price carries a single euro
// figure (e.g. "9€", "€650"). Returns null when the promo is off, the category
// is excluded (retreats), or the label has no single parseable figure (blank,
// a "From €X" with no number, a range) — the card then shows its plain price.
// The discount is computed in minor units with the same rounding the checkout
// endpoints use, so the struck deal matches what's charged.
export function eventPromoPrice(
  card: Pick<EventCard, 'category' | 'price'>,
  nowMs: number = Date.now(),
): PromoPrice | null {
  if (!card.price || !launchPromoActive(nowMs)) return null;
  if (!PROMO_EVENT_CATEGORIES.has(card.category)) return null;
  const figures = card.price.match(/\d+(?:[.,]\d+)?/g);
  if (!figures || figures.length !== 1) return null; // blank or ambiguous (range)
  const raw = figures[0];
  const amount = parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const promoMinor = Math.round((Math.round(amount * 100) * (100 - LAUNCH_PROMO_PERCENT)) / 100);
  const promoMajor = promoMinor / 100;
  const body = Number.isInteger(promoMajor) ? String(promoMajor) : promoMajor.toFixed(2);
  return { was: card.price, now: card.price.replace(raw, body) };
}

// An event counts as "past" only when it has an end (or start) date that has
// already gone by. Ongoing events, and undated "start anytime" events, never
// expire.
export function isPast(
  card: Pick<EventCard, 'startDate' | 'endDate' | 'ongoing'>,
  now = new Date(),
): boolean {
  if (card.ongoing) return false;
  const ref = card.endDate ?? card.startDate;
  if (!ref) return false;
  const end = new Date(`${ref}T23:59:59`);
  return end.getTime() < now.getTime();
}

// Sort: dated events ascending by date, then undated ("anytime") events, then
// by manual sort_order as a tiebreaker.
export function compareCards(a: EventCard, b: EventCard): number {
  const ad = a.startDate ?? a.endDate;
  const bd = b.startDate ?? b.endDate;
  if (ad && bd) return ad < bd ? -1 : ad > bd ? 1 : 0;
  if (ad && !bd) return -1;
  if (!ad && bd) return 1;
  return 0;
}

export async function listEvents(db: D1Database): Promise<EventRow[]> {
  const q = await db
    .prepare(
      `SELECT * FROM calendar_events
        ORDER BY (start_date IS NULL), start_date ASC, sort_order ASC, title ASC`,
    )
    .all<EventRow>();
  return q.results ?? [];
}

export async function getEvent(db: D1Database, id: string): Promise<EventRow | null> {
  const row = await db.prepare(`SELECT * FROM calendar_events WHERE id = ?`).bind(id).first<EventRow>();
  return row ?? null;
}

// Published, future (or undated) events as cards, ready for the public site.
export async function listPublicEvents(
  db: D1Database,
  opts: { language?: EventLanguage; category?: EventCategory; now?: Date } = {},
): Promise<EventCard[]> {
  const rows = await listEvents(db);
  const now = opts.now ?? new Date();
  let cards = rows
    .filter((r) => r.published === 1)
    .map(rowToCard)
    .filter((c) => !isPast(c, now));
  if (opts.language) cards = cards.filter((c) => c.language === opts.language);
  if (opts.category) cards = cards.filter((c) => c.category === opts.category);
  cards.sort(compareCards);
  await attachBookedPercent(db, cards);
  const nowMs = now.getTime();
  for (const card of cards) card.promoPrice = eventPromoPrice(card, nowMs);
  return cards;
}

// Fill in `bookedPercent` for cards linked to a registrations product, so the
// grid (and the JSON feed it powers) can show a live "X% booked" figure that
// matches the booking pages. Cards with no product link are left untouched.
async function attachBookedPercent(db: D1Database, cards: EventCard[]): Promise<void> {
  await Promise.all(
    cards.map(async (card) => {
      if (!card.productSlug) return;
      const product = await getProductBySlug(db, card.productSlug);
      if (!product) return;
      const occ = await computeBookedPercent(db, product.id);
      if (occ) card.bookedPercent = occ.percent;
    }),
  );
}

export async function listUpcoming(
  db: D1Database,
  limit = 3,
  opts: { category?: EventCategory; language?: EventLanguage } = {},
): Promise<EventCard[]> {
  const cards = await listPublicEvents(db, opts);
  return cards.slice(0, limit);
}

export interface EventInput {
  id: string;
  title: string;
  category: EventCategory;
  language: EventLanguage;
  facilitators: string[];
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  capacity: number | null;
  price: string | null;
  status: EventStatus;
  summary: string | null;
  href: string | null;
  product_slug: string | null;
  image_key?: string | null; // undefined = leave existing image untouched on update
  ongoing: number;
  published: number;
  sort_order: number;
}

export async function upsertEvent(
  db: D1Database,
  input: EventInput,
  originalId?: string,
): Promise<void> {
  const facilitators = JSON.stringify(input.facilitators ?? []);

  if (originalId && originalId !== input.id) {
    // Renamed (id changed): update the existing row, keyed on the old id.
    await db
      .prepare(
        `UPDATE calendar_events SET
           id = ?, title = ?, category = ?, language = ?, facilitators = ?,
           start_date = ?, end_date = ?, location = ?, capacity = ?, price = ?,
           status = ?, summary = ?, href = ?, product_slug = ?,
           ${input.image_key !== undefined ? 'image_key = ?,' : ''}
           ongoing = ?, published = ?, sort_order = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(
        input.id, input.title, input.category, input.language, facilitators,
        input.start_date, input.end_date, input.location, input.capacity, input.price,
        input.status, input.summary, input.href, input.product_slug,
        ...(input.image_key !== undefined ? [input.image_key] : []),
        input.ongoing, input.published, input.sort_order, originalId,
      )
      .run();
    return;
  }

  await db
    .prepare(
      `INSERT INTO calendar_events
         (id, title, category, language, facilitators, start_date, end_date,
          location, capacity, price, status, summary, href, product_slug, image_key,
          ongoing, published, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         category = excluded.category,
         language = excluded.language,
         facilitators = excluded.facilitators,
         start_date = excluded.start_date,
         end_date = excluded.end_date,
         location = excluded.location,
         capacity = excluded.capacity,
         price = excluded.price,
         status = excluded.status,
         summary = excluded.summary,
         href = excluded.href,
         product_slug = excluded.product_slug,
         ${input.image_key !== undefined ? 'image_key = excluded.image_key,' : ''}
         ongoing = excluded.ongoing,
         published = excluded.published,
         sort_order = excluded.sort_order,
         updated_at = datetime('now')`,
    )
    .bind(
      input.id, input.title, input.category, input.language, facilitators,
      input.start_date, input.end_date, input.location, input.capacity, input.price,
      input.status, input.summary, input.href, input.product_slug, input.image_key ?? null,
      input.ongoing, input.published, input.sort_order,
    )
    .run();
}

export async function deleteEvent(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM calendar_events WHERE id = ?`).bind(id).run();
}

// ---- Formatting helpers (shared by grid + admin) ----

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function fmtDay(iso: string): { d: number; m: string; y: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return { y: Number(m[1]), m: MONTHS[Number(m[2]) - 1], d: Number(m[3]) };
}

export function formatDateRange(
  start: string | null,
  end: string | null,
  ongoing = false,
): string {
  if (ongoing) {
    if (!start) return 'Ongoing';
    const s = fmtDay(start);
    return s ? `From ${s.d} ${s.m} ${s.y}` : `From ${start}`;
  }
  if (!start) return 'Start anytime';
  const s = fmtDay(start);
  if (!s) return start;
  if (!end || end === start) return `${s.d} ${s.m} ${s.y}`;
  const e = fmtDay(end);
  if (!e) return `${s.d} ${s.m} ${s.y}`;
  if (s.m === e.m && s.y === e.y) return `${s.d}–${e.d} ${s.m} ${s.y}`;
  if (s.y === e.y) return `${s.d} ${s.m} – ${e.d} ${e.m} ${s.y}`;
  return `${s.d} ${s.m} ${s.y} – ${e.d} ${e.m} ${e.y}`;
}

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  retreat: 'Retreat',
  online: 'Online event',
  course: 'Course',
};

export const STATUS_LABEL: Record<EventStatus, string> = {
  open: 'Open',
  waitlist: 'Waitlist',
  closed: 'Closed',
};
