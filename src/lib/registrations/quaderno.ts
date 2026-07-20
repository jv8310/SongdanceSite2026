// Minimal Quaderno wrapper. Creates a contact + an invoice and (separately)
// registers a payment so the invoice reads as PAID. Used by the manual
// bank-transfer order flow (src/lib/orders/manual-order.ts) — a course paid by
// bank transfer never hits Stripe, so the Stripe→Quaderno native connector that
// normally makes the invoice never fires; we create it ourselves here.
// Docs: https://developers.quaderno.io

export type QuadernoConfig = {
  apiKey: string;
  account: string; // subdomain, e.g. "songdance"
  // Hit the Quaderno sandbox host instead of live. Mirrors QUADERNO_SANDBOX.
  sandbox?: boolean;
};

// Quaderno's accepted payment methods. Bank transfer = 'wire_transfer'.
export type QuadernoPaymentMethod =
  | 'credit_card'
  | 'cash'
  | 'wire_transfer'
  | 'paypal'
  | 'other';

type ContactInput = {
  name: string;
  email: string;
  country?: string | null;
  // Optional B2B details. `company` promotes the contact to a company and
  // `vat_number` becomes its tax_id — which is what lets Quaderno apply EU
  // reverse-charge (0% VAT) to a valid cross-border business.
  company?: string | null;
  vat_number?: string | null;
};

type InvoiceItem = {
  description: string;
  // Gross unit price (tax inclusive) — the site prices are tax-inclusive, so we
  // pass gross and let Quaderno back the tax out of it.
  unit_price: number;
  quantity: number;
  // Preferred: let Quaderno auto-calculate the tax from the contact (country +
  // VAT number) for this tax class (e.g. 'eservice'). Requires automatic tax
  // calculation to be enabled on the account (it is — the Stripe connector
  // relies on it). Leave tax_1_* unset when using this.
  tax_class?: string;
  tax_1_name?: string;
  tax_1_rate?: number; // percentage, e.g. 21
};

// Build a Quaderno contact body. A `company` makes it a company contact (its
// name lives in first_name); otherwise a person. `vat_number` → tax_id.
function contactBody(c: ContactInput): Record<string, unknown> {
  const isCompany = !!(c.company && c.company.trim());
  return {
    kind: isCompany ? 'company' : 'person',
    first_name: isCompany ? c.company : c.name,
    contact_name: c.name,
    email: c.email,
    country: c.country || undefined,
    tax_id: c.vat_number || undefined,
  };
}

type CreateInvoiceInput = {
  contact_id: string;
  currency: string;
  po_number?: string;
  items: InvoiceItem[];
  notes?: string;
};

export type CreatedInvoice = {
  id: string;
  number?: string | null;
  permalink?: string | null;
};

function authHeader(cfg: QuadernoConfig) {
  return `Basic ${btoa(`${cfg.apiKey}:x`)}`;
}

function baseUrl(cfg: QuadernoConfig) {
  const host = cfg.sandbox
    ? `${cfg.account}.sandbox-quadernoapp.com`
    : `${cfg.account}.quadernoapp.com`;
  return `https://${host}/api`;
}

// Find a contact id by email (exact, case-insensitive). Returns null when
// Quaderno has never seen the address. Used by the admin "open Quaderno
// profile" deep-link to jump straight to the buyer's contact page.
export async function findContactIdByEmail(
  cfg: QuadernoConfig,
  email: string,
): Promise<string | null> {
  const res = await fetch(
    `${baseUrl(cfg)}/contacts.json?q=${encodeURIComponent(email)}`,
    { headers: { Authorization: authHeader(cfg) } },
  );
  if (!res.ok) return null;
  const arr = (await res.json()) as Array<{ id: string; email?: string }>;
  const found = arr.find(
    (x) => x.email?.toLowerCase() === email.toLowerCase(),
  );
  return found?.id ?? null;
}

export async function upsertContact(cfg: QuadernoConfig, c: ContactInput) {
  // Quaderno doesn't have a true upsert; find by email first.
  const existingId = await findContactIdByEmail(cfg, c.email);
  if (existingId) {
    // Attach any newly-provided details (country / company / VAT number) so a
    // B2B order gets the right reverse-charge tax and the invoice shows the
    // company. Best-effort, and only fields we were given — never blank
    // existing data.
    const update: Record<string, unknown> = {};
    if (c.country) update.country = c.country;
    if (c.vat_number) update.tax_id = c.vat_number;
    if (c.company && c.company.trim()) {
      update.kind = 'company';
      update.first_name = c.company;
    }
    if (Object.keys(update).length) {
      await fetch(`${baseUrl(cfg)}/contacts/${existingId}.json`, {
        method: 'PUT',
        headers: {
          Authorization: authHeader(cfg),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(update),
      }).catch(() => {
        /* best-effort — a paid invoice on the existing contact still lands */
      });
    }
    return existingId;
  }

  const res = await fetch(`${baseUrl(cfg)}/contacts.json`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(cfg),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(contactBody(c)),
  });
  if (!res.ok) {
    throw new Error(`Quaderno contact create failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { id: string | number };
  return String(body.id);
}

// Create an invoice (NOT yet paid). Register the payment separately with
// markInvoicePaid so the invoice reads as paid — Quaderno's payments endpoint is
// the reliable way to settle an invoice.
export async function createInvoice(
  cfg: QuadernoConfig,
  input: CreateInvoiceInput,
): Promise<CreatedInvoice> {
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
        tax_class: i.tax_class,
        tax_1_name: i.tax_1_name,
        tax_1_rate: i.tax_1_rate,
      })),
      notes: input.notes,
    }),
  });
  if (!res.ok) {
    throw new Error(`Quaderno invoice create failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    id: string | number;
    number?: string | null;
    permalink?: string | null;
  };
  return {
    id: String(body.id),
    number: body.number ?? null,
    permalink: body.permalink ?? null,
  };
}

// Register a payment against an invoice so it reads as PAID. `amountMajor` is
// the gross total in major units (e.g. 1500 for €1500); `date` is 'YYYY-MM-DD'.
export async function markInvoicePaid(
  cfg: QuadernoConfig,
  invoiceId: string,
  p: { amountMajor: number; date?: string; paymentMethod?: QuadernoPaymentMethod },
): Promise<void> {
  const res = await fetch(
    `${baseUrl(cfg)}/invoices/${invoiceId}/payments.json`,
    {
      method: 'POST',
      headers: {
        Authorization: authHeader(cfg),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: p.amountMajor.toFixed(2),
        payment_method: p.paymentMethod ?? 'wire_transfer',
        date: p.date,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Quaderno payment failed: ${res.status} ${await res.text()}`);
  }
}

// Create an invoice already marked paid (contact must exist). Convenience over
// createInvoice + markInvoicePaid; the payment total is the sum of the gross
// line items.
export async function createPaidInvoice(
  cfg: QuadernoConfig,
  input: CreateInvoiceInput & {
    payment_method?: QuadernoPaymentMethod;
    paid_at?: string; // 'YYYY-MM-DD'
  },
): Promise<CreatedInvoice> {
  const invoice = await createInvoice(cfg, input);
  const totalMajor = input.items.reduce(
    (s, i) => s + i.unit_price * i.quantity,
    0,
  );
  await markInvoicePaid(cfg, invoice.id, {
    amountMajor: totalMajor,
    date: input.paid_at,
    paymentMethod: input.payment_method ?? 'wire_transfer',
  });
  return invoice;
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
