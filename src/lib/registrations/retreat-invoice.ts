// Quaderno invoices for retreat money that never touched a gateway.
//
// Almost every retreat invoice is made by the native Stripe/PayPal→Quaderno
// connector, not by us: the gateway reports the charge and Quaderno raises the
// document. Two payments have no gateway to report them, so nothing invoices
// them at all — the money lands in the bank and the books stay empty:
//
//   • a booking paid by IBAN transfer (bank-transfer.ts), confirmed with
//     "Mark paid" on /admin/retreats/<slug>;
//   • a deposit's remaining balance settled by hand with the balance table's
//     "Mark paid" (balance-email.ts leads with the bank account, so this is a
//     transfer by construction whatever gateway took the deposit).
//
// This is the same gap `manual-order.ts` fills for a course bought by
// transfer, and it uses the same wrapper (registrations/quaderno.ts). The
// difference is the tax, and it matters:
//
//   **A retreat is not an e-service.** The course flow passes
//   `tax_class: 'eservice'` and lets Quaderno derive destination VAT (or
//   reverse-charge) from the contact's country and VAT number. For a retreat
//   that would be wrong in both directions: it is a physical event, so under
//   EU VAT Directive Art. 53 the place of supply is where the event is held,
//   for B2C and B2B alike — no reverse-charge, and never the buyer's own rate.
//   The rate therefore comes from the retreat itself (`products.vat_rate`),
//   which is exactly why that column varies: 0.21 for the château in Belgium,
//   0.0 for the boat in Egypt's Red Sea, outside the EU altogether. We pass it
//   explicitly as tax_1_rate and never let Quaderno guess.
//
// Everything here is best-effort by contract: the money is already in and the
// booking already confirmed, so a Quaderno outage must never fail the admin
// action. Failures release their claim (so pressing the button again retries)
// and are written to the events log.

import {
  createPaidInvoice,
  upsertContact,
  type QuadernoConfig,
} from './quaderno';
import { logEventSafe, setQuadernoInvoice, type Registration } from './db';

export type RetreatInvoiceEnv = {
  DB: D1Database;
  QUADERNO_API_KEY?: string;
  QUADERNO_ACCOUNT?: string;
  QUADERNO_SANDBOX?: string;
};

export type RetreatInvoiceResult =
  | { ok: true; id: string; number: string | null; permalink: string | null }
  | { ok: false; error: string }
  // Nothing was attempted, and that is correct — not a failure to report.
  | { ok: null; reason: SkipReason };

export type SkipReason =
  | 'not-configured' // Quaderno secrets unset: the whole integration no-ops
  | 'already-invoiced' // we have raised this one before
  | 'gateway-owns-it' // Stripe/PayPal took the money; the connector invoices it
  | 'not-paid'
  | 'nothing-to-invoice'
  | 'row-missing';

// The kind on the idempotency claim. One row per invoice we raise, so a
// double-click (or a retried request) can never bill twice.
const CLAIM_KIND = 'retreat.invoice.created';

function quadernoConfig(env: RetreatInvoiceEnv): QuadernoConfig | null {
  return env.QUADERNO_API_KEY && env.QUADERNO_ACCOUNT
    ? {
        apiKey: env.QUADERNO_API_KEY,
        account: env.QUADERNO_ACCOUNT,
        sandbox: env.QUADERNO_SANDBOX === '1',
      }
    : null;
}

