// Quaderno invoices for retreat money that never touched a gateway.
//
// A Stripe payment is invoiced by the Stripe→Quaderno native connector — that
// is why nothing in this codebase has ever had to create a retreat invoice. A
// manual SEPA transfer to our IBAN has no such connector and no webhook: the
// money lands in the bank days later and an admin presses "Mark paid" on
// /admin/retreats/<slug>. Until now that produced a paid booking with no
// accounting document anywhere. This module is what fills that hole.
//
// Two moments produce a transfer:
//
//   • the booking itself — the whole price, or the 50% deposit
//     (src/lib/registrations/bank-transfer.ts);
//   • the remaining balance weeks later, settled by the "Mark paid" button in
//     the Balance-due table (src/lib/registrations/balance.ts).
//
// Each gets its own invoice (they are separate receipts of money), stored on
// the registration in `quaderno_invoice_id` / `balance_quaderno_invoice_id`.
//
// VAT: a retreat is NOT an e-service, so its VAT follows the venue, not the
// buyer's country — which is exactly what `products.vat_rate` already holds
// (0.21 for the Belgian château, 0.00 for the Red Sea boat) and what every
// revenue figure on the site nets by. We therefore pass that rate explicitly
// rather than letting Quaderno auto-derive a destination rate from the
// contact, the way the digital-course invoice does (orders/manual-order.ts).
// Prices are tax-inclusive here as everywhere else on the site: the line's
// unit_price is the gross the guest actually paid, and the invoice total is
// that same number.
//
// Never throws. Every call returns a result the caller can show or ignore; a
// Quaderno hiccup must never undo a booking that is already paid and pushed.

import {
  getRegistrationById,
  logEventSafe,
  type Registration,
} from '../registrations/db';
import {
  upsertContact,
  createInvoice,
  markInvoicePaid,
  type QuadernoConfig,
  type QuadernoPaymentMethod,
} from '../registrations/quaderno';
import { BANK_TRANSFER } from '../payments/provider';
import { bankTransferReference } from '../registrations/bank-transfer';
import { balancePaymentReference } from '../registrations/balance-email';

export type RetreatInvoiceEnv = {
  DB: D1Database;
  QUADERNO_API_KEY?: string;
  QUADERNO_ACCOUNT?: string;
  QUADERNO_SANDBOX?: string;
};

// Which of a booking's two possible receipts this invoice covers.
export type RetreatInvoiceKind = 'booking' | 'balance';

export type RetreatInvoiceSkip =
  | 'quaderno-not-configured'
  | 'registration-missing'
  | 'not-paid'
  | 'nothing-to-invoice'
  | 'already-invoiced';

export type RetreatInvoiceResult =
  // `paid: false` means the document exists but Quaderno refused the payment
  // registration — it is on the row and linked from the admin, and needs
  // settling in Quaderno by hand. Never silently reported as done.
  | {
      ok: true;
      id: string;
      number: string | null;
      permalink: string | null;
      paid: boolean;
    }
  | { ok: false; error: string }
  | { ok: null; skipped: RetreatInvoiceSkip };

export function quadernoConfigFor(env: RetreatInvoiceEnv): QuadernoConfig | null {
  return env.QUADERNO_API_KEY && env.QUADERNO_ACCOUNT
    ? {
        apiKey: env.QUADERNO_API_KEY,
        account: env.QUADERNO_ACCOUNT,
        sandbox: env.QUADERNO_SANDBOX === '1',
      }
    : null;
}

// Did a gateway already take this booking's money — and therefore already
// produce its invoice via the Stripe→Quaderno connector?
//
// Deliberately conservative: "Mark paid" doubles as the fallback for a Stripe
// payment whose webhook never arrived, and invoicing one of those twice is
// worse than not invoicing it at all (the admin can still press the per-row
// "Create Quaderno invoice" button). A PayPal capture is likewise left alone —
// see the note on the admin button.
//
// Note it must be read BEFORE markRegistrationPaid, which stamps the synthetic
// `manual-<id>` payment intent over whatever was there.
export function retreatPaidByGateway(reg: Registration): boolean {
  if (reg.provider === BANK_TRANSFER) return false;
  if (reg.paypal_capture_id) return true;
  const pi = reg.stripe_payment_intent ?? '';
  return !!pi && !pi.startsWith('manual-');
}

