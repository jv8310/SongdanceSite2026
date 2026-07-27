// Delivery of the "Empowering You" mantra pack — the €9 order bump on the
// workshop / masterclass checkout (product `mantra-empower-bump`, migration
// 0076).
//
// The bump has always applied its Drip tag (`prod_MantraEmpower`) on payment,
// which is what opens the gated album player at /music/<album> — but no email
// ever told the buyer that, so the pack arrived silently. This module is that
// email: it resolves the bump to its published music album, and sends the
// buyer the player link plus the address that opens it.
//
// Two paths, one idempotent send per buyer:
//   • Live — runWorkshopPaidSideEffects calls deliverMantraPack() right after
//     the confirmation, so a new buyer gets it within seconds of paying.
//   • Backfill / safety net — runMantraPackBackfill() sweeps every paid
//     registration that carries the bump and has no send on record, so the
//     people who already bought it are caught up, and a dropped live send is
//     picked up on a later tick. Wired into the 5-minute cron; self-stopping
//     (an empty sweep costs one indexed query).
//
// Guards that matter:
//   • Every send is claimed atomically on (registration_id, 'mantra_pack') —
//     the same primitive the reminder cadence uses — and the claim is released
//     if the send throws, so a transient Resend error retries instead of
//     swallowing the email.
//   • Deduped by EMAIL, not just registration: someone who took the bump on
//     two different sessions gets one email, not two (the second registration
//     still claims its slot, so it never comes back around).
//   • No album, no send. If no *published* album carries the bump's Drip tag
//     there is nothing to link to, so the sweep no-ops and retries later
//     rather than mailing people a dead end.
//   • Transactional — part of something they paid for — so it ignores the
//     marketing suppression list, exactly like the seat confirmation.

import { logEvent } from '../registrations/db';
import {
  albumCoverUrl,
  albumUrl,
  listAlbumsForTags,
  listTracks,
  type MusicAlbumRow,
} from '../music/db';
import {
  claimNotification,
  getProductBySlug,
  getRegistrationById,
  releaseNotification,
  type WorkshopRegistration,
} from './db';
import { mantraPackEmail } from './emails';
import { sendEmail } from './resend';

// The order-bump product this delivers. Set on every calendar-synced workshop
// by migration 0076.
export const MANTRA_BUMP_SLUG = 'mantra-empower-bump';

// The notification slot (workshop_sent_notifications.type) — one per buyer.
export const MANTRA_PACK_NOTIFICATION = 'mantra_pack';

// Per-tick volume for the catch-up sweep. 40 × 600ms ≈ 24s of single Resend
// sends: inside the 5-minute tick and well under Resend's ~2 req/s.
const MAX_PER_TICK = 40;
const GAP_MS = 600;

type MantraEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  RESEND_REPLY_TO?: string;
  PUBLIC_BASE_URL: string;
} & Record<string, unknown>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type MantraPackTarget = {
  productId: number;
  album: MusicAlbumRow;
  trackTitles: string[];
};

// Resolve the bump product → the published album its Drip tag opens. Returns
// null when the product is missing, carries no tag, or no published album
// matches it — i.e. when there is nothing we could honestly link to.
export async function resolveMantraPackTarget(
  db: D1Database,
): Promise<MantraPackTarget | null> {
  const product = await getProductBySlug(db, MANTRA_BUMP_SLUG);
  if (!product) return null;
  const tag = (product.drip_tag ?? '').trim();
  if (!tag) return null;
  const albums = await listAlbumsForTags(db, [tag]);
  const album = albums[0];
  if (!album) return null;
  const tracks = await listTracks(db, album.id);
  return {
    productId: product.id,
    album,
    trackTitles: tracks.map((t) => t.title),
  };
}

