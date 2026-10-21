// Song Deck gift — direct Shopify fulfilment through the Admin GraphQL API.
//
// When a course buyer secured the post-workshop gift and entered a shipping
// address at checkout, we place the free deck order on the Songdeck Shopify shop
// automatically instead of emailing them a coupon to self-order: a draft order
// for the deck variant with a 100% discount and a free shipping line, completed
// (payment_pending:false) into a paid €0 order that Shopify then fulfils/ships.
//
// The shipping line carries the shop's OWN method for the address (Buspakje
// Nederland, EU Letterbox, Europe Letterbox, UK Letterbox, World Letterbox, …),
// asked of Shopify with draftOrderCalculate, at €0. Until October 2026 every gift
// went out as a made-up "Free worldwide shipping", which the warehouse can't map
// to a parcel service. See deckGiftShippingLine.
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
  | { status: 'placed'; orderName: string; orderGid: string; shippingMethod: string }
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
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'Songdance-Worker',
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    // An HTML "Verifying your connection…" body (not JSON) means we hit a
    // bot-protected page — almost always the public storefront instead of the
    // *.myshopify.com admin domain. Flag that plainly.
    const looksLikeChallenge = /<html|verifying your connection|<!doctype/i.test(text);
    const detail = looksLikeChallenge
      ? 'a bot-challenge HTML page (not the OAuth endpoint) — SHOPIFY_STORE_DOMAIN is very likely the public storefront (songdeck.shop) instead of the *.myshopify.com admin domain'
      : text.slice(0, 200);
    throw new Error(`Shopify token HTTP ${res.status}: ${detail}`);
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
      'User-Agent': 'Songdance-Worker',
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

// Deliberately does NOT read back the completed `order` field — that requires
// the read_orders scope, which the gift app doesn't need. Completing the draft
// only needs write_draft_orders; we just take the draft id back.
const DRAFT_ORDER_COMPLETE = `
mutation deckGiftDraftComplete($id: ID!) {
  draftOrderComplete(id: $id, paymentPending: false) {
    draftOrder { id name }
    userErrors { field message }
  }
}`;

const DRAFT_ORDER_CALCULATE = `
mutation deckGiftDraftCalculate($input: DraftOrderInput!) {
  draftOrderCalculate(input: $input) {
    calculatedDraftOrder { availableShippingRates { handle title price { amount } } }
    userErrors { field message }
  }
}`;

// The title the shipping line used before it followed the shop's own methods,
// and still the fallback when Shopify offers no rate for the address.
const FALLBACK_SHIPPING_TITLE = 'Free worldwide shipping';

// The shipping line for a gift: the method the shop itself offers for this
// address, by its own title, at €0. We ask Shopify for the rates a paying
// customer would be shown (the order WITHOUT the gift discount, so a rate
// conditioned on the order's value still applies) and take the cheapest — each
// zone offers the deck one letterbox rate, and the cheapest is what a buyer
// picks. Only the title is taken, never the handle: a handle would charge the
// rate's price on an order we complete as paid. Never throws: a calculate that
// fails or offers nothing falls back to the old title, so the gift still ships.
async function deckGiftShippingLine(
  env: ShopifyEnv,
  token: string,
  input: Record<string, unknown>,
): Promise<{ title: string; price: string }> {
  try {
    return { title: await deckRateTitle(env, token, input), price: '0' };
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'deck.gift.shopify.shipping_fallback',
      source: 'system',
      payload: { error: String(err) },
    }).catch(() => {});
    return { title: FALLBACK_SHIPPING_TITLE, price: '0' };
  }
}