async function claim(db: D1Database, externalId: string): Promise<boolean> {
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id)
       VALUES (NULL, '${CLAIM_KIND}', 'admin', ?)`,
    )
    .bind(externalId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

async function release(db: D1Database, externalId: string): Promise<void> {
  await db
    .prepare(`DELETE FROM events WHERE external_id = ? AND kind = '${CLAIM_KIND}'`)
    .bind(externalId)
    .run();
}

type RetreatContext = {
  product: { name: string; slug: string; currency: string; vat_rate: number };
  tier: { name: string };
};

async function loadContext(
  db: D1Database,
  reg: Registration,
): Promise<RetreatContext | null> {
  const product = await db
    .prepare('SELECT name, slug, currency, vat_rate FROM products WHERE id = ?')
    .bind(reg.product_id)
    .first<{ name: string; slug: string; currency: string; vat_rate: number }>();
  const tier = await db
    .prepare('SELECT name FROM tiers WHERE id = ?')
    .bind(reg.tier_id)
    .first<{ name: string }>();
  return product && tier ? { product, tier } : null;
}

// Raise one paid invoice for a retreat registration. `amountCents` is the gross
// (tax-inclusive) sum actually received — the booking total, or just the
// balance — and `description` the receipt line.
async function raiseInvoice(
  env: RetreatInvoiceEnv,
  args: {
    reg: Registration;
    ctx: RetreatContext;
    amountCents: number;
    description: string;
    notes: string;
    externalId: string;
    kind: 'booking' | 'balance';
  },
): Promise<RetreatInvoiceResult> {
  const cfg = quadernoConfig(env);
  if (!cfg) return { ok: null, reason: 'not-configured' };
  if (args.amountCents <= 0) return { ok: null, reason: 'nothing-to-invoice' };

  if (!(await claim(env.DB, args.externalId))) {
    return { ok: null, reason: 'already-invoiced' };
  }

  const { reg, ctx } = args;
  const grossMajor = args.amountCents / 100;
  const name =
    [reg.first_name, reg.last_name].filter(Boolean).join(' ').trim() ||
    reg.name ||
    reg.email.split('@')[0];

  try {
    const contactId = await upsertContact(cfg, {
      name,
      email: reg.email,
      country: reg.country,
      company: reg.company_name,
      vat_number: reg.vat_number,
    });

    const invoice = await createPaidInvoice(cfg, {
      contact_id: contactId,
      currency: (reg.currency || ctx.product.currency || 'EUR').toUpperCase(),
      po_number: `retreat-${reg.id}`,
      notes: args.notes,
      payment_method: 'wire_transfer',
      paid_at: paidDate(reg),
      items: [
        {
          description: args.description,
          unit_price: grossMajor,
          quantity: 1,
          // The event's own rate, never derived from the buyer — see the
          // note at the top of this file. vat_rate is a fraction (0.21).
          tax_1_name: 'VAT',
          tax_1_rate: Math.round((ctx.product.vat_rate ?? 0) * 10000) / 100,
        },
      ],
    });

    // The column holds one id, so the booking invoice owns it; a balance
    // invoice only fills it when nothing is recorded yet (a Stripe deposit
    // leaves it empty — the connector never tells us its id). Either way the
    // event below is the full record, and /admin/orders links to Quaderno by
    // the buyer's email, which lands on every invoice they have.
    if (args.kind === 'booking' || !reg.quaderno_invoice_id) {
      await setQuadernoInvoice(env.DB, reg.id, invoice.id);
    }

    await logEventSafe(env.DB, {
      registration_id: reg.id,
      kind: 'registration.invoice.created',
      source: 'admin',
      payload: {
        for: args.kind,
        invoice_id: invoice.id,
        invoice_number: invoice.number,
        permalink: invoice.permalink,
        amount_cents: args.amountCents,
        currency: reg.currency,
        vat_rate: ctx.product.vat_rate,
      },
    });

    return {
      ok: true,
      id: invoice.id,
      number: invoice.number ?? null,
      permalink: invoice.permalink ?? null,
    };
  } catch (err) {
    // Let the next press try again.
    await release(env.DB, args.externalId);
    await logEventSafe(env.DB, {
      registration_id: reg.id,
      kind: 'registration.invoice.error',
      source: 'admin',
      payload: { for: args.kind, error: String(err) },
    });
    return { ok: false, error: String(err) };
  }
}

// The day the money is booked. paid_at is set the moment the admin confirms
// the transfer, which is the day it appeared on the statement.
function paidDate(reg: Registration): string {
  const iso = reg.paid_at ?? new Date().toISOString();
  return iso.slice(0, 10).replace(/\//g, '-');
}

// ── The booking itself, paid by IBAN transfer ──────────────────────────
//
// Only ever for a `bank_transfer` row: that is precisely the money no gateway
// saw, so raising an invoice here can never duplicate the connector's. A
// Stripe/PayPal row marked paid by hand (a missed webhook) is left alone — the
// charge exists at the gateway and will be invoiced from there.
export async function invoiceRetreatBooking(
  env: RetreatInvoiceEnv,
  reg: Registration,
): Promise<RetreatInvoiceResult> {
  if (reg.status !== 'paid') return { ok: null, reason: 'not-paid' };
  if (reg.provider !== 'bank_transfer') return { ok: null, reason: 'gateway-owns-it' };
  if (reg.quaderno_invoice_id) return { ok: null, reason: 'already-invoiced' };

  const ctx = await loadContext(env.DB, reg);
  if (!ctx) return { ok: null, reason: 'row-missing' };

  // What was actually received. amount_cents only ever holds what has been
  // CHARGED — on a deposit booking that is the deposit alone, and
  // markBalancePaid later ADDS the balance to it — so it is the received sum
  // as it stands, never a total to subtract the outstanding balance from.
  // (Doing that subtraction would invoice zero on an even 50/50 deposit.)
  const isDeposit = (reg.balance_due_cents ?? 0) > 0;

  return raiseInvoice(env, {
    reg,
    ctx,
    amountCents: reg.amount_cents,
    description: isDeposit
      ? `${ctx.product.name} — ${ctx.tier.name} (deposit)`
      : `${ctx.product.name} — ${ctx.tier.name}`,
    notes: 'Paid by bank transfer.',
    externalId: `retreat-invoice-${reg.id}`,
    kind: 'booking',
  });
}

// ── The remaining balance, settled by hand ─────────────────────────────
//
// Its own document for its own amount, whatever gateway took the deposit: the
// balance table's "Mark paid" exists because a transfer has no webhook, so
// this money is always one the connector cannot see. Call it BEFORE settling
// the row, while balance_due_cents still says what was owed.
export async function invoiceRetreatBalance(
  env: RetreatInvoiceEnv,
  reg: Registration,
  balanceCents: number,
): Promise<RetreatInvoiceResult> {
  if (balanceCents <= 0) return { ok: null, reason: 'nothing-to-invoice' };

  const ctx = await loadContext(env.DB, reg);
  if (!ctx) return { ok: null, reason: 'row-missing' };

  return raiseInvoice(env, {
    reg,
    ctx,
    amountCents: balanceCents,
    description: `${ctx.product.name} — ${ctx.tier.name} (remaining balance)`,
    notes: 'Remaining balance, paid by bank transfer.',
    externalId: `retreat-balance-invoice-${reg.id}`,
    kind: 'balance',
  });
}

// Has an invoice already been raised for this registration / its balance?
// Reads the claims, so the admin page can offer the recovery button only where
// something is genuinely missing.
export async function invoicedRegistrationIds(
  db: D1Database,
  which: 'booking' | 'balance',
): Promise<Set<number>> {
  const prefix = which === 'booking' ? 'retreat-invoice-' : 'retreat-balance-invoice-';
  const res = await db
    .prepare(
      `SELECT external_id FROM events
        WHERE kind = '${CLAIM_KIND}' AND external_id LIKE ?`,
    )
    .bind(`${prefix}%`)
    .all<{ external_id: string }>();
  const ids = new Set<number>();
  for (const row of res.results ?? []) {
    const id = parseInt(row.external_id.slice(prefix.length), 10);
    if (Number.isFinite(id)) ids.add(id);
  }
  return ids;
}