// 'YYYY-MM-DD' (UTC) from a sqlite "YYYY-MM-DD HH:MM:SS" or an ISO timestamp.
function dayOf(ts: string | null | undefined): string {
  const s = (ts ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function contactNameOf(reg: Registration): string {
  const parts = [reg.first_name, reg.last_name].filter(Boolean).join(' ').trim();
  return parts || reg.name?.trim() || reg.email.split('@')[0];
}

// Claim the invoice in the events log before calling Quaderno, so a
// double-clicked button (or a retried request) can't mint two invoices for the
// same money. Released again if the call fails, so a later attempt gets through.
async function claim(db: D1Database, externalId: string): Promise<boolean> {
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id)
       VALUES (NULL, 'quaderno.retreat.invoice.claimed', 'system', ?)`,
    )
    .bind(externalId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

async function releaseClaim(db: D1Database, externalId: string): Promise<void> {
  await db
    .prepare(
      `DELETE FROM events
        WHERE external_id = ? AND kind = 'quaderno.retreat.invoice.claimed'`,
    )
    .bind(externalId)
    .run()
    .catch(() => {});
}

// Create (and immediately settle) the Quaderno invoice for one retreat payment.
//
// `amountCents` is required for a balance — the sum just received — because
// markBalancePaid has by then already rolled it into `amount_cents`. For a
// booking it defaults to the row's own amount.
export async function createRetreatInvoice(
  env: RetreatInvoiceEnv,
  registrationId: number,
  opts: {
    kind: RetreatInvoiceKind;
    amountCents?: number;
    paymentMethod?: QuadernoPaymentMethod;
    by?: string | null;
  },
): Promise<RetreatInvoiceResult> {
  const cfg = quadernoConfigFor(env);
  if (!cfg) return { ok: null, skipped: 'quaderno-not-configured' };

  const reg = await getRegistrationById(env.DB, registrationId);
  if (!reg) return { ok: null, skipped: 'registration-missing' };
  if (reg.status !== 'paid') return { ok: null, skipped: 'not-paid' };

  const isBalance = opts.kind === 'balance';
  const existing = isBalance
    ? reg.balance_quaderno_invoice_id
    : reg.quaderno_invoice_id;
  if (existing) return { ok: null, skipped: 'already-invoiced' };

  const amountCents = Math.round(opts.amountCents ?? reg.amount_cents);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: null, skipped: 'nothing-to-invoice' };
  }

  const externalId = isBalance
    ? `quaderno-retreat-balance-${reg.id}`
    : `quaderno-retreat-${reg.id}`;
  if (!(await claim(env.DB, externalId))) {
    return { ok: null, skipped: 'already-invoiced' };
  }

  try {
    const product = await env.DB
      .prepare('SELECT name, slug, vat_rate FROM products WHERE id = ?')
      .bind(reg.product_id)
      .first<{ name: string; slug: string; vat_rate: number | null }>();
    const tier = await env.DB
      .prepare('SELECT name FROM tiers WHERE id = ?')
      .bind(reg.tier_id)
      .first<{ name: string }>();

    const contactId = await upsertContact(cfg, {
      name: contactNameOf(reg),
      email: reg.email,
      country: reg.country,
      company: reg.company_name,
      vat_number: reg.vat_number,
    });

    const base = [product?.name ?? 'Retreat', tier?.name]
      .filter(Boolean)
      .join(' — ');
    // A booking still owing a balance is a deposit; say so on the invoice.
    const isDeposit = !isBalance && (reg.balance_due_cents ?? 0) > 0;
    const description = isBalance
      ? `${base} (remaining balance)`
      : isDeposit
        ? `${base} (deposit)`
        : base;

    // products.vat_rate is a decimal (0.21); Quaderno wants a percentage.
    // A zero rate is left off entirely — a 0% line reads as an error on an
    // invoice for a retreat that simply carries no VAT.
    const rate = Number(product?.vat_rate ?? 0);
    const tax =
      rate > 0
        ? { tax_1_name: 'VAT', tax_1_rate: Math.round(rate * 10000) / 100 }
        : {};

    const grossMajor = amountCents / 100;
    const paidDate = dayOf(isBalance ? reg.balance_paid_at : reg.paid_at);
    const reference = isBalance
      ? balancePaymentReference(reg.id)
      : bankTransferReference(reg.id);

    const invoice = await createInvoice(cfg, {
      contact_id: contactId,
      currency: (reg.currency || 'EUR').toUpperCase(),
      po_number: reference,
      notes: isBalance
        ? `Remaining balance paid by bank transfer (ref ${reference}).`
        : `Paid by bank transfer (ref ${reference}).`,
      items: [{ description, unit_price: grossMajor, quantity: 1, ...tax }],
    });

    // Store the id first. Quaderno needs two calls (create, then register the
    // payment), and if the second one fails we must still own the document
    // that already exists — otherwise a retry mints a duplicate.
    await env.DB
      .prepare(
        isBalance
          ? 'UPDATE registrations SET balance_quaderno_invoice_id = ? WHERE id = ?'
          : 'UPDATE registrations SET quaderno_invoice_id = ? WHERE id = ?',
      )
      .bind(invoice.id, reg.id)
      .run();

    let paid = true;
    try {
      await markInvoicePaid(cfg, invoice.id, {
        amountMajor: grossMajor,
        date: paidDate,
        paymentMethod: opts.paymentMethod ?? 'wire_transfer',
      });
    } catch (err) {
      paid = false;
      await logEventSafe(env.DB, {
        registration_id: reg.id,
        kind: 'registration.quaderno_invoice.unpaid',
        source: opts.by ? 'admin' : 'system',
        payload: { kind: opts.kind, invoice_id: invoice.id, error: String(err) },
      });
    }

    await logEventSafe(env.DB, {
      registration_id: reg.id,
      kind: 'registration.quaderno_invoice.created',
      source: opts.by ? 'admin' : 'system',
      payload: {
        kind: opts.kind,
        invoice_id: invoice.id,
        invoice_number: invoice.number ?? null,
        marked_paid: paid,
        amount_cents: amountCents,
        currency: reg.currency,
        paid_date: paidDate,
        vat_rate: rate,
        reference,
        by: opts.by ?? null,
      },
    });

    return {
      ok: true,
      id: invoice.id,
      number: invoice.number ?? null,
      permalink: invoice.permalink ?? null,
      paid,
    };
  } catch (err) {
    await releaseClaim(env.DB, externalId);
    await logEventSafe(env.DB, {
      registration_id: reg.id,
      kind: 'registration.quaderno_invoice.error',
      source: opts.by ? 'admin' : 'system',
      payload: { kind: opts.kind, amount_cents: amountCents, error: String(err) },
    });
    return { ok: false, error: String(err) };
  }
}

// What balance was actually received on a row whose balance is already
// settled? `markBalancePaid` folds it into amount_cents and zeroes
// balance_due_cents, so the figure only survives in the events log — which
// every settling path writes: the admin bank-transfer button
// (`registration.balance.paid`, payload.balance_cents), the Stripe webhook
// (same kind, payload.amount_total) and PayPal (`paypal.balance.paid`,
// payload.amount_minor). Used by the admin "create the invoice by hand"
// button so a retry after a Quaderno error invoices the right sum.
export async function settledBalanceCents(
  db: D1Database,
  registrationId: number,
): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT payload_json FROM events
        WHERE registration_id = ?
          AND kind IN ('registration.balance.paid','paypal.balance.paid')
        ORDER BY id DESC LIMIT 1`,
    )
    .bind(registrationId)
    .first<{ payload_json: string | null }>();
  if (!row?.payload_json) return null;
  try {
    const p = JSON.parse(row.payload_json) as Record<string, unknown>;
    for (const key of ['balance_cents', 'amount_total', 'amount_minor']) {
      const v = p[key];
      if (typeof v === 'number' && v > 0) return Math.round(v);
    }
  } catch {
    /* a malformed payload is simply "unknown" */
  }
  return null;
}

// Short, human-readable outcome for the admin redirect banner.
export function retreatInvoiceStatus(r: RetreatInvoiceResult): string {
  if (r.ok === true) {
    return `${r.paid ? 'created' : 'created-unpaid'}:${r.number ?? r.id}`;
  }
  if (r.ok === false) return 'error';
  return `skipped:${r.skipped}`;
}