// The title of the cheapest rate the shop offers this draft (see above). Throws
// when Shopify refuses the calculation or offers no rate for the address.
async function deckRateTitle(
  env: ShopifyEnv,
  token: string,
  input: Record<string, unknown>,
): Promise<string> {
  const { appliedDiscount: _discount, shippingLine: _line, ...priced } = input;
  const data = await shopifyGraphQL(env, token, DRAFT_ORDER_CALCULATE, { input: priced });
  const errs = data?.draftOrderCalculate?.userErrors ?? [];
  if (errs.length) throw new Error(`draftOrderCalculate: ${JSON.stringify(errs).slice(0, 300)}`);
  const rates: Array<{ title?: string; price?: { amount?: string } }> =
    data?.draftOrderCalculate?.calculatedDraftOrder?.availableShippingRates ?? [];
  const best = rates
    .filter((r) => typeof r.title === 'string' && r.title.trim())
    .sort((a, b) => Number(a.price?.amount ?? 0) - Number(b.price?.amount ?? 0))[0];
  if (!best?.title) throw new Error('no shipping rate offered for this address');
  return best.title.trim();
}

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
      shippingAddress: mailingAddress(ship),
    };
    const shippingLine = await deckGiftShippingLine(env, token, input);

    const created = await shopifyGraphQL(env, token, DRAFT_ORDER_CREATE, {
      input: { ...input, shippingLine },
    });
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
    // We don't read the resulting order (needs read_orders); the completed draft
    // is enough to confirm success and to reference in the audit log.
    const draft = completed?.draftOrderComplete?.draftOrder;
    const orderGid: string = draft?.id ?? draftId;
    const orderName: string = draft?.name ?? '(draft)';

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
        shipping_method: shippingLine.title,
      },
    }).catch(() => {});

    return { status: 'placed', orderName, orderGid, shippingMethod: shippingLine.title };
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

// ── Admin self-test ─────────────────────────────────────────────────────────
// Verify the Shopify wiring from /admin without waiting for a real gift buyer.
// The default (place=false) is READ-ONLY: it mints a token and resolves the deck
// variant, which exercises the domain, auth (token or client id+secret), the
// write_draft_orders/read_products scopes, and the product id — the four things
// that usually go wrong — without creating anything. With place=true it creates
// a real €0 test order (tagged TEST) so the full path can be confirmed end to
// end; that order is safe to cancel in Shopify afterwards.
export type ShopifyPresence = {
  store_domain: boolean;
  admin_token: boolean;
  client_id: boolean;
  client_secret: boolean;
  deck_product_id: boolean;
  deck_variant_id: boolean;
};

// Which Shopify secrets the Worker actually sees (booleans only — never the
// values). Powers the admin test's "which var is missing?" diagnosis.
export function shopifyPresence(env: ShopifyEnv): ShopifyPresence {
  const has = (v: unknown) => !!(typeof v === 'string' ? v.trim() : v);
  return {
    store_domain: has(env.SHOPIFY_STORE_DOMAIN),
    admin_token: has(env.SHOPIFY_ADMIN_TOKEN),
    client_id: has(env.SHOPIFY_CLIENT_ID),
    client_secret: has(env.SHOPIFY_CLIENT_SECRET),
    deck_product_id: has(env.SHOPIFY_DECK_PRODUCT_ID),
    deck_variant_id: has(env.SHOPIFY_DECK_VARIANT_ID),
  };
}

// The ACTUAL env binding names the Worker exposes that mention "shopify" (names
// only, never values). Reveals a mis-typed secret name — a trailing space or a
// homoglyph — that the presence booleans can't (e.g. a binding actually called
// "SHOPIFY_CLIENT_ID " won't satisfy env.SHOPIFY_CLIENT_ID, but shows up here).
function shopifyEnvKeys(env: ShopifyEnv): string[] {
  try {
    return Object.keys(env as Record<string, unknown>)
      .filter((k) => /shopify/i.test(k))
      .sort();
  } catch {
    return [];
  }
}

export type DeckGiftTestResult = {
  ok: boolean;
  configured: boolean;
  // What the Worker sees (booleans only). Present on both success and the
  // not-configured error so the admin can spot exactly which secret is missing.
  present?: ShopifyPresence;
  // The real Shopify-related binding names the Worker exposes (names only).
  envKeys?: string[];
  shop?: string;
  variantId?: string;
  placed?: { orderName: string; orderGid: string; adminUrl: string; shippingMethod: string } | null;
  error?: string;
};

