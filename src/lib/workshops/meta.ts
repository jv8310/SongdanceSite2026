// Meta Conversions API — server-side Purchase event with a dedup event_id.
//
// The registration page generates a dedup `event_id`, passes it to the client
// Pixel `Purchase` event AND through Stripe metadata to the server. On the
// webhook success path we POST a server-side Purchase with the same id, so
// Meta deduplicates the browser + server events into one.

export type MetaConfig = {
  pixelId: string;
  accessToken: string;
  apiVersion?: string; // default v21.0
};

// A random, URL-safe dedup id shared by the client Pixel and server CAPI.
export function generateEventId(): string {
  return crypto.randomUUID();
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
