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
//   • Auth — EITHER a static token OR a client id + secret we exchange for one:
//       · SHOPIFY_ADMIN_TOKEN                    — a permanent Admin API token, OR
//       · SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET — the app's credentials; we
//         mint a short-lived token via the client-credentials grant per call
//         (some Shopify apps only expose this — no copyable, non-expiring token).
//       Either way the token/app needs the write_draft_orders scope.
//   • SHOPIFY_DECK_PRODUCT_ID  — the Songdeck product id (numeric, e.g. from the
//                                admin URL /admin/products/<id>, or a product gid).
//                                The Songdeck is the only product with no variants,
//                                so its single default variant is resolved for us.
//   • SHOPIFY_DECK_VARIANT_ID  — optional: pin the variant id directly instead
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
  // Auth — either a static Admin API token, OR a client id + secret that we
  // exchange for a short-lived token on demand (Shopify's client-credentials
  // grant, whose tokens expire ~24h). The token override wins when both are set.
  SHOPIFY_ADMIN_TOKEN?: string;
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_API_VERSION?: string;
  SHOPIFY_DECK_PRODUCT_ID?: string;
  SHOPIFY_DECK_VARIANT_ID?: string;
};

// Auth is present when there's a static token OR a client id + secret to mint one.
function hasShopifyAuth(env: ShopifyEnv): boolean {
  return !!(
    (env.SHOPIFY_ADMIN_TOKEN ?? '').trim() ||
    ((env.SHOPIFY_CLIENT_ID ?? '').trim() && (env.SHOPIFY_CLIENT_SECRET ?? '').trim())
  );
}

export function shopifyConfigured(env: ShopifyEnv): boolean {
  return !!(
    (env.SHOPIFY_STORE_DOMAIN ?? '').trim() &&
    hasShopifyAuth(env) &&
    ((env.SHOPIFY_DECK_PRODUCT_ID ?? '').trim() || (env.SHOPIFY_DECK_VARIANT_ID ?? '').trim())
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

function shopDomain(env: ShopifyEnv): string {
  return (env.SHOPIFY_STORE_DOMAIN ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

// Resolve an Admin API access token. A static SHOPIFY_ADMIN_TOKEN wins; otherwise
// exchange the client id + secret for one via Shopify's client-credentials grant
// (POST /admin/oauth/access_token). Those tokens expire (~24h), so we mint a
// fresh one per fulfilment call rather than store it — deck-gift orders are
// low-volume, so this is at most a couple of extra token requests per event and
// never a token sitting in the database. Throws when no auth is configured or the
// exchange fails (the caller falls back to the coupon claim email).
async function shopifyAdminToken(env: ShopifyEnv): Promise<string> {
  const staticToken = (env.SHOPIFY_ADMIN_TOKEN ?? '').trim();
  if (staticToken) return staticToken;

  const clientId = (env.SHOPIFY_CLIENT_ID ?? '').trim();
  const clientSecret = (env.SHOPIFY_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('Shopify auth not configured (need SHOPIFY_ADMIN_TOKEN or client id + secret)');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(`https://${shopDomain(env)}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shopify token HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const token = JSON.parse(text)?.access_token;
  if (!token || typeof token !== 'string') {
    throw new Error('Shopify token exchange returned no access_token');
  }
  return token;
}

async function shopifyGraphQL(
  env: ShopifyEnv,
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<any> {
  const version = (env.SHOPIFY_API_VERSION ?? '').trim() || DEFAULT_API_VERSION;
  const res = await fetch(`https://${shopDomain(env)}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
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

const DECK_VARIANT_QUERY = `
query deckVariant($id: ID!) {
  product(id: $id) { variants(first: 1) { nodes { id } } }
}`;

// A draft-order line item needs a variant id. The Songdeck is the only Shopify
// product without variants, so rather than make the owner dig out a variant id
// we take the (easy-to-find) product id and resolve its single default variant.
// An explicit SHOPIFY_DECK_VARIANT_ID still wins if set. Throws when neither
// resolves — the caller catches it and falls back to the coupon claim email.
async function resolveDeckVariantId(env: ShopifyEnv, token: string): Promise<string> {
  const variantRaw = (env.SHOPIFY_DECK_VARIANT_ID ?? '').trim();
  if (variantRaw) return variantGid(variantRaw);

  const productRaw = (env.SHOPIFY_DECK_PRODUCT_ID ?? '').trim();
  if (!productRaw) throw new Error('Set SHOPIFY_DECK_PRODUCT_ID (or SHOPIFY_DECK_VARIANT_ID)');
  const productGid = productRaw.startsWith('gid://')
    ? productRaw
    : `gid://shopify/Product/${productRaw.replace(/[^0-9]/g, '')}`;
  const data = await shopifyGraphQL(env, token, DECK_VARIANT_QUERY, { id: productGid });
  const id: string | undefined = data?.product?.variants?.nodes?.[0]?.id;
  if (!id) throw new Error(`Shopify product ${productGid} has no variant to order`);
  return id;
}

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

    // Mint (or read the static) token once and reuse it for every call below.
    const token = await shopifyAdminToken(env);
    const variantId = await resolveDeckVariantId(env, token);
    const input = {
      email: reg.email,
      note: `Songdeck gift — course registration #${reg.id} (${reg.email})`,
      tags: [DECK_GIFT_COUPON_CODE, 'songdeck-gift', 'svh-course'],
      useCustomerDefaultAddress: false,
      lineItems: [{ variantId, quantity: 1 }],
      appliedDiscount: {
        title: DECK_GIFT_COUPON_CODE,
        description: 'Post-workshop Songdeck gift',
        valueType: 'PERCENTAGE',
        value: 100.0,
      },
      shippingLine: { title: 'Free worldwide shipping', price: '0' },
      shippingAddress: mailingAddress(ship),
    };

    const created = await shopifyGraphQL(env, token, DRAFT_ORDER_CREATE, { input });
    const createErr = created?.draftOrderCreate?.userErrors ?? [];
    if (createErr.length) {
      throw new Error(`draftOrderCreate: ${JSON.stringify(createErr).slice(0, 300)}`);
    }
    const draftId: string | undefined = created?.draftOrderCreate?.draftOrder?.id;
    if (!draftId) throw new Error('draftOrderCreate returned no draft order id');

    const completed = await shopifyGraphQL(env, token, DRAFT_ORDER_COMPLETE, { id: draftId });
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
