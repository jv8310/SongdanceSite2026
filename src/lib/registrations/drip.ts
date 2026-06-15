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
