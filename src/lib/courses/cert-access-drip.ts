// Mirrors each certification student's end date (cert-access.ts) into Drip, so
// Drip automations can act on it: one of two tags, plus the dates as fields.
//
//   cert_ends_2026   — the course ends on 31 December 2026
//   cert_ends_later  — their own 9 months run past it; see cert_end_date
//   cert_end_date    — YYYY-MM-DD, the last day of the course (custom field)
//   cert_start_date  — YYYY-MM-DD, the day their 9 months started (custom field)
//
// The site is the source of truth; Drip only receives the result. Each
// (address, end date) is pushed ONCE, claimed in `events`
// (`cert-access-drip-v1-<email>-<end date>`, kind `cert.access.drip_synced`) and
// released if Drip fails, so a retry gets through. A later purchase that moves
// someone's end date makes a new key → they are pushed again, and the other
// group's tag is removed so nobody carries both.
//
// Holders with no order on the site — bought before it took payments
// (`prod_SVH_9m` in Drip) or the CEEE 2025 cohort (`prod_CEEE-25`) — come from
// cert-access-legacy.ts: `cert_ends_2026` + `cert_end_date` 2026-12-31, no
// start date (there's no purchase to start from), and the CEEE cohort also gets
// `cert_no_certification`: the course, not the right to apply for
// certification. A site order always wins, and pushing one removes that tag.
//
// Who runs it: the hourly cron (`runCertAccessDripSync` — that IS the data
// migration: on the first deploy it pushes everyone who already holds the
// course, a paced batch per tick), the course paid-handler for a new buyer
// (`syncCertAccessForEmail`), and the "Push to Drip now" button on
// /admin/courses/cert-access. No-ops entirely until Drip is configured.

import { removeTag, upsertSubscriber, type DripConfig } from '../registrations/drip';
import { logEventSafe } from '../registrations/db';
import { dripConfig } from '../orders/drip-order';
import { getCertAccessForEmail, listCertAccess, type CertAccess, type CertAccessGroup } from './cert-access';
import { listLegacyCertAccess, refreshLegacyRoster, type LegacyCertAccess } from './cert-access-legacy';

export const CERT_DRIP_TAGS: Record<CertAccessGroup, string> = {
  'end-2026': 'cert_ends_2026',
  later: 'cert_ends_later',
};
export const CERT_END_FIELD = 'cert_end_date';
export const CERT_START_FIELD = 'cert_start_date';
// CEEE 2025 free access: the course, without the right to apply for certification.
export const CERT_NO_CERTIFICATION_TAG = 'cert_no_certification';

const CLAIM_KIND = 'cert.access.drip_synced';
const CLAIM_PREFIX = 'cert-access-drip-v1-';
const DEFAULT_CAP = 60;
const GAP_MS = 250;

type SyncEnv = {
  DB: D1Database;
  DRIP_API_TOKEN?: string;
  DRIP_ACCOUNT_ID?: string;
};

export function certAccessClaimKey(a: Pick<CertAccess, 'email' | 'endsOn'>): string {
  return `${CLAIM_PREFIX}${a.email}-${a.endsOn}`;
}
// A no-certification push is its own key, so gaining or losing that status
// pushes again.
export function legacyCertClaimKey(a: Pick<LegacyCertAccess, 'email' | 'endsOn' | 'noCertification'>): string {
  return `${CLAIM_PREFIX}${a.email}-${a.endsOn}${a.noCertification ? '-nocert' : ''}`;
}

// The claim keys already pushed — so the admin page can say who is in Drip.
export async function listSyncedCertKeys(db: D1Database): Promise<Map<string, string>> {
  const rows = await db
    .prepare(`SELECT external_id, created_at FROM events WHERE kind = ?`)
    .bind(CLAIM_KIND)
    .all<{ external_id: string; created_at: string }>();
  return new Map((rows.results ?? []).map((r) => [r.external_id, r.created_at]));
}

type Push = {
  email: string;
  key: string;
  group: CertAccessGroup;
  endsOn: string;
  startsOn: string | null;
  noCertification: boolean;
  payload: Record<string, unknown>;
};

function sitePush(a: CertAccess): Push {
  return {
    email: a.email,
    key: certAccessClaimKey(a),
    group: a.group,
    endsOn: a.endsOn,
    startsOn: a.startsOn,
    noCertification: false,
    payload: {
      start_reason: a.startReason,
      product_slug: a.productSlug,
      purchased_on: a.purchasedOn,
    },
  };
}