export async function testDeckGiftShopify(
  env: ShopifyEnv,
  opts: { place?: boolean; email?: string; address?: Partial<DeckGiftShipping> } = {},
): Promise<DeckGiftTestResult> {
  const present = shopifyPresence(env);
  if (!shopifyConfigured(env)) {
    // Name exactly which required secret the running Worker isn't seeing.
    const missing: string[] = [];
    if (!present.store_domain) missing.push('SHOPIFY_STORE_DOMAIN');
    if (!present.admin_token && !(present.client_id && present.client_secret)) {
      const authMissing = [
        !present.client_id ? 'SHOPIFY_CLIENT_ID' : null,
        !present.client_secret ? 'SHOPIFY_CLIENT_SECRET' : null,
      ].filter(Boolean);
      missing.push(
        authMissing.length
          ? authMissing.join(' + ')
          : 'SHOPIFY_ADMIN_TOKEN (or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET)',
      );
    }
    if (!present.deck_product_id && !present.deck_variant_id) {
      missing.push('SHOPIFY_DECK_PRODUCT_ID');
    }
    return {
      ok: false,
      configured: false,
      present,
      envKeys: shopifyEnvKeys(env),
      error: `This Worker isn't seeing: ${missing.join(', ')}. Set them on the songdance-site Worker and run this on production (songdance.co), not a *.workers.dev preview URL — preview versions don't carry the live secrets.`,
    };
  }
  const shop = shopDomain(env);
  try {
    const token = await shopifyAdminToken(env);
    const variantId = await resolveDeckVariantId(env, token);
    if (!opts.place) {
      return { ok: true, configured: true, present, shop, variantId, placed: null };
    }

    const ship: DeckGiftShipping = {
      name: (opts.address?.name ?? '').trim() || 'Songdance Test',
      line1: (opts.address?.line1 ?? '').trim() || 'Beaupréstraat 13',
      line2: (opts.address?.line2 ?? '').trim(),
      city: (opts.address?.city ?? '').trim() || 'Bruges',
      region: (opts.address?.region ?? '').trim(),
      postal_code: (opts.address?.postal_code ?? '').trim() || '8310',
      country: ((opts.address?.country ?? '').trim() || 'BE').toUpperCase(),
      phone: (opts.address?.phone ?? '').trim(),
      verified: false,
    };
    const input = {
      email: (opts.email ?? '').trim() || 'test@songdance.co',
      note: 'Songdeck gift — TEST order (safe to cancel)',
      tags: [DECK_GIFT_COUPON_CODE, 'songdeck-gift', 'svh-course', 'TEST'],
      useCustomerDefaultAddress: false,
      lineItems: [{ variantId, quantity: 1 }],
      appliedDiscount: {
        title: DECK_GIFT_COUPON_CODE,
        description: 'Songdeck gift — TEST',
        valueType: 'PERCENTAGE',
        value: 100.0,
      },
      shippingAddress: mailingAddress(ship),
    };
    const shippingLine = await deckGiftShippingLine(env, token, input);
    const created = await shopifyGraphQL(env, token, DRAFT_ORDER_CREATE, {
      input: { ...input, shippingLine },
    });
    const cErr = created?.draftOrderCreate?.userErrors ?? [];
    if (cErr.length) {
      return { ok: false, configured: true, shop, variantId, error: `draftOrderCreate: ${JSON.stringify(cErr)}` };
    }
    const draftId: string | undefined = created?.draftOrderCreate?.draftOrder?.id;
    if (!draftId) {
      return { ok: false, configured: true, shop, variantId, error: 'draftOrderCreate returned no draft order id' };
    }
    const completed = await shopifyGraphQL(env, token, DRAFT_ORDER_COMPLETE, { id: draftId });
    const compErr = completed?.draftOrderComplete?.userErrors ?? [];
    if (compErr.length) {
      return { ok: false, configured: true, shop, variantId, error: `draftOrderComplete: ${JSON.stringify(compErr)}` };
    }
    // We don't read the resulting order (needs read_orders) — link to the
    // completed draft order, which shows (and links to) the order it created.
    const draft = completed?.draftOrderComplete?.draftOrder;
    const draftGid: string = draft?.id ?? draftId;
    const orderName: string = draft?.name ?? '(draft)';
    const numId = String(draftGid).split('/').pop();
    const adminUrl = `https://${shop}/admin/draft_orders/${numId}`;
    return { ok: true, configured: true, shop, variantId, placed: { orderName, orderGid: draftGid, adminUrl, shippingMethod: shippingLine.title } };
  } catch (err) {
    const base = err instanceof Error ? err.message : String(err);
    // If the configured domain isn't a *.myshopify.com admin domain, that's the
    // usual root cause of an auth/challenge failure — say so explicitly.
    const domainHint = !/\.myshopify\.com$/i.test(shop)
      ? ` — SHOPIFY_STORE_DOMAIN is "${shop}", which is NOT a *.myshopify.com admin domain. Set it to your admin domain (e.g. songdeck.myshopify.com), not the public storefront (songdeck.shop).`
      : '';
    return { ok: false, configured: true, shop, envKeys: shopifyEnvKeys(env), error: base + domainHint };
  }
}

