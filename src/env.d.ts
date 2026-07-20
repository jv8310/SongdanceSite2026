/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PUBLISHABLE_KEY: string;
  // "true" offers PayPal in Checkout (one-off payments). Requires PayPal to be
  // activated in the Stripe Dashboard first — see paypalEnabled() in stripe.ts.
  STRIPE_ENABLE_PAYPAL?: string;
  // ── Direct PayPal gateway (separate from PayPal-via-Stripe above) ──
  // A PayPal Business app's REST credentials. When both client id + secret are
  // set, PayPal is offered as a second gateway alongside Stripe (one-off via
  // Orders API, installments via Subscriptions API). See src/lib/payments/paypal.ts.
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  // 'sandbox' to hit the PayPal sandbox host; anything else (or unset) = live.
  PAYPAL_ENV?: string;
  // "true" shows the "Pay with PayPal" button in the UI. A public var (not a
  // secret) so it's readable when the static register pages are prerendered at
  // build time. The server still requires the secrets before charging.
  PAYPAL_ENABLED?: string;
  // The webhook id from the PayPal Dashboard (Apps → Webhooks). Needed to
  // verify inbound webhook signatures at /api/payments/paypal-webhook.
  PAYPAL_WEBHOOK_ID?: string;
  QUADERNO_API_KEY: string;
  QUADERNO_ACCOUNT: string;
  QUADERNO_SANDBOX?: string;
  DRIP_API_TOKEN: string;
  DRIP_ACCOUNT_ID: string;
  // Turns on the one-shot historical Drip order backfill (the cron drain in
  // src/lib/orders/drip-backfill.ts). "1"/"true"/"yes"/"on" enables it; unset
  // or anything else keeps it off, so deploying the feature never emits
  // historical orders until the owner opts in. Flip it off once drained.
  DRIP_BACKFILL_ENABLED?: string;
  // Turns on the one-shot masterclass seat move (the cron drain in
  // src/lib/workshops/masterclass-move.ts): move secured seats from
  // masterclass-4 onto masterclass-5 and email each person their seat has
  // moved. "1"/"true"/"yes"/"on" enables it; unset or anything else keeps it
  // off, so merging/deploying the feature never moves or emails anyone until
  // the owner opts in. Flip it back off once it reports remaining=0.
  MASTERCLASS_MOVE_ENABLED?: string;
  // Workshop engine — Meta Conversions API (optional)
  META_PIXEL_ID?: string;
  META_ACCESS_TOKEN?: string;
  // Meta Marketing API — pull daily ad spend straight into workshop_ad_spend
  // (src/lib/ads/meta-insights.ts), so /ads + stats ROAS need no CSV import.
  // Both required to activate; the cron no-ops until they're set.
  //   • META_AD_ACCOUNT_ID — "act_1234567890" or bare "1234567890".
  //   • META_ADS_TOKEN — a token with `ads_read` on that account (a non-expiring
  //     System User token is ideal). Falls back to META_ACCESS_TOKEN, but the
  //     CAPI token usually lacks ads_read, so set this explicitly.
  META_AD_ACCOUNT_ID?: string;
  META_ADS_TOKEN?: string;
  // Optional Graph API version override for the ad-spend pull; default v21.0.
  META_API_VERSION?: string;
  // Workshop engine — Google Calendar import (optional; one auth path)
  GOOGLE_SA_JSON?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REFRESH_TOKEN?: string;
  GOOGLE_CALENDAR_ID?: string;
  DRIP_REGISTRATION_EVENT: string;
  DRIP_COURSE_EVENT?: string;
  RESEND_API_KEY: string;
  RESEND_FROM?: string;
  RESEND_INTAKES_FROM?: string;
  RESEND_REPLY_TO?: string;
  // Resend webhook (Svix) signing secret — set to verify the email-event
  // webhook at /api/webhooks/resend that powers /admin/emails/stats. When
  // unset, the endpoint accepts-and-ignores so it never retry-storms.
  RESEND_WEBHOOK_SECRET?: string;
  // Marketing-flavoured lifecycle sends (abandoned checkout, post-workshop,
  // downsell). Set these to move marketing onto a dedicated, separately
  // verified sending domain (e.g. a Jacob from Songdance <…@m.songdance.co>),
  // so its reputation is isolated from transactional mail on mail.songdance.co.
  // When unset, the defaults in src/lib/workshops/emails.ts apply.
  MARKETING_FROM?: string;
  MARKETING_REPLY_TO?: string;
  // Comma-separated recipients for the internal "SD-ORDER" purchase
  // notifications. Defaults to jacob@songdance.co + support@songdance.co.
  ORDER_NOTIFICATIONS_TO?: string;
  // Comma-separated recipients for the internal "SD-REPORT" daily/weekly
  // digests (src/lib/workshops/reports.ts). Falls back to
  // ORDER_NOTIFICATIONS_TO, then ADMIN_EMAIL, then jacob@songdance.co.
  REPORTS_TO?: string;
  // Comma-separated recipients for the internal "SD-BRIEFING" pre-workshop
  // roster (src/lib/workshops/cron.ts → briefing.ts), sent ~5 min before each
  // live session. Falls back to REPORTS_TO, then ADMIN_EMAIL, then jacob@.
  BRIEFING_TO?: string;
  ANTHROPIC_API_KEY?: string;
  // Post-workshop Songdeck gift — direct Shopify fulfilment (optional). When the
  // store domain + token + product id are set, the course checkout places the
  // free €0 deck order on the Songdeck Shopify shop via the Admin API instead of
  // emailing the SVH-BONUS coupon (see src/lib/orders/shopify.ts). No-ops until
  // set → the claim email.
  //   • SHOPIFY_STORE_DOMAIN    — the *.myshopify.com admin domain (NOT songdeck.shop)
  //   • SHOPIFY_ADMIN_TOKEN     — Admin API access token with write_draft_orders
  //   • SHOPIFY_DECK_PRODUCT_ID — the Songdeck product id (numeric, from the admin
  //     URL /admin/products/<id>, or a product gid). The Songdeck is the only
  //     product without variants, so its single variant is resolved automatically.
  //   • SHOPIFY_DECK_VARIANT_ID — optional: pin the variant id directly instead
  //   • SHOPIFY_API_VERSION     — optional Graph version override (default 2024-10)
  SHOPIFY_STORE_DOMAIN?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
  SHOPIFY_DECK_PRODUCT_ID?: string;
  SHOPIFY_DECK_VARIANT_ID?: string;
  SHOPIFY_API_VERSION?: string;
  // Google Address Validation API key (optional) — used to catch spelling
  // mistakes / missing parts in the deck-gift shipping address before the order
  // is placed (see src/lib/address/google-validate.ts). Unset → verification is
  // skipped and the typed address is used as-is (the sale is never blocked).
  GOOGLE_ADDRESS_VALIDATION_KEY?: string;
  SVH_CERT_PORTAL_URL?: string;
  // Admin login is email + password, multi-user. ADMIN_PASSWORD is the original
  // owner login (paired with ADMIN_EMAIL, default jacob@songdance.co). Add
  // collaborators in ADMIN_USERS — one `email:password` per line (or `;`-
  // separated), or a JSON array `[{"email":"…","password":"…"}]`. See
  // src/lib/registrations/auth.ts.
  ADMIN_PASSWORD: string;
  ADMIN_EMAIL?: string;
  ADMIN_USERS?: string;
  ADMIN_SESSION_SECRET: string;
  // Single shared password for the read-only ads-manager dashboard (/ads),
  // separate from the admin login. Unset → falls back to the owner-supplied
  // default in src/lib/ads/auth.ts. Set/rotate with
  // `wrangler secret put ADS_DASHBOARD_PASSWORD`.
  ADS_DASHBOARD_PASSWORD?: string;
  // Optional dedicated secret for unsubscribe-link HMACs; falls back to
  // ADMIN_SESSION_SECRET (see src/lib/email/unsubscribe.ts).
  UNSUBSCRIBE_SECRET?: string;
  PUBLIC_BASE_URL: string;
};

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
