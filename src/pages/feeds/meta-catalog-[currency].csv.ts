import type { APIRoute } from 'astro';
import { buildOverrideFeed } from '../../lib/catalog/feed';
import { OVERRIDE_CURRENCIES, type FeedCurrency } from '../../lib/catalog/products';

export const prerender = false;

// Per-currency country-override feeds for the Meta catalog, one URL per non-EUR
// currency the site prices in:
//   /feeds/meta-catalog-usd.csv, -gbp.csv, -cad.csv, -chf.csv, -aud.csv,
//   -nzd.csv, -nok.csv, -sek.csv, -dkk.csv
// Each carries id + price + sale_price in that currency. In Commerce Manager,
// upload each as a country override on top of the EUR main feed (./meta-catalog.csv),
// assigned to the country/countries it serves (see OVERRIDE_FEED_COUNTRIES — here
// USD↦US, GBP↦GB, CAD↦CA, CHF↦CH, AUD↦AU, NZD↦NZ, NOK↦NO, SEK↦SE, DKK↦DK). EUR is
// the base feed, the default for every other country. Meta requires one currency
// per feed, which is why each currency is its own URL.

const OVERRIDE_SET = new Set<string>(OVERRIDE_CURRENCIES);

export const GET: APIRoute = ({ params }) => {
  // The route is /feeds/meta-catalog-<currency>.csv → params.currency is the
  // lowercase code (e.g. "usd"). Validate against the supported override set.
  const code = (params.currency ?? '').toUpperCase();
  if (!OVERRIDE_SET.has(code)) {
    return new Response('Unknown currency feed', { status: 404 });
  }

  const csv = buildOverrideFeed(code as FeedCurrency);
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
