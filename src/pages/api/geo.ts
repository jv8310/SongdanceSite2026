import type { APIRoute } from 'astro';

export const prerender = false;

// GET /api/geo → { country: "BE" | "NL" | … | null }
//
// Returns the ISO-3166-1 alpha-2 country code Cloudflare attached to the
// request, used by the registration form to pre-select the Country and
// phone-country dropdowns. Falls back to null on local dev (where there
// is no Cloudflare edge) or when CF returns "XX" / "T1" (unknown / Tor).
export const GET: APIRoute = async ({ locals, request }) => {
  // The CF object is the source of truth on the edge. The CF-IPCountry
  // header is the fallback that some preview environments still set.
  const cf = (locals.runtime as any)?.cf;
  const cfCountry = (cf?.country as string | undefined) ?? null;
  const headerCountry = request.headers.get('CF-IPCountry');
  const raw = cfCountry || headerCountry || null;
  const country =
    raw && raw.length === 2 && !['XX', 'T1'].includes(raw)
      ? raw.toUpperCase()
      : null;

  return new Response(JSON.stringify({ country }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
};
