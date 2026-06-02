/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PUBLISHABLE_KEY: string;
  QUADERNO_API_KEY: string;
  QUADERNO_ACCOUNT: string;
  QUADERNO_SANDBOX?: string;
  DRIP_API_TOKEN: string;
  DRIP_ACCOUNT_ID: string;
  // Workshop engine — Meta Conversions API (optional)
  META_PIXEL_ID?: string;
  META_ACCESS_TOKEN?: string;
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
  ANTHROPIC_API_KEY?: string;
  SVH_CERT_PORTAL_URL?: string;
  ADMIN_PASSWORD: string;
  ADMIN_SESSION_SECRET: string;
  PUBLIC_BASE_URL: string;
};

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
