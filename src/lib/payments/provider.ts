// Shared payment-provider plumbing used by both the Stripe and PayPal paths.
//
// `provider` is recorded on every order/registration row (see migration 0049).
// PayPal objects carry a compact `custom_id` routing key — "<kind>:<id>" — so a
// webhook (or the return endpoint) can resolve a capture / subscription payment
// back to the right table + row without stuffing all our metadata into PayPal.
// Everything else about the order already lives on our DB row, looked up by id.

export type PaymentProvider = 'stripe' | 'paypal';

// Manual SEPA transfer to our IBAN. NOT a gateway: nothing is created
// anywhere, no webhook ever fires, and the money lands in the bank days
// later — an admin marks the row paid by hand. It is only ever a value
// stored in the `provider` column, which is why it sits outside
// PaymentProvider (a gateway) and outside parseProvider (see below).
export const BANK_TRANSFER = 'bank_transfer' as const;

// What the `provider` column on an order/registration row may hold.
export type OrderProvider = PaymentProvider | typeof BANK_TRANSFER;

export type RoutingKind = 'course' | 'retreat' | 'workshop' | 'balance';

export function isPaymentProvider(v: unknown): v is PaymentProvider {
  return v === 'stripe' || v === 'paypal';
}

// Read a provider from a request body / query param, defaulting to Stripe so
// every existing caller and any malformed value keeps the current behaviour.
//
// Deliberately narrow: it never returns 'bank_transfer'. Most checkouts only
// branch on `=== 'paypal'`, so a widened return value would fall straight
// through to the Stripe path and open a card session on a row stamped
// bank_transfer. A checkout that offers the transfer must opt in explicitly,
// ahead of this call, with wantsBankTransfer().
export function parseProvider(v: unknown): PaymentProvider {
  return v === 'paypal' ? 'paypal' : 'stripe';
}

// Did the buyer pick "pay by IBAN bank transfer"? Only the two retreat
// checkouts ask, so nothing else can be talked into the manual path.
export function wantsBankTransfer(v: unknown): boolean {
  return v === BANK_TRANSFER;
}

export function encodeCustomId(kind: RoutingKind, id: number | string): string {
  return `${kind}:${id}`;
}

export function decodeCustomId(
  raw: string | null | undefined,
): { kind: RoutingKind; id: number } | null {
  if (!raw) return null;
  const [kind, idRaw] = raw.split(':');
  const id = parseInt(idRaw ?? '', 10);
  if (!Number.isFinite(id)) return null;
  if (
    kind === 'course' ||
    kind === 'retreat' ||
    kind === 'workshop' ||
    kind === 'balance'
  ) {
    return { kind, id };
  }
  return null;
}
