// Drip integration: creates/updates a subscriber on payment and fires a
// "Completed retreat registration" event. Drip workflows listen for the event
// to send the confirmation email + any follow-up sequences — copy is edited
// inside Drip, not in code.
//
// Docs: https://developer.drip.com/

export type DripConfig = {
  apiToken: string;
  accountId: string;
};

type UpsertSubscriberInput = {
  email: string;
  first_name?: string;
  last_name?: string;
  country?: string | null;
  phone?: string | null;
  // IANA timezone (e.g. "Europe/Brussels"). Drip stores it as the subscriber's
  // native `time_zone`, which drives its local-time send scheduling. Null/blank
  // is omitted so a known timezone is never wiped by a later tz-less upsert.
  time_zone?: string | null;
  custom_fields?: Record<string, string | number | null>;
  tags?: string[];
};

function authHeader(cfg: DripConfig) {
  return `Basic ${btoa(`${cfg.apiToken}:`)}`;
}

function baseUrl(cfg: DripConfig) {
  return `https://api.getdrip.com/v2/${cfg.accountId}`;
}

export async function upsertSubscriber(cfg: DripConfig, input: UpsertSubscriberInput) {
  const body = {
    subscribers: [
      {
        email: input.email,
        first_name: input.first_name,
        last_name: input.last_name,
        country: input.country ?? undefined,
        phone: input.phone ?? undefined,
        time_zone: input.time_zone || undefined,
        custom_fields: scrubCustomFields(input.custom_fields ?? {}),
        tags: input.tags,
      },
    ],
  };
  const res = await fetch(`${baseUrl(cfg)}/subscribers`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(cfg),
      'Content-Type': 'application/vnd.api+json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Drip upsertSubscriber: ${res.status} ${await res.text()}`);
  }
}

export type DripSubscriber = {
  // Drip's internal subscriber id — used to build a deep link into the Drip
  // app (https://www.getdrip.com/<account>/subscribers/<id>).
  id?: string;
  email: string;
  first_name?: string;
  last_name?: string;
  country?: string;
  phone?: string;
  tags: string[];
  custom_fields: Record<string, string>;
};

// Look up a subscriber by email. Returns null when Drip 404s — the email
// has never been seen. Used by the course-page variant gate to decide
// which offer to show a returning vs. new visitor.
// This read sits on the synchronous request path of the certification "see
// your price" page, so a slow/stalled Drip must not hang the Worker until the
// edge kills it (which surfaces to the visitor as a hard "could not reach the
// server" error). Bound it with a timeout: on stall the fetch aborts and
// throws, and callers like `subscriber-status` fall back to the newcomer offer
// rather than failing the page.
const GET_SUBSCRIBER_TIMEOUT_MS = 8000;

export async function getSubscriber(
  cfg: DripConfig,
  email: string,
): Promise<DripSubscriber | null> {
  const res = await fetch(
    `${baseUrl(cfg)}/subscribers/${encodeURIComponent(email)}`,
    {
      method: 'GET',
      headers: {
        Authorization: authHeader(cfg),
        Accept: 'application/vnd.api+json',
      },
      signal: AbortSignal.timeout(GET_SUBSCRIBER_TIMEOUT_MS),
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Drip getSubscriber: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    subscribers?: Array<{
      id?: string;
      email: string;
      first_name?: string;
      last_name?: string;
      country?: string;
      phone?: string;
      tags?: string[];
      custom_fields?: Record<string, string>;
    }>;
  };
  const s = data.subscribers?.[0];
  if (!s) return null;
  return {
    id: s.id,
    email: s.email,
    first_name: s.first_name,
    last_name: s.last_name,
    country: s.country,
    phone: s.phone,
    tags: s.tags ?? [],
    custom_fields: s.custom_fields ?? {},
  };
}

// Apply a single tag to a subscriber. Drip creates the subscriber if the
// address is new, so this is safe to call for anyone who clicks a link in a
// send. Used by the promo-launch opt-out (`nopromo_June26`) — the tag lets a
// Drip segment exclude them from the launch campaign while keeping them on the
// general monthly list.
// POST /v2/:account_id/tags  { tags: [{ email, tag }] }
export async function applyTag(
  cfg: DripConfig,
  email: string,
  tag: string,
): Promise<void> {
  const res = await fetch(`${baseUrl(cfg)}/tags`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(cfg),
      'Content-Type': 'application/vnd.api+json',
    },
    body: JSON.stringify({ tags: [{ email, tag }] }),
  });
  if (!res.ok) {
    throw new Error(`Drip applyTag: ${res.status} ${await res.text()}`);
  }
}

