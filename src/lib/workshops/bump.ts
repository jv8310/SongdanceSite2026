// The order bump a workshop / masterclass offers — ONE resolver, shared by the
// registration pages, the checkout, both fulfilment paths and the Drip tagging,
// so what is advertised, what is charged, what is recorded in the purchase
// ledger and what access is granted can never disagree again.
//
// Why this exists. A workshop names its bump directly (`bump_product_id`); a
// calendar-synced masterclass never does (SYNC_MAPPINGS carries `bumpSlug:
// null`), so every caller had to apply its own default — and they drifted:
//
//   • calendar.ts (the /workshop registration calendar) defaulted to
//     `mantra-empower-bump` from 21 Jul 2026 …
//   • … while register.ts and paypal-fulfill.ts still defaulted to the old
//     `asj-bump` (€19, Drip tag prod_ASJ) …
//   • … and paid-handler's tagInDrip applied NO fallback at all, because it
//     gated on `workshop.bump_product_id` being set.
//
// So a masterclass buyer who ticked "Empowering You mantra pack — €9" was
// charged the ASJ bump's €19, recorded as ASJ in the ledger, and granted no
// product tag whatsoever: no mantra-pack email, nothing under "Your music" on
// /access, and a locked player. Everything now goes through here instead.

import { getProductById, getProductBySlug, type WorkshopProduct } from './db';

// The bump offered when a session doesn't name one of its own. Masterclasses
// are the only sessions that rely on it (see SYNC_MAPPINGS in calendar-sync.ts).
export const DEFAULT_BUMP_SLUG = 'mantra-empower-bump';

// A masterclass is any session whose ticket product slug contains
// "masterclass" — the same test the public pages classify by.
export function isMasterclassSlug(ticketSlug: string | null | undefined): boolean {
  return (ticketSlug ?? '').includes('masterclass');
}

type BumpWorkshop = { bump_product_id: number | null; main_product_id: number | null };

// The bump product id this session actually offers: its own, or the default for
// a masterclass that names none. Returns null when no bump applies.
//
// `ticketSlug` is the session's ticket product slug — pass it when the caller
// already has it (the calendar does) to save a lookup; pass `undefined` to have
// it resolved from `main_product_id`.
export async function resolveWorkshopBumpProductId(
  db: D1Database,
  workshop: BumpWorkshop,
  ticketSlug?: string | null,
): Promise<number | null> {
  if (workshop.bump_product_id) return workshop.bump_product_id;
  const slug =
    ticketSlug !== undefined
      ? ticketSlug
      : workshop.main_product_id
        ? ((await getProductById(db, workshop.main_product_id))?.slug ?? null)
        : null;
  if (!isMasterclassSlug(slug)) return null;
  const def = await getProductBySlug(db, DEFAULT_BUMP_SLUG);
  return def?.id ?? null;
}

// The resolved bump product row (name, price key, Drip tag), or null.
export async function resolveWorkshopBumpProduct(
  db: D1Database,
  workshop: BumpWorkshop,
  ticketSlug?: string | null,
): Promise<WorkshopProduct | null> {
  const id = await resolveWorkshopBumpProductId(db, workshop, ticketSlug);
  if (!id) return null;
  return (await getProductById(db, id)) ?? null;
}

// SQL fragment: "the session `r.workshop_id` offers this bump product".
// Mirrors resolveWorkshopBumpProductId — the session's own bump, or the
// default for a masterclass that names none — so a D1 sweep and the TypeScript
// resolver classify a registration identically.
//
// Binds the bump product id TWICE: once against the session's own bump, once to
// confirm the caller is asking about the default bump before the masterclass
// fallback can speak for it.
// A bump product's Drip tag as SQL — the same expression workshopDripTags
// applies in code (`drip_tag`, falling back to `prod_<slug>`), lowercased and
// trimmed for comparison.
const TAG_EXPR = (alias: string) =>
  `lower(trim(COALESCE(${alias}.drip_tag, 'prod_' || ${alias}.slug)))`;

// Every order-bump Drip tag this email has actually paid for, straight from D1.
//
// This is the local twin of "what does Drip say this subscriber holds", and it
// exists because Drip is not allowed to be a single point of failure for
// something a customer bought: `tagInDrip` is best-effort and never retried, so
// one API blip (or, before the fix above, a masterclass bump that was never
// tagged at all) permanently hid a paid album from /access and locked the
// player. Both signals mirror the ones that grant the tag in the first place:
//
//   • a recorded `workshop_purchases` line for a bump product, or
//   • `wants_bump` on a paid/coupon seat whose session offers that bump and
//     whose ledger holds no bump line at all (the coupon-seat case).
//
// Returns lowercased tags; empty on any error — this is an entitlement
// *fallback* and must never break the Drip path or fail a page render.
export async function workshopBumpTagsForEmail(
  db: D1Database,
  email: string,
): Promise<string[]> {
  try {
    const q = await db
      .prepare(
        `SELECT DISTINCT ${TAG_EXPR('wp')} AS tag
           FROM workshop_registrations r
           JOIN workshop_purchases p ON p.registration_id = r.id
           JOIN workshop_products wp ON wp.id = p.product_id
          WHERE lower(r.email) = ?
            AND r.payment_status IN ('paid', 'coupon')
            AND wp.type = 'bump'
          UNION
         SELECT DISTINCT COALESCE(${TAG_EXPR('bp')}, ${TAG_EXPR('dp')}) AS tag
           FROM workshop_registrations r
           JOIN workshops w ON w.id = r.workshop_id
           LEFT JOIN workshop_products bp ON bp.id = w.bump_product_id
           LEFT JOIN workshop_products mp ON mp.id = w.main_product_id
           LEFT JOIN workshop_products dp ON dp.slug = '${DEFAULT_BUMP_SLUG}'
          WHERE lower(r.email) = ?
            AND r.payment_status IN ('paid', 'coupon')
            AND r.wants_bump = 1
            AND NOT EXISTS (
              SELECT 1 FROM workshop_purchases p2
               WHERE p2.registration_id = r.id AND p2.product_type = 'bump'
            )
            AND (w.bump_product_id IS NOT NULL OR mp.slug LIKE '%masterclass%')`,
      )
      .bind(email.trim().toLowerCase(), email.trim().toLowerCase())
      .all<{ tag: string | null }>();
    return (q.results ?? []).map((r) => (r.tag ?? '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function workshopOffersBumpSql(): string {
  return `EXISTS (
            SELECT 1 FROM workshops w
              LEFT JOIN workshop_products mp ON mp.id = w.main_product_id
             WHERE w.id = r.workshop_id
               AND (
                 w.bump_product_id = ?
                 OR (
                   w.bump_product_id IS NULL
                   AND mp.slug LIKE '%masterclass%'
                   AND ? = (SELECT id FROM workshop_products WHERE slug = '${DEFAULT_BUMP_SLUG}')
                 )
               )
          )`;
}
