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
