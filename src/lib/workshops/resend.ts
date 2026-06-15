// Resend transactional email — the single mailer for the workshop engine.
// (Drip is tag-only now; all workshop email goes through Resend.)
//
// POST https://api.resend.com/emails  (Authorization: Bearer RESEND_API_KEY)

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
};

const DEFAULT_FROM = 'Songdance <info@mail.songdance.co>';
const DEFAULT_REPLY_TO = 'jacob@songdance.co';

export async function sendEmail(input: SendEmailInput): Promise<void> {
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
}
