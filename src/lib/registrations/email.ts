type ResendConfig = {
  apiKey: string;
  from: string;
};

export async function sendEmail(
  cfg: ResendConfig,
  to: string,
  subject: string,
  html: string,
  text?: string,
) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: cfg.from,
      to,
      subject,
      html,
      text: text ?? stripTags(html),
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string };
}

function stripTags(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function bookingConfirmationHtml(opts: {
  name: string;
  productName: string;
  tierName: string;
  amountCents: number;
  currency: string;
  startsAt: string | null;
  endsAt: string | null;
}) {
  const amount = (opts.amountCents / 100).toLocaleString('en-GB', {
    style: 'currency',
    currency: opts.currency,
  });
  return `
<!doctype html><html><body style="font-family: Georgia, serif; color:#2b2519; max-width:560px; margin:0 auto; padding:32px 24px; line-height:1.6;">
  <p>Dear ${escape(opts.name)},</p>
  <p>Your place at <strong>${escape(opts.productName)}</strong> is confirmed.</p>
  <p style="margin:24px 0; padding:16px 20px; background:#f6f1e9; border-radius:6px;">
    <strong>${escape(opts.tierName)}</strong><br/>
    ${opts.startsAt ? `Dates: ${escape(opts.startsAt)} → ${escape(opts.endsAt ?? '')}<br/>` : ''}
    Paid: ${amount}
  </p>
  <p>We will be in touch with practical details, room assignment, and any final questions in the weeks before. If you have anything to share now — dietary needs, roommate preference, travel plans — simply reply to this email.</p>
  <p>With warmth,<br/>Lesanne &amp; Jacob</p>
</body></html>`;
}

function escape(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
