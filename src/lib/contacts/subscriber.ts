// "What do we know about this address?" — answered from the site's own contact
// list, with Drip asked as well only while Drip is still connected.
//
// Every page that used to ask Drip about a person (the course offers, /access,
// album access, the bump offers, the new/returning split) now asks here. The
// contact list holds everyone Drip holds: the daily copy (drip-sync.ts) brings
// over every Drip subscriber, unsubscribed ones included, with their tags and
// custom fields, and every purchase on the site writes its tags here too
// (mirror.ts). So Drip can be cancelled by removing DRIP_API_TOKEN: nothing
// here then calls it, and the answers stay the same.
//
// While Drip is connected its answer is merged in (tags added, its custom
// fields preferred, since they are fresher than the last copy). Setting
// DRIP_READS = "off" stops the reads while leaving the token in place for the
// writes, to try the site-only answer before cancelling.
//
// The shape is Drip's (`DripSubscriber`) so the callers did not change. Tags
// on the contact list are lowercased; Drip's are not. Every caller compares
// tags without regard to case.

import { getSubscriber, type DripConfig, type DripSubscriber } from '../registrations/drip';

type Env = { DB: D1Database; DRIP_API_TOKEN?: string; DRIP_ACCOUNT_ID?: string; DRIP_READS?: string };

export type SubscriberLookup = {
  subscriber: DripSubscriber | null;
  // Drip was asked and did not answer (the site's answer stands alone).
  dripFailed: boolean;
  // Drip was asked at all.
  dripAsked: boolean;
};

/** The Drip config for reads, or null when Drip is not connected or reads are off. */
export function dripReadConfig(env: Omit<Env, 'DB'>): DripConfig | null {
  if (!env.DRIP_API_TOKEN || !env.DRIP_ACCOUNT_ID) return null;
  if ((env.DRIP_READS ?? '').trim().toLowerCase() === 'off') return null;
  return { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID };
}

function parseCustom(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (v == null || typeof v === 'object') continue;
      out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}

/** The site's own answer: the contact row, its tags and custom fields. */
export async function siteSubscriber(db: D1Database, rawEmail: string): Promise<DripSubscriber | null> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return null;
  const row = await db
    .prepare(`SELECT email, name, timezone, country, custom, created_at FROM contacts WHERE email = ?`)
    .bind(email)
    .first<{ email: string; name: string | null; timezone: string | null; country: string | null; custom: string | null; created_at: string }>();
  if (!row) return null;
  const tags = await db
    .prepare(`SELECT tag FROM contact_tags WHERE email = ? ORDER BY tag`)
    .bind(email)
    .all<{ tag: string }>();
  const custom = parseCustom(row.custom);
  const name = (row.name ?? '').trim();
  const space = name.indexOf(' ');
  const first = custom.first_name || (space > 0 ? name.slice(0, space) : name) || undefined;
  const last = custom.last_name || (space > 0 ? name.slice(space + 1).trim() : '') || undefined;
  // When Drip first saw them is kept by the copy; else when the contact was made.
  const since = custom.drip_created_at || `${row.created_at.replace(' ', 'T')}Z`;
  return {
    email: row.email,
    first_name: first,
    last_name: last,
    country: row.country ?? custom.country ?? undefined,
    phone: custom.phone || undefined,
    time_zone: row.timezone ?? undefined,
    tags: (tags.results ?? []).map((t) => t.tag),
    custom_fields: custom,
    created_at: since,
  };
}

function merge(site: DripSubscriber | null, drip: DripSubscriber | null): DripSubscriber | null {
  if (!site) return drip;
  if (!drip) return site;
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of [...drip.tags, ...site.tags]) {
    const k = t.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    tags.push(t);
  }
  const earliest = [site.created_at, drip.created_at].filter(Boolean).sort()[0];
  return {
    ...site,
    ...Object.fromEntries(Object.entries(drip).filter(([, v]) => v != null && v !== '')),
    tags,
    custom_fields: { ...site.custom_fields, ...drip.custom_fields },
    created_at: earliest,
  };
}

/** The contact list's answer, merged with Drip's while Drip is connected. Never throws on Drip. */
export async function lookupSubscriber(env: Env, email: string): Promise<SubscriberLookup> {
  const cfg = dripReadConfig(env);
  const [site, drip] = await Promise.all([
    siteSubscriber(env.DB, email).catch(() => null),
    cfg
      ? getSubscriber(cfg, email.trim().toLowerCase()).then(
          (s) => ({ s, failed: false }),
          () => ({ s: null, failed: true }),
        )
      : Promise.resolve({ s: null, failed: false }),
  ]);
  return { subscriber: merge(site, drip.s), dripFailed: drip.failed, dripAsked: !!cfg };
}
