// Cloudflare edge geo helpers. The Worker runtime attaches the visitor's
// inferred location to every request as `locals.runtime.cf`; `cf.timezone` is a
// best-effort IANA timezone derived from their IP — no client JS or form field
// needed. We capture it at checkout (courses + retreats, which have no timezone
// field of their own) so the purchase can forward a real timezone to Drip, the
// same one lifecycle mail rides for local-time sending.

// Returns the edge-detected IANA timezone, or null when absent/blank. Kept
// permissive (any non-blank string, e.g. "Europe/Brussels" or "UTC") — Drip
// simply ignores a value it can't parse, and we never want to throw on a
// checkout's hot path over a geo miss.
export function edgeTimezone(locals: App.Locals): string | null {
  const cf = locals.runtime?.cf as { timezone?: unknown } | undefined;
  const tz = cf?.timezone;
  return typeof tz === 'string' && tz.trim() ? tz.trim() : null;
}

// The edge-detected ISO-2 country ("BE", "US", …), or null. Used to pre-pick
// the visitor's country/currency on SSR pages (e.g. the album sales page) —
// always overridable by the buyer's own country choice in the form.
export function edgeCountry(locals: App.Locals): string | null {
  const cf = locals.runtime?.cf as { country?: unknown } | undefined;
  const c = cf?.country;
  return typeof c === 'string' && /^[A-Za-z]{2}$/.test(c.trim()) ? c.trim().toUpperCase() : null;
}
