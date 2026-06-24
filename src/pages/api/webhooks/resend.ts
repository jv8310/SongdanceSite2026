// Resend event webhook → folds delivery/open/click/bounce/complaint events onto
// the email_sends row recorded at send time (keyed on the Resend message id).
// Powers the open/click rates on /admin/emails/stats.
//
// Configure in the Resend dashboard (Webhooks → add endpoint):
//   URL:    https://site.songdance.co/api/webhooks/resend
//   Events: email.delivered, email.opened, email.clicked, email.bounced,
//           email.complained  (open/click tracking must also be enabled on the
//           sending domain for opened/clicked to fire at all)
// then set the signing secret as the RESEND_WEBHOOK_SECRET worker secret.

import type { APIRoute } from 'astro';
import { applyResendEvent } from '../../../lib/email/sends';
import { readSvixHeaders, verifyResendWebhook } from '../../../lib/email/resend-webhook';
import { logEvent } from '../../../lib/registrations/db';

export const prerender = false;

type ResendWebhookBody = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    id?: string;
    created_at?: string;
    // email.bounced carries SES-style bounce metadata; type is
    // 'Permanent' | 'Transient' | 'Undetermined'. Used to suppress hard bounces.
    bounce?: { type?: string };
  };
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  // Not configured yet → accept-and-ignore so Resend doesn't retry-storm while
  // the secret is still being wired up. Nothing is recorded.
  if (!env.RESEND_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ ok: true, skipped: 'not_configured' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rawBody = await request.text();
  const verified = await verifyResendWebhook(
    rawBody,
    readSvixHeaders(request.headers),
    env.RESEND_WEBHOOK_SECRET,
  );
  if (!verified) {
    return new Response(JSON.stringify({ error: 'invalid signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: ResendWebhookBody;
  try {
    body = JSON.parse(rawBody) as ResendWebhookBody;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const type = body.type ?? '';
  const resendId = body.data?.email_id ?? body.data?.id ?? '';
  const atIso = body.data?.created_at ?? body.created_at ?? new Date().toISOString();

  if (resendId && type.startsWith('email.')) {
    try {
      await applyResendEvent(env.DB, type, resendId, atIso, { bounceType: body.data?.bounce?.type });
    } catch (err) {
      // Never fail the webhook on a write hiccup (e.g. table not migrated yet);
      // log for visibility and ack so Resend moves on.
      await logEvent(env.DB, {
        registration_id: null,
        kind: 'email.webhook.error',
        payload: { type, resend_id: resendId, error: String(err) },
      }).catch(() => {});
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
