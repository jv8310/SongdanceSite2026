// Handing a music album over to its buyer — the player link, by email.
//
// Two ways in, one delivery:
//   • As an order bump on a workshop/masterclass ticket (the "Empowering You"
//     mantra pack) — src/lib/workshops/mantra-pack.ts.
//   • Bought on its own from /music/<album> (product slug `album-<id>`), which
//     rides the course machinery — sendAlbumPurchaseEmail below, called from
//     notifyCourseOrder so every fulfilment path covers it (Stripe webhook,
//     PayPal, free checkout, admin mark-paid, and the hourly reconcile).
//
// Both hand over the same kind of link: albumPlayerUrl() carries the buyer's
// own address as `?email=`, so /music/<album> signs them in and opens straight
// into the player instead of asking for an address we already know. The email
// IS the credential in this system (same as /access and the gate form), so the
// link grants nothing typing it wouldn't; entitlement is still re-checked on
// every page render, and the page redirects to the clean URL immediately so the
// address doesn't linger in the address bar or leak through a referrer.

import type { CourseRegistration } from '../courses/db';
import { logEvent } from '../registrations/db';
import { albumPurchaseEmail } from '../workshops/emails';
import { sendEmail } from '../workshops/resend';
import { albumCoverUrl, getAlbum, listTracks, type MusicAlbumRow } from './db';
import { albumIdFromProductSlug, isAlbumProductSlug } from './product';

const DEFAULT_BASE_URL = 'https://songdance.co';

type DeliveryEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  RESEND_REPLY_TO?: string;
  PUBLIC_BASE_URL?: string;
};

export function albumBaseUrl(env: { PUBLIC_BASE_URL?: string }): string {
  return (env.PUBLIC_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

// The one-click player link: /music/<album>?email=<buyer>. Without an email it
// degrades to the plain player URL (the page then asks, as it always did).
export function albumPlayerUrl(
  baseUrl: string,
  albumId: string,
  email?: string | null,
): string {
  const base = `${baseUrl.replace(/\/$/, '')}/music/${encodeURIComponent(albumId)}`;
  const e = (email ?? '').trim();
  return e ? `${base}?email=${encodeURIComponent(e)}` : base;
}

// Absolute cover URL for an email (inboxes can't resolve relative paths).
export function albumCoverEmailUrl(
  baseUrl: string,
  album: Pick<MusicAlbumRow, 'cover_key'>,
): string | null {
  const cover = albumCoverUrl(album);
  return cover ? `${baseUrl.replace(/\/$/, '')}${cover}` : null;
}

// Deliver a standalone album purchase. Buyer-facing and transactional (it *is*
// the product), so never suppression-gated. Idempotent on its own `events`
// claim, released on failure so a webhook redelivery or the hourly reconcile
// retries. Never throws into the caller — a delivery hiccup must not roll back
// a paid order.
export async function sendAlbumPurchaseEmail(
  env: DeliveryEnv,
  reg: CourseRegistration,
): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  if (!isAlbumProductSlug(reg.product_slug)) return;

  // Resolve before claiming: a missing album row means there's nothing to link
  // to, and not claiming leaves the door open for a later retry.
  let album: MusicAlbumRow | null = null;
  try {
    album = await getAlbum(env.DB, albumIdFromProductSlug(reg.product_slug));
  } catch {
    return; // tables not present yet (migrations land separately) — retry later
  }
  if (!album) return;

  const externalId = `album-delivery-${reg.id}`;
  let claimed = false;
  try {
    const r = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id)
         VALUES (NULL, 'album.delivery.sent', 'system', ?)`,
      )
      .bind(externalId)
      .run();
    claimed = (r.meta?.changes ?? 0) > 0;
    if (!claimed) return; // already delivered for this order

    const base = albumBaseUrl(env);
    const tracks = await listTracks(env.DB, album.id);
    const content = albumPurchaseEmail({
      name: reg.first_name,
      loginEmail: reg.email,
      albumTitle: album.title,
      albumDescription: album.description,
      albumUrl: albumPlayerUrl(base, album.id, reg.email),
      trackTitles: tracks.map((t) => t.title),
      coverUrl: albumCoverEmailUrl(base, album),
    });
    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      replyTo: env.RESEND_REPLY_TO,
      to: reg.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      entityRefId: externalId,
      track: { db: env.DB, type: 'album_delivery' },
    });
  } catch (err) {
    if (claimed) {
      await env.DB
        .prepare(`DELETE FROM events WHERE external_id = ? AND kind = 'album.delivery.sent'`)
        .bind(externalId)
        .run()
        .catch(() => {});
    }
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'album.delivery.error',
      source: 'system',
      payload: { course_registration_id: reg.id, error: String(err) },
    }).catch(() => {});
  }
}
