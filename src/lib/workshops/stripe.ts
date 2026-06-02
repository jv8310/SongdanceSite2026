// Workshop-specific Stripe read helpers (settlement / FX capture). The
// checkout-session *creation* and webhook signature verification are reused
// from src/lib/registrations/stripe.ts — this only adds the balance-transaction
// fetch the stats need (EUR settlement + exchange rate), analogous to the
// legacy Mollie settlement_amount.

const STRIPE_BASE = 'https://api.stripe.com/v1';

export type PaymentSettlement = {
  chargeId: string | null;
  method: string | null;
  balanceTransactionId: string | null;
  settlementAmountMinor: number | null; // gross converted to settlement (payout) currency
  settlementCurrency: string | null; // usually EUR
  fxRate: number | null;
};

// Retrieve a PaymentIntent with its latest charge + balance transaction
// expanded, and pull out the settlement figures used by the stats module.
export async function retrievePaymentSettlement(
  secretKey: string,
  paymentIntentId: string,
): Promise<PaymentSettlement> {
  const url = `${STRIPE_BASE}/payment_intents/${paymentIntentId}?expand[]=latest_charge.balance_transaction`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${secretKey}` } });
  if (!res.ok) {
    throw new Error(`Stripe payment_intents.retrieve: ${res.status} ${await res.text()}`);
  }
  const pi = (await res.json()) as {
    latest_charge?: {
      id?: string;
      payment_method_details?: { type?: string };
      balance_transaction?: {
        id?: string;
        amount?: number;
        currency?: string;
        exchange_rate?: number | null;
      } | null;
    } | null;
  };
  const charge = pi.latest_charge ?? null;
  const bt = charge?.balance_transaction ?? null;
  return {
    chargeId: charge?.id ?? null,
    method: charge?.payment_method_details?.type ?? null,
    balanceTransactionId: bt?.id ?? null,
    settlementAmountMinor: typeof bt?.amount === 'number' ? bt.amount : null,
    settlementCurrency: bt?.currency ? bt.currency.toUpperCase() : null,
    fxRate: typeof bt?.exchange_rate === 'number' ? bt.exchange_rate : null,
  };
}