function legacyPush(a: LegacyCertAccess): Push {
  return {
    email: a.email,
    key: legacyCertClaimKey(a),
    group: a.group,
    endsOn: a.endsOn,
    startsOn: null,
    noCertification: a.noCertification,
    payload: { legacy: true, has_cert_tag: a.hasCertTag, has_ceee_tag: a.hasCeeeTag },
  };
}

async function pushOne(db: D1Database, cfg: DripConfig, p: Push): Promise<'sent' | 'already' | 'failed'> {
  const claim = await db
    .prepare(
      `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id, payload_json)
       VALUES (NULL, ?, 'system', ?, ?)`,
    )
    .bind(
      CLAIM_KIND,
      p.key,
      JSON.stringify({
        email: p.email,
        group: p.group,
        ends_on: p.endsOn,
        starts_on: p.startsOn,
        no_certification: p.noCertification,
        ...p.payload,
      }),
    )
    .run();
  if ((claim.meta?.changes ?? 0) === 0) return 'already';

  try {
    const tags = [CERT_DRIP_TAGS[p.group]];
    if (p.noCertification) tags.push(CERT_NO_CERTIFICATION_TAG);
    await upsertSubscriber(cfg, {
      email: p.email,
      tags,
      custom_fields: {
        [CERT_END_FIELD]: p.endsOn,
        ...(p.startsOn ? { [CERT_START_FIELD]: p.startsOn } : {}),
      },
    });
    const other: CertAccessGroup = p.group === 'end-2026' ? 'later' : 'end-2026';
    await removeTag(cfg, p.email, CERT_DRIP_TAGS[other]);
    if (!p.noCertification) await removeTag(cfg, p.email, CERT_NO_CERTIFICATION_TAG);
    return 'sent';
  } catch (err) {
    await db.prepare(`DELETE FROM events WHERE external_id = ? AND kind = ?`).bind(p.key, CLAIM_KIND).run();
    await logEventSafe(db, {
      registration_id: null,
      kind: 'cert.access.drip_error',
      source: 'system',
      payload: { email: p.email, ends_on: p.endsOn, error: String(err).slice(0, 500) },
    });
    return 'failed';
  }
}

export type CertAccessSyncResult = {
  skipped?: boolean;
  total: number;
  sent: number;
  failed: number;
  remaining: number;
  refreshError?: string;
};

// Everyone who holds the course: site orders first, then the Drip-only
// holders who have no order on the site.
export async function listAllCertAccess(
  db: D1Database,
): Promise<{ site: CertAccess[]; legacy: LegacyCertAccess[] }> {
  const site = await listCertAccess(db);
  const legacy = await listLegacyCertAccess(db, new Set(site.map((a) => a.email)));
  return { site, legacy };
}

// Push everyone not yet in Drip with their current end date, up to `cap`.
// Re-reads the Drip-only roster first when it is stale (or `refresh` forces it).
export async function runCertAccessDripSync(
  env: SyncEnv,
  opts: { cap?: number; refresh?: boolean } = {},
): Promise<CertAccessSyncResult> {
  const cfg = dripConfig(env);
  if (!cfg) return { skipped: true, total: 0, sent: 0, failed: 0, remaining: 0 };

  let refreshError: string | undefined;
  try {
    await refreshLegacyRoster(env, { force: opts.refresh });
  } catch (err) {
    // Never block the site buyers' push on the roster read.
    refreshError = String(err).slice(0, 200);
    console.error('[cert-access] legacy roster refresh failed', refreshError);
  }

  const { site, legacy } = await listAllCertAccess(env.DB);
  const all = [...site.map(sitePush), ...legacy.map(legacyPush)];
  const synced = await listSyncedCertKeys(env.DB);
  const pending = all.filter((p) => !synced.has(p.key));
  const cap = opts.cap ?? DEFAULT_CAP;

  let sent = 0;
  let failed = 0;
  for (const p of pending.slice(0, cap)) {
    const r = await pushOne(env.DB, cfg, p);
    if (r === 'sent') sent++;
    if (r === 'failed') failed++;
    if (r !== 'already') await new Promise((res) => setTimeout(res, GAP_MS));
  }
  return { total: all.length, sent, failed, remaining: Math.max(0, pending.length - sent), refreshError };
}

// One buyer, right after a cert / path / 12-week purchase is fulfilled. Never
// throws — the hourly sweep picks up anything this misses.
export async function syncCertAccessForEmail(env: SyncEnv, email: string): Promise<void> {
  const cfg = dripConfig(env);
  if (!cfg) return;
  try {
    const a = await getCertAccessForEmail(env.DB, email);
    if (a) await pushOne(env.DB, cfg, sitePush(a));
  } catch (err) {
    console.error('[cert-access] sync failed', String(err));
  }
}
