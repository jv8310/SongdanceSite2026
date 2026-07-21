// Builds the registration-calendar entries (CalItem[]) used by the landing
// pages (/workshop and /masterclass): upcoming published workshops +
// masterclasses, priced in the visitor's currency, with the order bump
// resolved per entry. Extracted from workshop.astro so both pages stay in
// lockstep on classification, pricing, and the bump compare-at anchors.

import type { CalItem } from '../../components/workshop-english/types';
import {
  listUpcomingPublishedWorkshops,
  getProductById,
  getProductBySlug,
  resolvePrice,
  listPricesForProduct,
} from './db';
import { formatMoney } from './currency';
import { formatInTz } from './time';

// The order bump (the "Empowering You" mantra pack). Workshops carry it via
// bump_product_id; masterclasses don't define their own, so they fall back to
// this default — the bump is offered on every date.
const DEFAULT_BUMP_SLUG = 'mantra-empower-bump';

// The mantra pack is a flat €9 add-on with no higher "regular price" to anchor
// against, so no struck-through compare-at is shown (an empty map means the
// register card renders just the €9, with no strike).
const BUMP_COMPARE_BY_CURRENCY: Record<string, number> = {};

// Turn the per-currency price rows into a { CUR: amountMinor } map.
const priceMap = (rows: { currency: string; amount_minor: number }[]) =>
  Object.fromEntries(rows.map((r) => [r.currency.toUpperCase(), r.amount_minor]));

// The registration calendars always show every upcoming masterclass, plus at
// most this many upcoming workshops (the soonest ones — the source list is
// ordered soonest-first). Replays count as workshops toward this cap.
const MAX_WORKSHOPS = 5;

export async function buildCalendarItems(
  db: D1Database,
  currency: string,
  detectedTz: string,
): Promise<CalItem[]> {
  const upcoming = await listUpcomingPublishedWorkshops(db, new Date().toISOString());
  const defaultBump = await getProductBySlug(db, DEFAULT_BUMP_SLUG);

  const items: CalItem[] = [];
  let workshopCount = 0;
  for (const w of upcoming) {
    if (!w.main_product_id) continue;

    // A masterclass is any entry whose main product slug contains "masterclass".
    // Masterclasses are always shown; workshops are capped at MAX_WORKSHOPS (the
    // soonest ones, since the source list is ordered soonest-first).
    const isMasterclass = (w.product_slug ?? '').includes('masterclass');
    if (!isMasterclass && workshopCount >= MAX_WORKSHOPS) continue;

    const price = await resolvePrice(db, w.main_product_id, currency);
    if (!price) continue;
    const pricesByCurrency = priceMap(await listPricesForProduct(db, w.main_product_id));

    if (!isMasterclass) workshopCount++;
    const bumpProductId = w.bump_product_id ?? (isMasterclass ? defaultBump?.id ?? null : null);

    let bumpName = '';
    let bumpLabel = '';
    let bumpMinor = 0;
    let bumpPricesByCurrency: Record<string, number> = {};
    let bumpComparePricesByCurrency: Record<string, number> = {};
    if (bumpProductId) {
      const bumpProduct = await getProductById(db, bumpProductId);
      const bumpPrice = await resolvePrice(db, bumpProductId, price.currency);
      if (bumpProduct && bumpPrice) {
        bumpName = bumpProduct.name;
        bumpLabel = formatMoney(bumpPrice.amountMinor, bumpPrice.currency);
        bumpMinor = bumpPrice.amountMinor;
        bumpPricesByCurrency = priceMap(await listPricesForProduct(db, bumpProductId));
        bumpComparePricesByCurrency = BUMP_COMPARE_BY_CURRENCY;
      }
    }

    items.push({
      slug: w.slug,
      kind: isMasterclass ? 'masterclass' : 'workshop',
      whenLocal: w.is_replay ? null : formatInTz(w.starts_at_utc, detectedTz),
      startsAtUtc: w.is_replay ? null : w.starts_at_utc,
      isReplay: w.is_replay === 1,
      title: w.title,
      durationMin: isMasterclass ? 100 : 70,
      priceLabel: formatMoney(price.amountMinor, price.currency),
      priceMinor: price.amountMinor,
      currency: price.currency,
      pricesByCurrency,
      bumpName,
      bumpLabel,
      bumpMinor,
      bumpPricesByCurrency,
      bumpComparePricesByCurrency,
      hasBump: !!bumpName,
    });
  }
  return items;
}

// Tasteful timezone list with the detected one pinned first (mirrors /w/[slug]).
const COMMON_TZS = [
  'Europe/Brussels', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid',
  'Europe/Amsterdam', 'Europe/Zurich', 'Europe/Stockholm', 'Europe/Oslo', 'Europe/Copenhagen',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto',
  'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo',
  'Australia/Sydney', 'Pacific/Auckland', 'UTC',
];

export function tzOptionsFor(detectedTz: string): string[] {
  return Array.from(new Set([detectedTz, ...COMMON_TZS]));
}
