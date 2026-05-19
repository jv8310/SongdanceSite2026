// Minimal Quaderno wrapper. Creates a contact + an invoice marked paid via Stripe,
// applying VAT according to Quaderno's tax rules for the buyer country.
// Docs: https://developers.quaderno.io

export type QuadernoConfig = {
  apiKey: string;
  account: string; // subdomain, e.g. "songdance"
};

type ContactInput = {
  name: string;
  email: string;
  country?: string | null;
};

type InvoiceItem = {
  description: string;
  unit_price: number; // gross or net depending on tax setting; we send gross + tax inclusive
  quantity: number;
  tax_1_name?: string;
  tax_1_rate?: number;
};

type CreateInvoiceInput = {
  contact_id: string;
  currency: string;
  po_number?: string;
  items: InvoiceItem[];
  payment_method?: 'credit_card' | 'cash' | 'wire_transfer' | 'other';
  paid_at?: string; // ISO date
  notes?: string;
};

function authHeader(cfg: QuadernoConfig) {
  return `Basic ${btoa(`${cfg.apiKey}:x`)}`;
}

function baseUrl(cfg: QuadernoConfig) {
  return `https://${cfg.account}.quadernoapp.com/api`;
}

export async function upsertContact(cfg: QuadernoConfig, c: ContactInput) {
  // Quaderno doesn't have a true upsert; we attempt to find by email first.
  const search = await fetch(
    `${baseUrl(cfg)}/contacts.json?q=${encodeURIComponent(c.email)}`,
    { headers: { Authorization: authHeader(cfg) } },
  );
  if (search.ok) {
    const arr = (await search.json()) as Array<{ id: string; email: string }>;
    const found = arr.find((x) => x.email?.toLowerCase() === c.email.toLowerCase());
    if (found) return found.id;
  }

  const res = await fetch(`${baseUrl(cfg)}/contacts.json`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(cfg),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      kind: 'person',
      first_name: c.name,
      contact_name: c.name,
      email: c.email,
      country: c.country ?? undefined,
    }),
  });
  if (!res.ok) {
    throw new Error(`Quaderno contact create failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { id: string };
  return body.id;
}

export async function createPaidInvoice(
  cfg: QuadernoConfig,
  input: CreateInvoiceInput,
) {
  const res = await fetch(`${baseUrl(cfg)}/invoices.json`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(cfg),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contact_id: input.contact_id,
      currency: input.currency,
      po_number: input.po_number,
      items_attributes: input.items.map((i) => ({
        description: i.description,
        unit_price: i.unit_price,
        quantity: i.quantity,
        tax_1_name: i.tax_1_name,
        tax_1_rate: i.tax_1_rate,
      })),
      payment_details: input.payment_method
        ? {
            payment_method: input.payment_method,
            date: input.paid_at,
          }
        : undefined,
      notes: input.notes,
      tax_id: '',
    }),
  });
  if (!res.ok) {
    throw new Error(`Quaderno invoice create failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { id: string; permalink?: string };
}

export async function sendInvoiceByEmail(cfg: QuadernoConfig, invoiceId: string) {
  const res = await fetch(
    `${baseUrl(cfg)}/invoices/${invoiceId}/deliver.json`,
    {
      method: 'GET',
      headers: { Authorization: authHeader(cfg) },
    },
  );
  if (!res.ok) {
    throw new Error(`Quaderno deliver failed: ${res.status} ${await res.text()}`);
  }
}
