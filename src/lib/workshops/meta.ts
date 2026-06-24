// Meta Conversions API — server-side Purchase event, deduplicated against the
// browser Pixel Purchase.
//
// A deterministic per-registration event_id (`purchaseEventId`) is shared by
// the browser Pixel Purchase (fired on /workshop/success) and this server-side
// CAPI Purchase (fired from the paid webhook). Because both carry the same
// event_id, Meta folds the two into one event — the browser send brings the
// rich match signals (fbp/fbc cookie, IP, user-agent), while the server send is
// the reliable backstop for when the Pixel is blocked or the tab is closed.

export type MetaConfig = {
  pixelId: string;
  accessToken: string;
  apiVersion?: string; // default v21.0
};

// A random, URL-safe dedup id shared by the client Pixel and server CAPI.
export function generateEventId(): string {
  return crypto.randomUUID();
}

// Deterministic Purchase event_id for a registration. Used identically by the
// browser Pixel and the server CAPI so Meta deduplicates the two Purchase hits
// into one — no need to thread a random id through Stripe metadata.
export function purchaseEventId(registrationId: number): string {
  return `wpur-${registrationId}`;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export async function sendPurchaseEvent(
  cfg: MetaConfig,
  args: {
    eventId: string;
    email: string;
    value: number; // major units (e.g. 25.00)
    currency: string;
    orderId: string;
    // Catalog product ids this purchase covers. When set, the event carries
    // content_ids + content_type:'product' so Meta can bind the Purchase to the
    // product catalog (ROAS attribution + excluding buyers from view-retargeting).
    contentIds?: string[];
    eventTime?: number; // unix seconds; defaults to now
    eventSourceUrl?: string;
    clientIp?: string | null;
    clientUserAgent?: string | null;
  },
): Promise<void> {
  const version = cfg.apiVersion ?? 'v21.0';
  const em = await sha256Hex(args.email.trim().toLowerCase());

  const body = {
    data: [
      {
        event_name: 'Purchase',
        event_time: args.eventTime ?? Math.floor(Date.now() / 1000),
        event_id: args.eventId,
        action_source: 'website',
        event_source_url: args.eventSourceUrl,
        user_data: {
          em: [em],
          ...(args.clientIp ? { client_ip_address: args.clientIp } : {}),
          ...(args.clientUserAgent ? { client_user_agent: args.clientUserAgent } : {}),
        },
        custom_data: {
          value: Number(args.value.toFixed(2)),
          currency: args.currency.toUpperCase(),
          order_id: args.orderId,
          ...(args.contentIds && args.contentIds.length
            ? { content_ids: args.contentIds, content_type: 'product' }
            : {}),
        },
      },
    ],
  };

  const url = `https://graph.facebook.com/${version}/${cfg.pixelId}/events?access_token=${encodeURIComponent(cfg.accessToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Meta CAPI: ${res.status} ${await res.text()}`);
  }
}