// Did this buyer's address already receive the pack on some OTHER registration?
// Keeps a repeat bump-buyer from being mailed the same album twice.
async function alreadySentToEmail(
  db: D1Database,
  email: string,
  exceptRegistrationId: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS one
         FROM workshop_sent_notifications n
         JOIN workshop_registrations r ON r.id = n.registration_id
        WHERE n.type = ?
          AND n.registration_id != ?
          AND lower(r.email) = lower(?)
        LIMIT 1`,
    )
    .bind(MANTRA_PACK_NOTIFICATION, exceptRegistrationId, email)
    .first<{ one: number }>();
  return !!row;
}

// Does this registration actually carry the mantra bump? Two independent
// signals, because a coupon seat has no purchase ledger row:
//   • a recorded purchase line for the bump product — the ledger, written by
//     both the Stripe and the PayPal path at payment; or
//   • the intent flag, when the registration's workshop offers exactly this
//     product as its bump AND the ledger holds no bump line at all.
//
// That last clause matters. Migration 0076 repointed every *upcoming* workshop
// from the old ASJ bump onto the mantra pack, so a session that has since taken
// place can name the mantra pack today while its earlier buyers actually bought
// the ASJ bump. Their ledger line names ASJ and settles it — intent only speaks
// when nothing was recorded, which is exactly the coupon-seat case. It is also
// the same pair of signals workshopDripTags uses to grant `prod_MantraEmpower`,
// so this email can never disagree with the access the buyer already holds.
async function registrationHasMantraBump(
  db: D1Database,
  reg: WorkshopRegistration,
  productId: number,
): Promise<boolean> {
  const row = await db
    .prepare(bumpBuyerPredicate('SELECT 1 AS one FROM workshop_registrations r WHERE r.id = ? AND ') + ' LIMIT 1')
    .bind(reg.id, productId, productId)
    .first<{ one: number }>();
  return !!row;
}

// Shared "this registration carries the mantra bump" predicate, so the
// per-registration check and the sweep can never drift apart.
function bumpBuyerPredicate(prefix: string): string {
  return `${prefix}(
            EXISTS (
              SELECT 1 FROM workshop_purchases p
               WHERE p.registration_id = r.id AND p.product_id = ?
            )
            OR (
              r.wants_bump = 1
              AND NOT EXISTS (
                SELECT 1 FROM workshop_purchases p2
                 WHERE p2.registration_id = r.id AND p2.product_type = 'bump'
              )
              AND EXISTS (
                SELECT 1 FROM workshops w
                 WHERE w.id = r.workshop_id AND w.bump_product_id = ?
              )
            )
          )`;
}

async function deliver(
  env: MantraEnv,
  reg: WorkshopRegistration,
  target: MantraPackTarget,
  entityRefId: string,
) {
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const cover = albumCoverUrl(target.album);
  const content = mantraPackEmail({
    name: reg.name,
    loginEmail: reg.email,
    albumTitle: target.album.title,
    albumUrl: `${base}${albumUrl(target.album)}`,
    trackTitles: target.trackTitles,
    coverUrl: cover ? `${base}${cover}` : null,
  });
  await sendEmail({
    apiKey: env.RESEND_API_KEY!,
    replyTo: env.RESEND_REPLY_TO,
    to: reg.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    entityRefId,
    track: { db: env.DB, type: MANTRA_PACK_NOTIFICATION, registrationId: reg.id },
  });
}

export type MantraDeliveryResult =
  | 'sent'
  | 'already_sent' // slot was claimed by an earlier run
  | 'deduped' // same buyer already got it on another registration
  | 'no_bump' // this registration didn't take the bump
  | 'not_paid'
  | 'not_configured' // no Resend key, or no published album for the tag
  | 'not_found';

// Send the pack for ONE registration. Safe to call on every paid side-effect
// run and from the sweep — the claim makes it a no-op after the first send.
export async function deliverMantraPack(
  env: MantraEnv,
  registrationId: number,
  target?: MantraPackTarget | null,
): Promise<MantraDeliveryResult> {
  if (!env.RESEND_API_KEY) return 'not_configured';
  const reg = await getRegistrationById(env.DB, registrationId);
  if (!reg) return 'not_found';
  if (reg.payment_status !== 'paid' && reg.payment_status !== 'coupon') return 'not_paid';

  const resolved = target ?? (await resolveMantraPackTarget(env.DB));
  if (!resolved) return 'not_configured';

  if (!(await registrationHasMantraBump(env.DB, reg, resolved.productId))) return 'no_bump';

  // Atomic claim — only the first caller sends.
  const claimed = await claimNotification(env.DB, reg.id, MANTRA_PACK_NOTIFICATION);
  if (!claimed) return 'already_sent';

  // Same person, second bump purchase: keep the claim (so it never comes back
  // around) but don't mail them the same album again.
  if (await alreadySentToEmail(env.DB, reg.email, reg.id)) return 'deduped';

  try {
    await deliver(env, reg, resolved, `mantra-pack-${reg.id}`);
  } catch (err) {
    // Release so a later tick retries rather than the claim swallowing it.
    await releaseNotification(env.DB, reg.id, MANTRA_PACK_NOTIFICATION).catch(() => {});
    throw err;
  }
  return 'sent';
}

export type MantraBackfillResult = {
  skipped?: boolean;
  reason?: string;
  sent: number;
  deduped: number;
  failed: number;
  remaining: number;
};

// How many paid bump buyers are still waiting for the email? Drives the
// admin panel's "N waiting" line.
export async function pendingMantraPackCount(
  db: D1Database,
  productId: number,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM (${candidateSql('')}) x`)
    .bind(productId, productId, MANTRA_PACK_NOTIFICATION)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// Paid registrations carrying the bump with no send on record. Oldest first,
