// Song Deck gift — direct Shopify fulfilment through the Admin GraphQL API.
//
// When a course buyer secured the post-workshop gift and entered a shipping
// address at checkout, we place the free deck order on the Songdeck Shopify shop
// automatically instead of emailing them a coupon to self-order: a draft order
// for the deck variant with a 100% discount and a free shipping line, completed
// (payment_pending:false) into a paid €0 order that Shopify then fulfils/ships.
//
// Idempotent: the order claims a unique `events` row
// (external_id `deck-gift-shopify-<regId>`, kind `deck.gift.shopify.created`)
// before creating anything, so every fulfilment path (Stripe webhook, PayPal,
// free checkout, admin mark-paid, hourly reconcile) can call this and only the
// first wins. A failure releases the claim (so a later reconcile retries) and
// the caller falls back to the SVH-BONUS claim email.
//
// No-ops entirely until the secrets are set, so deploying it changes nothing
// until the owner provisions the Shopify custom-app credentials:
//   • SHOPIFY_STORE_DOMAIN     — the *.myshopify.com admin domain (NOT songdeck.shop)
//   • SHOPIFY_ADMIN_TOKEN      — an Admin API access token with write_draft_orders
//   • SHOPIFY_DECK_VARIANT_ID  — the deck product's variant id (numeric or gid)
//   • SHOPIFY_API_VERSION      — optional Graph version override (default 2024-10)

import type { CourseRegistration } from '../courses/db';
import { parsePurchasedBumps } from '../courses/db';
import {
  DECK_GIFT_BUMP_SLUG,
  DECK_GIFT_COUPON_CODE,
  parseDeckGiftShipping,
  type DeckGiftShipping,
} from '../courses/deck-promo';
import { logEvent } from '../registrations/db';

const DEFAULT_API_VERSION = '2024-10';

export type ShopifyEnv = {
  DB: D1Database;
  SHOPIFY_STORE_DOMAIN?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
  SHOPIFY_API_VERSION?: string;
  SHOPIFY_DECK_VARIANT_ID?: string;
};

export function shopifyConfigured(env: ShopifyEnv): boolean {
  return !!(
    (env.SHOPIFY_STORE_DOMAIN ?? '').trim() &&
    (env.SHOPIFY_ADMIN_TOKEN ?? '').trim() &&
    (env.SHOPIFY_DECK_VARIANT_ID ?? '').trim()
  );
}

export type DeckGiftShopifyResult =
  | { status: 'skipped'; reason: string }
  | { status: 'already' }
  | { status: 'placed'; orderName: string; orderGid: string }
  | { status: 'failed'; error: string };

// Country codes whose subdivisions Shopify validates as province codes and where
// Google returns a matching short code. Elsewhere we omit the province so an
// unrecognised value can't reject the mutation (city + zip + country still ship).
const PROVINCE_CODE_COUNTRIES = new Set(['US', 'CA', 'AU']);

function variantGid(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('gid://')) return v;
  const digits = v.replace(/[^0-9]/g, '');
  return `gid://shopify/ProductVariant/${digits}`;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: full.trim(), lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function mailingAddress(ship: DeckGiftShipping): Record<string, unknown> {
  const { firstName, lastName } = splitName(ship.name);
  const country = ship.country.trim().toUpperCase();
  const regionCode = ship.region.trim().toUpperCase();
  const addr: Record<string, unknown> = {
    firstName,
    lastName,
    address1: ship.line1,
    city: ship.city,
    countryCode: country || null,
  };
  if (ship.line2) addr.address2 = ship.line2;
  if (ship.postal_code) addr.zip = ship.postal_code;
  if (ship.phone) addr.phone = ship.phone;
  if (
    PROVINCE_CODE_COUNTRIES.has(country) &&
    /^[A-Z]{1,3}$/.test(regionCode)
  ) {
    addr.provinceCode = regionCode;
  }
  return addr;
}

