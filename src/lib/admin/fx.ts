// FX rates → EUR for the order overview's net column. Charges in a non-EUR
// currency (a $99 course, a £ workshop) are converted to EUR here so every
// order has a comparable euro figure.
//
// Rates live in the `fx_rates` D1 table (currency PK, rate_to_eur, updated_at),
// seeded by migration 0040 and refreshed once a day by the hourly cron (see
// src/worker-entrypoint.ts) from the ECB via frankfurter.app. The seed/default
// table below is the fallback when a row — or the whole table — is missing
// (e.g. a preview deploy that hasn't had the migration applied yet).

// Currencies we actually charge in (mirrors workshops/currency.ts) — what we
// ask the FX API for. EUR is implicit (1:1).
const TRACKED = ['USD', 'GBP', 'CAD', 'CHF', 'NOK', 'SEK', 'DKK', 'AUD', 'NZD'];

// Ballpark fallback rates → EUR. Kept in sync with the migration seed.
export const DEFAULT_FX_TO_EUR: Record<string, number> = {
  EUR: 1,
  USD: 0.92,
  GBP: 1.17,
  CAD: 0.68,
  CHF: 1.05,
  NOK: 0.086,
  SEK: 0.088,
  DKK: 0.134,
  AUD: 0.6,
  NZD: 0.56,
};

// Current currency→EUR rates, DB values layered over the defaults so an
// absent row (or a missing table on an un-migrated preview) still resolves.
export async function getFxRatesToEur(
  db: D1Database,
): Promise<Record<string, number>> {
  const rates: Record<string, number> = { ...DEFAULT_FX_TO_EUR };
  try {
    const res = await db
      .prepare('SELECT currency, rate_to_eur FROM fx_rates')
      .all<{ currency: string; rate_to_eur: number }>();
    for (const r of res.results ?? []) {
      if (r.rate_to_eur > 0) rates[r.currency.toUpperCase()] = r.rate_to_eur;
    }
  } catch {
    // fx_rates table not present yet — defaults stand.
  }
  rates.EUR = 1;
  return rates;
}

// True when the freshest row is older than maxAgeHours (or the table is empty).
// Drives the daily refresh from the hourly cron. A missing table → false (no
// store to refresh into; the migration creates it on the next prod deploy).
export async function fxRatesStale(
  db: D1Database,
  maxAgeHours = 20,
): Promise<boolean> {
  try {
    const row = await db
      .prepare('SELECT MAX(updated_at) AS latest FROM fx_rates')
      .first<{ latest: string | null }>();
    if (!row?.latest) return true;
    const ageMs =
      Date.now() - new Date(`${row.latest.replace(' ', 'T')}Z`).getTime();
    return !Number.isFinite(ageMs) || ageMs > maxAgeHours * 3_600_000;
  } catch {
    return false;
  }
}

// Pull the latest ECB rates (base EUR) and upsert each tracked currency's
// rate *to* EUR (the reciprocal). Best-effort: throws on a network/API error
// so the caller can log it; the stored/seed rates remain usable meanwhile.
export async function refreshFxRates(
  db: D1Database,
): Promise<{ updated: number }> {
  const url = `https://api.frankfurter.app/latest?from=EUR&to=${TRACKED.join(',')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`frankfurter ${res.status}`);
  const body = (await res.json()) as { rates?: Record<string, number> };
  const eurTo = body.rates ?? {};

  const rows: Array<[string, number]> = [['EUR', 1]];
  for (const cur of TRACKED) {
    const r = eurTo[cur];
    if (typeof r === 'number' && r > 0) rows.push([cur, 1 / r]);
  }

  let updated = 0;
  for (const [currency, rate] of rows) {
    await db
      .prepare(
        `INSERT INTO fx_rates (currency, rate_to_eur, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(currency) DO UPDATE SET
           rate_to_eur = excluded.rate_to_eur,
           updated_at  = excluded.updated_at`,
      )
      .bind(currency, rate)
      .run();
    updated += 1;
  }
  return { updated };
}
