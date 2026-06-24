// Meta Conversions API for course purchases — the courses mirror of
// src/lib/workshops/meta.ts. Reuses that file's `sendPurchaseEvent` (one CAPI
// client) and only adds the course-specific bits: a deterministic per-
// registration event id and a thin wrapper that maps a CourseRegistration onto
// the Purchase payload, tagging it with the product's catalog content_id.
//
// The deterministic event_id is shared by this server send and the browser
// Pixel Purchase on the course thank-you page, so Meta folds the two into one
// event (the browser send brings fbp/fbc/IP/UA; the server send is the reliable
// backstop when the Pixel is blocked or the tab is closed).

import { sendPurchaseEvent } from '../workshops/meta';
import { catalogContentId } from '../catalog/products';
import type { CourseRegistration } from './db';

export type CourseMetaEnv = {
  META_PIXEL_ID?: string;
  META_ACCESS_TOKEN?: string;
  PUBLIC_BASE_URL?: string;
};

// Deterministic Purchase event_id for a course registration. Mirrors the
// workshop `wpur-` scheme. Used identically by the browser Pixel and this
// server CAPI so Meta deduplicates the two Purchase hits into one.
export function coursePurchaseEventId(registrationId: number): string {
  return `cpur-${registrationId}`;
}

// Send the server-side Purchase for a paid course registration. Best-effort:
// callers wrap this in their own guard + try/catch (it throws on a non-2xx so
// the caller can log it). The product_slug doubles as the catalog content_id
// (see src/lib/catalog/products.ts) — for the two journey bundles it has no
// catalog item, which is harmless: the Purchase still records, it just doesn't
// bind to a catalog product.
export async function sendCoursePurchaseEvent(
  env: CourseMetaEnv,
  reg: CourseRegistration,
): Promise<void> {
  if (!env.META_PIXEL_ID || !env.META_ACCESS_TOKEN) return;
  await sendPurchaseEvent(
    { pixelId: env.META_PIXEL_ID, accessToken: env.META_ACCESS_TOKEN },
    {
      eventId: coursePurchaseEventId(reg.id),
      email: reg.email,
      value: reg.amount_cents / 100,
      currency: reg.currency,
      orderId: `creg-${reg.id}`,
      // Fold variant slugs (cc-bundle, asj-pro) to their canonical catalog id.
      contentIds: [catalogContentId(reg.product_slug)],
      // Server-to-server call from the webhook — no real visitor IP/UA; the
      // browser send carries those. We still pass a true event_source_url.
      eventSourceUrl: env.PUBLIC_BASE_URL
        ? `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/courses`
        : undefined,
    },
  );
}