// so a big catch-up drains in purchase order.
function candidateSql(limitClause: string): string {
  return `${bumpBuyerPredicate(
    `SELECT r.id, r.email, r.name
            FROM workshop_registrations r
           WHERE r.payment_status IN ('paid', 'coupon')
             AND `,
  )}
             AND NOT EXISTS (
               SELECT 1 FROM workshop_sent_notifications n
                WHERE n.registration_id = r.id AND n.type = ?
             )
           ORDER BY r.id${limitClause}`;
}

// Catch-up sweep: mail every past bump buyer who never got the pack, paced and
// bounded per run. Idempotent — a drained list makes every later run a cheap
// no-op. Also acts as the safety net for a live send that failed.
export async function runMantraPackBackfill(
  env: MantraEnv,
  opts: { limit?: number } = {},
): Promise<MantraBackfillResult> {
  const idle = { sent: 0, deduped: 0, failed: 0, remaining: 0 };
  if (!env.RESEND_API_KEY) return { skipped: true, reason: 'no_resend_key', ...idle };

  let target: MantraPackTarget | null = null;
  try {
    target = await resolveMantraPackTarget(env.DB);
  } catch {
    // Tables not there yet (migrations land separately from the code deploy).
    return { skipped: true, reason: 'not_configured', ...idle };
  }
  // Nothing to link to → say nothing. Retried on the next tick.
  if (!target) return { skipped: true, reason: 'no_album', ...idle };

  const limit = Math.max(1, Math.min(opts.limit ?? MAX_PER_TICK, 200));
  let rows: Array<{ id: number; email: string; name: string | null }>;
  try {
    const q = await env.DB.prepare(candidateSql(' LIMIT ?'))
      .bind(target.productId, target.productId, MANTRA_PACK_NOTIFICATION, limit)
      .all<{ id: number; email: string; name: string | null }>();
    rows = q.results ?? [];
  } catch {
    return { skipped: true, reason: 'not_configured', ...idle };
  }
  if (!rows.length) return idle;

  let sent = 0;
  let deduped = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const outcome = await deliverMantraPack(env, row.id, target);
      if (outcome === 'sent') sent++;
      else if (outcome === 'deduped') deduped++;
    } catch (err) {
      failed++;
      await logEvent(env.DB, {
        registration_id: null,
        kind: 'workshop.mantra_pack.error',
        payload: { registration_id: row.id, error: String(err) },
      }).catch(() => {});
    }
    if (sent > 0) await sleep(GAP_MS);
  }

  const remaining = await pendingMantraPackCount(env.DB, target.productId).catch(() => 0);
  if (sent || deduped || failed) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'workshop.mantra_pack.backfill',
      payload: { sent, deduped, failed, remaining, album: target.album.id },
    }).catch(() => {});
  }
  return { sent, deduped, failed, remaining };
}
