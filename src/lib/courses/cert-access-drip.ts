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
// Who runs it: the hourly cron (`runCertAccessDripSync` — that IS the data
// migration: on the first deploy it pushes everyone who already holds the
// course, a paced batch per tick), the course paid-handler for a new buyer
// (`syncCertAccessForEmail`), and the "Push to Drip now" button on
// /admin/courses/cert-access. No-ops entirely until Drip is configured.

import { removeTag, upsertSubscriber, type DripConfig } from '../registrations/drip';
import { logEventSafe } from '../registrations/db';
import { dripConfig } from '../orders/drip-order';
import { getCertAccessForEmail, listCertAccess, type CertAccess, type CertAccessGroup } from './cert-access';

export const CERT_DRIP_TAGS: Record<CertAccessGroup, string> = {
  'end-2026': 'cert_ends_2026',
  later: 'cert_ends_later',
};
export const CERT_END_FIELD = 'cert_end_date';
export const CERT_START_FIELD = 'cert_start_date';

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

// The claim keys already pushed — so the admin page can say who is in Drip.
export async function listSyncedCertKeys(db: D1Database): Promise<Map<string, string>> {
  const rows = await db
    .prepare(`SELECT external_id, created_at FROM events WHERE kind = ?`)
    .bind(CLAIM_KIND)
    .all<{ external_id: string; created_at: string }>();
  return new Map((rows.results ?? []).map((r) => [r.external_id, r.created_at]));
}

async function pushOne(db: D1Database, cfg: DripConfig, a: CertAccess): Promise<'sent' | 'already' | 'failed'> {
  const key = certAccessClaimKey(a);
  const claim = await db
    .prepare(
      `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id, payload_json)
       VALUES (NULL, ?, 'system', ?, ?)`,
    )
    .bind(
      CLAIM_KIND,
      key,
      JSON.stringify({
        email: a.email,
        group: a.group,
        ends_on: a.endsOn,
        starts_on: a.startsOn,
        start_reason: a.startReason,
        product_slug: a.productSlug,
        purchased_on: a.purchasedOn,
      }),
    )
    .run();
  if ((claim.meta?.changes ?? 0) === 0) return 'already';

  try {
    await upsertSubscriber(cfg, {
      email: a.email,
      tags: [CERT_DRIP_TAGS[a.group]],
      custom_fields: { [CERT_END_FIELD]: a.endsOn, [CERT_START_FIELD]: a.startsOn },
    });
    const other: CertAccessGroup = a.group === 'end-2026' ? 'later' : 'end-2026';
    await removeTag(cfg, a.email, CERT_DRIP_TAGS[other]);
    return 'sent';
  } catch (err) {
    await db.prepare(`DELETE FROM events WHERE external_id = ? AND kind = ?`).bind(key, CLAIM_KIND).run();
    await logEventSafe(db, {
      registration_id: null,
      kind: 'cert.access.drip_error',
      source: 'system',
      payload: { email: a.email, ends_on: a.endsOn, error: String(err).slice(0, 500) },
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
};

// Push everyone not yet in Drip with their current end date, up to `cap`.
export async function runCertAccessDripSync(
  env: SyncEnv,
  opts: { cap?: number } = {},
): Promise<CertAccessSyncResult> {
  const cfg = dripConfig(env);
  if (!cfg) return { skipped: true, total: 0, sent: 0, failed: 0, remaining: 0 };

  const all = await listCertAccess(env.DB);
  const synced = await listSyncedCertKeys(env.DB);
  const pending = all.filter((a) => !synced.has(certAccessClaimKey(a)));
  const cap = opts.cap ?? DEFAULT_CAP;

  let sent = 0;
  let failed = 0;
  for (const a of pending.slice(0, cap)) {
    const r = await pushOne(env.DB, cfg, a);
    if (r === 'sent') sent++;
    if (r === 'failed') failed++;
    if (r !== 'already') await new Promise((res) => setTimeout(res, GAP_MS));
  }
  return { total: all.length, sent, failed, remaining: Math.max(0, pending.length - sent) };
}

// One buyer, right after a cert / path / 12-week purchase is fulfilled. Never
// throws — the hourly sweep picks up anything this misses.
export async function syncCertAccessForEmail(env: SyncEnv, email: string): Promise<void> {
  const cfg = dripConfig(env);
  if (!cfg) return;
  try {
    const a = await getCertAccessForEmail(env.DB, email);
    if (a) await pushOne(env.DB, cfg, a);
  } catch (err) {
    console.error('[cert-access] sync failed', String(err));
  }
}
