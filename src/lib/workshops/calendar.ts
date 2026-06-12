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

// The order bump (the Authentic Singing Journey recording pack). Workshops
// carry it via bump_product_id; masterclasses don't define their own, so they
// fall back to this default — the bump is offered on every date.
const DEFAULT_BUMP_SLUG = 'asj-bump';

// Marketing "regular price" anchor for the bump, used only to show a struck-
// through compare-at price next to the one-time offer (the amount actually
// charged is always the bump's real price). The standalone Authentic Singing
// Journey is €99; equivalents are kept in clean round numbers.
const BUMP_COMPARE_BY_CURRENCY: Record<string, number> = {
  EUR: 9900, USD: 9900, GBP: 8900, CHF: 9900, CAD: 14900,
  AUD: 15900, NZD: 16900, NOK: 99900, SEK: 99900, DKK: 69900,
};

// Turn the per-currency price rows into a { CUR: amountMinor } map.
const priceMap = (rows: { currency: string; amount_minor: number }[]) =>
  Object.fromEntries(rows.map((r) => [r.currency.toUpperCase(), r.amount_minor]));

export async function buildCalendarItems(
  db: D1Database,
  currency: string,
  detectedTz: string,
): Promise<CalItem[]> {
  const upcoming = await listUpcomingPublishedWorkshops(db, new Date().toISOString());
  const defaultBump = await getProductBySlug(db, DEFAULT_BUMP_SLUG);

  const items: CalItem[] = [];
  for (const w of upcoming) {
    if (!w.main_product_id) continue;
    const price = await resolvePrice(db, w.main_product_id, currency);
    if (!price) continue;
    const pricesByCurrency = priceMap(await listPricesForProduct(db, w.main_product_id));

    // A masterclass is any entry whose main product slug contains "masterclass".
    const isMasterclass = (w.product_slug ?? '').includes('masterclass');
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
      durationMin: isMasterclass ? 90 : 60,
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