async function shopifyGraphQL(
  env: ShopifyEnv,
  query: string,
  variables: Record<string, unknown>,
): Promise<any> {
  const domain = (env.SHOPIFY_STORE_DOMAIN ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const version = (env.SHOPIFY_API_VERSION ?? '').trim() || DEFAULT_API_VERSION;
  const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': (env.SHOPIFY_ADMIN_TOKEN ?? '').trim(),
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text);
  if (json.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.data;
}

const DRAFT_ORDER_CREATE = `
mutation deckGiftDraftCreate($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder { id }
    userErrors { field message }
  }
}`;

const DRAFT_ORDER_COMPLETE = `
mutation deckGiftDraftComplete($id: ID!) {
  draftOrderComplete(id: $id, paymentPending: false) {
    draftOrder { id order { id name } }
    userErrors { field message }
  }
}`;

async function claim(db: D1Database, externalId: string): Promise<boolean> {
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id)
       VALUES (NULL, 'deck.gift.shopify.created', 'system', ?)`,
    )
    .bind(externalId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

async function release(db: D1Database, externalId: string): Promise<void> {
  await db
    .prepare(`DELETE FROM events WHERE external_id = ? AND kind = 'deck.gift.shopify.created'`)
    .bind(externalId)
    .run();
}

// Place the free deck order for a paid course registration that carries the gift
// and a shipping address. Never throws; returns a status the caller routes on
// (a 'failed'/'skipped'-without-address result → send the coupon claim email).
export async function placeDeckGiftShopifyOrder(
  env: ShopifyEnv,
  reg: CourseRegistration,
): Promise<DeckGiftShopifyResult> {
  if (!shopifyConfigured(env)) return { status: 'skipped', reason: 'not_configured' };

  const hasGift = parsePurchasedBumps(reg.bumps).some((b) => b.slug === DECK_GIFT_BUMP_SLUG);
  if (!hasGift) return { status: 'skipped', reason: 'no_gift' };

  const ship = parseDeckGiftShipping(reg.deck_gift_shipping);
  if (!ship) return { status: 'skipped', reason: 'no_address' };

  const externalId = `deck-gift-shopify-${reg.id}`;
  let claimed = false;
  try {
    claimed = await claim(env.DB, externalId);
    if (!claimed) return { status: 'already' };

    const input = {
      email: reg.email,
      note: `Song Deck gift — course registration #${reg.id} (${reg.email})`,
      tags: [DECK_GIFT_COUPON_CODE, 'song-deck-gift', 'svh-course'],
      useCustomerDefaultAddress: false,
      lineItems: [{ variantId: variantGid(env.SHOPIFY_DECK_VARIANT_ID as string), quantity: 1 }],
      appliedDiscount: {
        title: DECK_GIFT_COUPON_CODE,
        description: 'Post-workshop Song Deck gift',
        valueType: 'PERCENTAGE',
        value: 100.0,
      },
      shippingLine: { title: 'Free worldwide shipping', price: '0' },
      shippingAddress: mailingAddress(ship),
    };

    const created = await shopifyGraphQL(env, DRAFT_ORDER_CREATE, { input });
    const createErr = created?.draftOrderCreate?.userErrors ?? [];
    if (createErr.length) {
      throw new Error(`draftOrderCreate: ${JSON.stringify(createErr).slice(0, 300)}`);
    }
    const draftId: string | undefined = created?.draftOrderCreate?.draftOrder?.id;
    if (!draftId) throw new Error('draftOrderCreate returned no draft order id');

    const completed = await shopifyGraphQL(env, DRAFT_ORDER_COMPLETE, { id: draftId });
    const completeErr = completed?.draftOrderComplete?.userErrors ?? [];
    if (completeErr.length) {
      throw new Error(`draftOrderComplete: ${JSON.stringify(completeErr).slice(0, 300)}`);
    }
    const order = completed?.draftOrderComplete?.draftOrder?.order;
    const orderGid: string = order?.id ?? draftId;
    const orderName: string = order?.name ?? '(order)';

    await logEvent(env.DB, {
      registration_id: null,
      kind: 'deck.gift.shopify.completed',
      source: 'system',
      external_id: `deck-gift-shopify-done-${reg.id}`,
      payload: {
        course_registration_id: reg.id,
        order_gid: orderGid,
        order_name: orderName,
        email: reg.email,
        ship_to: `${ship.city}, ${ship.country}`,
      },
    }).catch(() => {});

    return { status: 'placed', orderName, orderGid };
  } catch (err) {
    // Release the claim so a later reconcile can retry, and let the caller fall
    // back to the coupon claim email.
    if (claimed) await release(env.DB, externalId).catch(() => {});
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'deck.gift.shopify.error',
      source: 'system',
      payload: { course_registration_id: reg.id, error: String(err) },
    }).catch(() => {});
    return { status: 'failed', error: String(err) };
  }
}