export async function recordEvent(
  cfg: DripConfig,
  email: string,
  action: string,
  properties?: Record<string, string | number | null>,
) {
  const res = await fetch(`${baseUrl(cfg)}/events`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(cfg),
      'Content-Type': 'application/vnd.api+json',
    },
    body: JSON.stringify({
      events: [
        {
          email,
          action,
          properties: scrubCustomFields(properties ?? {}),
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Drip recordEvent: ${res.status} ${await res.text()}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Shopper Activity (ecommerce) — record an order so Drip natively tracks
//  the purchase and the subscriber's lifetime value.
//
//  Unlike the v2 events/subscribers endpoints above (vnd.api+json on /v2),
//  Shopper Activity is /v3, plain application/json, and requires a User-Agent.
//  An order is identified by (provider, order_id): re-sending the same
//  order_id UPDATES that order rather than creating a new one, so this is
//  naturally idempotent — webhook + admin double-fires, installment re-calls,
//  and the historical backfill all fold into a single order and never
//  double-count revenue. Drip derives "lifetime value" from these orders.
//  https://developer.drip.com/#orders
// ─────────────────────────────────────────────────────────────────────

// One stable provider name groups every Songdance order under one store in
// Drip. Order ids are namespaced per purchase type (retreat-/course-/workshop-)
// so they never collide across the three tables.
export const DRIP_ORDER_PROVIDER = 'songdance';
const DRIP_USER_AGENT = 'Songdance (https://songdance.co)';

export type DripOrderItem = {
  name: string; // required by Drip
  product_id?: string | null; // our product slug
  sku?: string | null;
  price?: number | null; // major units (per unit)
  quantity?: number | null;
  total?: number | null; // major units (line total)
};

export type DripOrderAction =
  | 'placed'
  | 'updated'
  | 'paid'
  | 'fulfilled'
  | 'refunded'
  | 'canceled';

export type DripOrder = {
  email: string;
  action?: DripOrderAction; // defaults to 'placed'
  order_id: string; // stable, idempotent key
  order_public_id?: string | null;
  grand_total?: number | null; // major units
  total_taxes?: number | null;
  total_discounts?: number | null;
  currency?: string | null;
  occurred_at?: string | null; // ISO-8601; defaults to now on Drip's side
  order_url?: string | null;
  items?: DripOrderItem[];
  properties?: Record<string, string | number | null>;
};

export async function recordOrder(cfg: DripConfig, order: DripOrder): Promise<void> {
  const items = (order.items ?? [])
    .filter((it) => it.name)
    .map((it) => ({
      name: it.name,
      product_id: it.product_id || undefined,
      sku: it.sku || undefined,
      price: it.price ?? undefined,
      quantity: it.quantity ?? 1,
      total: it.total ?? undefined,
    }));
  const body = {
    provider: DRIP_ORDER_PROVIDER,
    email: order.email,
    // Create the subscriber as active if Drip hasn't seen them — a purchase is
    // a consented relationship. Never resurrects an unsubscribed contact: Drip
    // only applies initial_status to brand-new subscribers.
    initial_status: 'active',
    action: order.action ?? 'placed',
    occurred_at: order.occurred_at || undefined,
    order_id: order.order_id,
    order_public_id: order.order_public_id || undefined,
    grand_total: order.grand_total ?? undefined,
    total_taxes: order.total_taxes ?? undefined,
    total_discounts: order.total_discounts ?? undefined,
    currency: order.currency || undefined,
    order_url: order.order_url || undefined,
    items: items.length ? items : undefined,
    properties: order.properties ? scrubCustomFields(order.properties) : undefined,
  };
  const res = await fetch(
    `https://api.getdrip.com/v3/${cfg.accountId}/shopper_activity/order`,
    {
      method: 'POST',
      headers: {
        Authorization: authHeader(cfg),
        'Content-Type': 'application/json',
        'User-Agent': DRIP_USER_AGENT,
      },
      body: JSON.stringify(body),
    },
  );
  // 202 Accepted is the documented success; accept any 2xx.
  if (!res.ok) {
    throw new Error(`Drip recordOrder: ${res.status} ${await res.text()}`);
  }
}

// Globally unsubscribe a subscriber from all mailings.
// POST /v2/:account_id/subscribers/:id_or_email/unsubscribe_all
// A 404 means Drip has never seen the address — nothing to unsubscribe, so we
// treat it as success rather than an error.
export async function unsubscribeFromAll(cfg: DripConfig, email: string): Promise<void> {
  const res = await fetch(
    `${baseUrl(cfg)}/subscribers/${encodeURIComponent(email)}/unsubscribe_all`,
    {
      method: 'POST',
      headers: {
        Authorization: authHeader(cfg),
        'Content-Type': 'application/vnd.api+json',
      },
    },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Drip unsubscribeFromAll: ${res.status} ${await res.text()}`);
  }
}

// Re-activate a previously unsubscribed subscriber. Drip resubscribes when the
// subscriber is (re)created with status "active" on the create/update endpoint.
// Only call this for a deliberate, consented opt-in (e.g. an admin action).
export async function resubscribe(cfg: DripConfig, email: string): Promise<void> {
  const res = await fetch(`${baseUrl(cfg)}/subscribers`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(cfg),
      'Content-Type': 'application/vnd.api+json',
    },
    body: JSON.stringify({ subscribers: [{ email, status: 'active' }] }),
  });
  if (!res.ok) {
    throw new Error(`Drip resubscribe: ${res.status} ${await res.text()}`);
  }
}

function scrubCustomFields(
  obj: Record<string, string | number | null | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    out[k] = String(v);
  }
  return out;
}
