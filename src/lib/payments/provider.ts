// Shared payment-provider plumbing used by both the Stripe and PayPal paths.
//
// `provider` is recorded on every order/registration row (see migration 0049).
// PayPal objects carry a compact `custom_id` routing key — "<kind>:<id>" — so a
// webhook (or the return endpoint) can resolve a capture / subscription payment
// back to the right table + row without stuffing all our metadata into PayPal.
// Everything else about the order already lives on our DB row, looked up by id.

export type PaymentProvider = 'stripe' | 'paypal';

export type RoutingKind = 'course' | 'retreat' | 'workshop' | 'balance';

export function isPaymentProvider(v: unknown): v is PaymentProvider {
  return v === 'stripe' || v === 'paypal';
}

// Read a provider from a request body / query param, defaulting to Stripe so
// every existing caller and any malformed value keeps the current behaviour.
export function parseProvider(v: unknown): PaymentProvider {
  return v === 'paypal' ? 'paypal' : 'stripe';
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
