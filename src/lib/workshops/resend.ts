// Resend transactional email — the single mailer for the workshop engine.
// (Drip is tag-only now; all workshop email goes through Resend.)
//
// POST https://api.resend.com/emails  (Authorization: Bearer RESEND_API_KEY)

import { recordEmailSend } from '../email/sends';

export type SendEmailInput = {
  apiKey: string;
  // A single address, or several (Resend accepts an array). Used by the
  // internal order-notification, which lands in more than one inbox.
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  // A stable reference so Gmail threads/dedups and treats it as transactional.
  entityRefId?: string;
  // RFC 8058 one-click unsubscribe target. Set on marketing-flavoured sends
  // (abandoned checkout, post-workshop promotion, downsell); omitted on
  // transactional ones (verification, confirmation, reminders).
  listUnsubscribeUrl?: string;
  // Engagement tracking (open/click rates per email type). When `db` + `type`
  // are given, a successful send is recorded in email_sends keyed on the Resend
  // message id, so the Resend webhook can fold open/click events back onto it.
  // Recording is best-effort and never blocks or fails the send.
  track?: { db: D1Database; type: string; registrationId?: number | null; variant?: string | null };
};

const DEFAULT_FROM = 'Songdance <info@mail.songdance.co>';
const DEFAULT_REPLY_TO = 'jacob@songdance.co';

// Returns the Resend message id (when the API gives one) so callers can key
// engagement tracking on it. Recording into email_sends is done here when a
// `track` context is supplied — one place, so every tracked send is captured.
export async function sendEmail(input: SendEmailInput): Promise<{ id: string | null }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      from: input.from ?? DEFAULT_FROM,
      to: Array.isArray(input.to) ? input.to : [input.to],
      reply_to: input.replyTo ?? DEFAULT_REPLY_TO,
      subject: input.subject,
      html: input.html,
      ...(input.text ? { text: input.text } : {}),
      headers: {
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
        ...(input.entityRefId ? { 'X-Entity-Ref-ID': input.entityRefId } : {}),
        ...(input.listUnsubscribeUrl
          ? {
              'List-Unsubscribe': `<${input.listUnsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            }
          : {}),
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend: ${res.status} ${await res.text().catch(() => '')}`);
  }

  // Resend returns { id } (older shapes nested it under data); read both.
  let id: string | null = null;
  try {
    const data = (await res.json()) as { id?: string; data?: { id?: string } };
    id = data.id ?? data.data?.id ?? null;
  } catch {
    id = null;
  }

  if (input.track) {
    const firstTo = Array.isArray(input.to) ? input.to[0] : input.to;
    await recordEmailSend(input.track.db, {
      resendId: id,
      type: input.track.type,
      to: firstTo,
      subject: input.subject,
      registrationId: input.track.registrationId ?? null,
      variant: input.track.variant ?? null,
    });
  }

  return { id };
}