// ── Repair: gift orders placed with the wrong shipping method ───────────────
// Every gift placed before October 2026 went out as "Free worldwide shipping".
// This walks the gifts we placed (the deck.gift.shopify.completed log, which
// holds each one's draft order), works out the method the shop offers for that
// address today (the same deckRateTitle new gifts use), and — with apply —
// swaps the order's shipping line for that method at €0 through an order edit
// (no customer notification). Orders already fulfilled, cancelled or tagged
// TEST are left alone, and one whose line already reads right is skipped, so
// running it twice is harmless. Without apply it only reports.
//
// Needs two scopes the gift app did not need before: read_orders (to find the
// order a draft became and read its shipping line) and write_order_edits.
export type DeckGiftShippingFixRow = {
  registrationId: number;
  email: string;
  draftName: string | null;
  orderName: string | null;
  country: string | null;
  current: string | null;
  target: string | null;
  outcome: 'ok' | 'would_fix' | 'fixed' | 'skipped' | 'error';
  note?: string;
};

export type DeckGiftShippingFixResult = {
  ok: boolean;
  apply: boolean;
  rows: DeckGiftShippingFixRow[];
  error?: string;
};

const GIFT_DRAFT_ORDER_QUERY = `
query deckGiftDraft($id: ID!) {
  draftOrder(id: $id) {
    name
    order {
      id name tags cancelledAt displayFulfillmentStatus currencyCode
      shippingLine { title }
    }
  }
}`;

const ORDER_EDIT_BEGIN = `
mutation deckGiftEditBegin($id: ID!) {
  orderEditBegin(id: $id) {
    calculatedOrder { id shippingLines { id title stagedStatus } }
    userErrors { field message }
  }
}`;

const ORDER_EDIT_REMOVE_SHIPPING = `
mutation deckGiftEditRemoveShipping($id: ID!, $shippingLineId: ID!) {
  orderEditRemoveShippingLine(id: $id, shippingLineId: $shippingLineId) {
    calculatedOrder { id }
    userErrors { field message }
  }
}`;

const ORDER_EDIT_ADD_SHIPPING = `
mutation deckGiftEditAddShipping($id: ID!, $shippingLine: OrderEditAddShippingLineInput!) {
  orderEditAddShippingLine(id: $id, shippingLine: $shippingLine) {
    calculatedOrder { id }
    userErrors { field message }
  }
}`;

const ORDER_EDIT_COMMIT = `
mutation deckGiftEditCommit($id: ID!, $staffNote: String) {
  orderEditCommit(id: $id, notifyCustomer: false, staffNote: $staffNote) {
    order { id name }
    userErrors { field message }
  }
}`;

function scopeHint(err: unknown): string {
  const msg = String(err);
  return /access denied|required access|ACCESS_DENIED/i.test(msg)
    ? `${msg.slice(0, 200)} — give the Shopify app the read_orders and write_order_edits scopes (and release/install that version), then run this again.`
    : msg.slice(0, 300);
}

function userErrorsOf(data: any, field: string): string | null {
  const errs = data?.[field]?.userErrors ?? [];
  return errs.length ? `${field}: ${JSON.stringify(errs).slice(0, 300)}` : null;
}

async function swapShippingLine(
  env: ShopifyEnv,
  token: string,
  orderGid: string,
  title: string,
  currencyCode: string,
): Promise<void> {
  const begun = await shopifyGraphQL(env, token, ORDER_EDIT_BEGIN, { id: orderGid });
  const beginErr = userErrorsOf(begun, 'orderEditBegin');
  if (beginErr) throw new Error(beginErr);
  const calc = begun?.orderEditBegin?.calculatedOrder;
  if (!calc?.id) throw new Error('orderEditBegin returned no calculated order');

  const lines: Array<{ id?: string | null; stagedStatus?: string }> = calc.shippingLines ?? [];
  for (const line of lines) {
    if (!line.id || line.stagedStatus === 'REMOVED') continue;
    const removed = await shopifyGraphQL(env, token, ORDER_EDIT_REMOVE_SHIPPING, {
      id: calc.id,
      shippingLineId: line.id,
    });
    const removeErr = userErrorsOf(removed, 'orderEditRemoveShippingLine');
    if (removeErr) throw new Error(removeErr);
  }

  const added = await shopifyGraphQL(env, token, ORDER_EDIT_ADD_SHIPPING, {
    id: calc.id,
    shippingLine: { title, price: { amount: '0', currencyCode } },
  });
  const addErr = userErrorsOf(added, 'orderEditAddShippingLine');
  if (addErr) throw new Error(addErr);

  const committed = await shopifyGraphQL(env, token, ORDER_EDIT_COMMIT, {
    id: calc.id,
    staffNote: `Songdeck gift: shipping method set to "${title}" (was a generic free-shipping line).`,
  });
  const commitErr = userErrorsOf(committed, 'orderEditCommit');
  if (commitErr) throw new Error(commitErr);
}

