// Deep links into the Stripe / PayPal dashboards for an order or installment
// plan, so the admin can jump straight from our views to the gateway's own
// source of truth (refunds, dunning, the customer's other charges, …).
//
// Mode-aware so the link lands in the right dashboard:
//   • Stripe   — test vs live, read from the secret-key prefix (sk_test / rk_test).
//   • PayPal   — sandbox vs live, read from PAYPAL_ENV (mirrors paypalBase()).
//
// We keep these as plain string builders (no network calls) so any admin page
// can compute them in its frontmatter from the row ids it already has.

export type StripeMode = 'live' | 'test';
export type PaypalMode = 'live' | 'sandbox';

export function stripeMode(env: { STRIPE_SECRET_KEY?: string }): StripeMode {
  // Stripe keys are `sk_test_…` / `rk_test_…` in test, `sk_live_…` in live.
  return /_test_/.test(env.STRIPE_SECRET_KEY ?? '') ? 'test' : 'live';
}

export function paypalMode(env: { PAYPAL_ENV?: string }): PaypalMode {
  return (env.PAYPAL_ENV ?? 'live').toLowerCase() === 'sandbox'
    ? 'sandbox'
    : 'live';
}

function stripeBase(mode: StripeMode): string {
  return mode === 'test'
    ? 'https://dashboard.stripe.com/test'
    : 'https://dashboard.stripe.com';
}

function paypalBase(mode: PaypalMode): string {
  return mode === 'sandbox'
    ? 'https://www.sandbox.paypal.com'
    : 'https://www.paypal.com';
}

export function stripeSubscriptionUrl(mode: StripeMode, id: string): string {
  return `${stripeBase(mode)}/subscriptions/${id}`;
}

export function stripePaymentUrl(mode: StripeMode, paymentIntent: string): string {
  return `${stripeBase(mode)}/payments/${paymentIntent}`;
}

export function paypalSubscriptionUrl(mode: PaypalMode, id: string): string {
  return `${paypalBase(mode)}/billing/subscriptions/${id}`;
}

// A capture / sale id is a transaction id — the merchant activity detail page
// resolves it. Used when there's no subscription to point at (one-off payments).
export function paypalActivityUrl(mode: PaypalMode, transactionId: string): string {
  return `${paypalBase(mode)}/activity/payment/${transactionId}`;
}

export type ProviderModes = { stripe: StripeMode; paypal: PaypalMode };

export function resolveProviderModes(env: {
  STRIPE_SECRET_KEY?: string;
  PAYPAL_ENV?: string;
}): ProviderModes {
  return { stripe: stripeMode(env), paypal: paypalMode(env) };
}

export type ProviderLink = { href: string; label: string } | null;

// Best dashboard link for a row, given which ids it carries. Prefers the
// subscription (the whole installment plan) over a single charge. Returns null
// when there's nothing to point at (e.g. an unpaid / free row).
export function providerLinkFor(
  o: {
    provider: 'stripe' | 'paypal';
    stripeSubscriptionId?: string | null;
    // The Stripe PaymentIntent. Accept both names so the helper works for a
    // ForecastPerson (stripePaymentIntent) and a UnifiedOrder (paymentIntent).
    stripePaymentIntent?: string | null;
    paymentIntent?: string | null;
    paypalSubscriptionId?: string | null;
    paypalCaptureId?: string | null;
  },
  modes: ProviderModes,
): ProviderLink {
  if (o.provider === 'paypal') {
    if (o.paypalSubscriptionId) {
      return {
        href: paypalSubscriptionUrl(modes.paypal, o.paypalSubscriptionId),
        label: 'PayPal',
      };
    }
    if (o.paypalCaptureId) {
      return {
        href: paypalActivityUrl(modes.paypal, o.paypalCaptureId),
        label: 'PayPal',
      };
    }
    return null;
  }
  if (o.stripeSubscriptionId) {
    return {
      href: stripeSubscriptionUrl(modes.stripe, o.stripeSubscriptionId),
      label: 'Stripe',
    };
  }
  const paymentIntent = o.stripePaymentIntent ?? o.paymentIntent;
  // Synthetic ids never existed in Stripe — a bank-transfer manual order
  // (`manual-…`) or a 100%-off comp (`free-…`). A dashboard link would 404, so
  // point at nothing instead.
  if (paymentIntent && !/^(manual|free)-/.test(paymentIntent)) {
    return {
      href: stripePaymentUrl(modes.stripe, paymentIntent),
      label: 'Stripe',
    };
  }
  return null;
}
