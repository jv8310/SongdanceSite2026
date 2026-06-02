// Quaderno — TAX ONLY for the workshop engine.
//
// The Stripe→Quaderno native connector creates invoices automatically when a
// Stripe payment completes, so we never call Quaderno to *create* invoices.
// The single thing we use Quaderno for here is looking up the VAT rate for a
// buyer country, to split a gross charge into net + tax for the stats.
//
// GET https://<account>.quadernoapp.com/api/tax_rates/calculate?country=DE&tax_class=eservice
// Auth: Basic base64(QUADERNO_API_KEY + ":x")

export type QuadernoTaxConfig = {
  apiKey: string;
  account: string; // subdomain, e.g. "songdance"
  sandbox?: boolean;
};

function baseUrl(cfg: QuadernoTaxConfig) {
  const host = cfg.sandbox
    ? `${cfg.account}.sandbox-quadernoapp.com`
    : `${cfg.account}.quadernoapp.com`;
  return `https://${host}/api`;
}

function authHeader(cfg: QuadernoTaxConfig) {
  return `Basic ${btoa(`${cfg.apiKey}:x`)}`;
}

// Returns the VAT rate as a decimal (e.g. 0.21 for 21%). On any failure or
// for countries with no rate, returns 0 — the caller then treats net = gross
// and flags the row. A small in-memory cache avoids re-hitting Quaderno for
// the same country within a single worker invocation.
const rateCache = new Map<string, number>();

export async function getTaxRate(
  cfg: QuadernoTaxConfig,
  country: string,
  taxClass = 'eservice',
): Promise<number> {
  const key = `${country.toUpperCase()}:${taxClass}`;
  const cached = rateCache.get(key);
  if (cached !== undefined) return cached;

  const url = new URL(`${baseUrl(cfg)}/tax_rates/calculate.json`);
  url.searchParams.set('country', country.toUpperCase());
  url.searchParams.set('tax_class', taxClass);

  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader(cfg), Accept: 'application/json' },
    });
    if (!res.ok) {
      rateCache.set(key, 0);
      return 0;
    }
    const body = (await res.json()) as { rate?: number | string; name?: string };
    const raw = typeof body.rate === 'string' ? parseFloat(body.rate) : body.rate;
    // Quaderno returns rate as a percentage (e.g. 21). Normalise to a decimal.
    let rate = Number.isFinite(raw) ? Number(raw) : 0;
    if (rate > 1) rate = rate / 100;
    rateCache.set(key, rate);
    return rate;
  } catch {
    rateCache.set(key, 0);
    return 0;
  }
}

// Split a gross (tax-inclusive) total into net + tax given a decimal rate.
export function netFromGross(
  grossMinor: number,
  rate: number,
): { subtotalMinor: number; taxMinor: number } {
  if (!rate || rate <= 0) return { subtotalMinor: grossMinor, taxMinor: 0 };
  const subtotalMinor = Math.round(grossMinor / (1 + rate));
  return { subtotalMinor, taxMinor: grossMinor - subtotalMinor };
}