export async function fixDeckGiftShipping(
  env: ShopifyEnv,
  opts: { apply?: boolean } = {},
): Promise<DeckGiftShippingFixResult> {
  const apply = opts.apply === true;
  if (!shopifyConfigured(env)) {
    return { ok: false, apply, rows: [], error: 'Shopify is not configured on this Worker.' };
  }

  const placed = await env.DB
    .prepare(
      `SELECT payload_json FROM events
        WHERE kind = 'deck.gift.shopify.completed'
        ORDER BY id`,
    )
    .all<{ payload_json: string | null }>();
  const gifts: Array<{ registrationId: number; draftGid: string; draftName: string | null }> = [];
  const seen = new Set<number>();
  for (const r of placed.results ?? []) {
    try {
      const p = JSON.parse(r.payload_json ?? '{}');
      const id = Number(p.course_registration_id);
      if (!Number.isFinite(id) || seen.has(id) || typeof p.order_gid !== 'string') continue;
      if (!p.order_gid.includes('/DraftOrder/')) continue;
      seen.add(id);
      gifts.push({ registrationId: id, draftGid: p.order_gid, draftName: p.order_name ?? null });
    } catch {
      /* a payload we can't read names no order */
    }
  }

  let token: string;
  let variantId: string;
  try {
    token = await shopifyAdminToken(env);
    variantId = await resolveDeckVariantId(env, token);
  } catch (err) {
    return { ok: false, apply, rows: [], error: String(err).slice(0, 300) };
  }

  const rows: DeckGiftShippingFixRow[] = [];
  for (const gift of gifts) {
    const reg = await env.DB
      .prepare(`SELECT email, deck_gift_shipping FROM course_registrations WHERE id = ?`)
      .bind(gift.registrationId)
      .first<{ email: string; deck_gift_shipping: string | null }>();
    const ship = parseDeckGiftShipping(reg?.deck_gift_shipping ?? null);
    const row: DeckGiftShippingFixRow = {
      registrationId: gift.registrationId,
      email: reg?.email ?? '',
      draftName: gift.draftName,
      orderName: null,
      country: ship?.country ?? null,
      current: null,
      target: null,
      outcome: 'skipped',
    };
    rows.push(row);
    try {
      const data = await shopifyGraphQL(env, token, GIFT_DRAFT_ORDER_QUERY, { id: gift.draftGid });
      const order = data?.draftOrder?.order;
      if (!order?.id) {
        row.note = 'the draft never became an order';
        continue;
      }
      row.orderName = order.name ?? null;
      row.current = order.shippingLine?.title ?? null;
      const tags: string[] = Array.isArray(order.tags) ? order.tags : [];
      if (tags.some((t) => t.toUpperCase() === 'TEST')) {
        row.note = 'test order';
        continue;
      }
      if (order.cancelledAt) {
        row.note = 'cancelled';
        continue;
      }
      if (order.displayFulfillmentStatus && order.displayFulfillmentStatus !== 'UNFULFILLED') {
        row.note = `already ${String(order.displayFulfillmentStatus).toLowerCase().replace(/_/g, ' ')}`;
        continue;
      }
      if (!ship) {
        row.note = 'no address on our side to price';
        continue;
      }
      row.target = await deckRateTitle(env, token, {
        email: row.email || undefined,
        lineItems: [{ variantId, quantity: 1 }],
        shippingAddress: mailingAddress(ship),
      });
      if (row.current === row.target) {
        row.outcome = 'ok';
        continue;
      }
      if (!apply) {
        row.outcome = 'would_fix';
        continue;
      }
      await swapShippingLine(env, token, order.id, row.target, order.currencyCode || 'EUR');
      row.outcome = 'fixed';
      await logEvent(env.DB, {
        registration_id: null,
        kind: 'deck.gift.shopify.shipping_fixed',
        source: 'admin',
        payload: {
          course_registration_id: gift.registrationId,
          order_name: row.orderName,
          from: row.current,
          to: row.target,
        },
      }).catch(() => {});
    } catch (err) {
      row.outcome = 'error';
      row.note = scopeHint(err);
    }
  }

  return { ok: rows.every((r) => r.outcome !== 'error'), apply, rows };
}
