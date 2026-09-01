// Waiting-list email — two moments only.
//
//   1. You're on the list (sent the moment someone joins).
//   2. A place has opened, and it's yours until <date> (sent when the admin
//      offers it from /admin/retreats/<slug>).
//
// Both are transactional: someone asked for them by putting their name down.
// Voice per docs/svh-copy-book.md — plain, warm, a little dry, short
// sentences. No promises, no scarcity theatre; the deadline on an offer is a
// real one (the place goes to the next person), so it's named plainly.
//
// The look mirrors the balance email (registrations/balance.ts) so retreat
// mail from Songdance is one family.

export interface RetreatEmailContent {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Shared shell: greeting, paragraphs, optional button, signature. Exported so
// the other retreat mail (bank-transfer.ts) is visibly the same family.
export function retreatEmail(args: {
  subject: string;
  greet: string;
  paragraphs: string[];
  // An optional boxed label/value panel — the bank details on the transfer
  // email. Rendered plainly ("Label: value") in the text part. Paragraphs
  // that read *after* the panel ("put this reference in the communication
  // field") go in paragraphsAfter, so the box lands where the prose points
  // at it rather than at the very end.
  details?: { label: string; value: string }[];
  paragraphsAfter?: string[];
  cta?: { intro: string; label: string; href: string };
  sig?: string;
  footnote?: string;
}): RetreatEmailContent {
  const sig = args.sig ?? 'With warmth,\nJacob';
  const detailLines = (args.details ?? []).map((d) => `${d.label}: ${d.value}`);
  const after = args.paragraphsAfter ?? [];
  const text = [
    args.greet,
    '',
    args.paragraphs.join('\n\n'),
    ...(detailLines.length ? ['', ...detailLines] : []),
    ...(after.length ? ['', after.join('\n\n')] : []),
    ...(args.cta ? ['', args.cta.intro, args.cta.href] : []),
    ...(args.footnote ? ['', args.footnote] : []),
    '',
    sig,
  ].join('\n');

  const para = (p: string) =>
    `<p style="margin:18px 0 0;font-family:Georgia,serif;font-size:16px;line-height:1.75;color:#2A1B2A;white-space:pre-line;">${escapeHtml(p)}</p>`;
  const paras = args.paragraphs.map(para).join('');
  const parasAfter = after.map(para).join('');

  const details = args.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;border:1px solid #DCCFC1;border-radius:10px;background:#FBF6EE;">
        <tr><td style="padding:18px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${args.details
              .map(
                (d) =>
                  `<tr>
                <td style="padding:6px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#7A6A78;white-space:nowrap;vertical-align:top;">${escapeHtml(d.label)}</td>
                <td style="padding:6px 0 6px 18px;font-family:Helvetica,Arial,sans-serif;font-size:16px;color:#2A1B2A;text-align:right;">${escapeHtml(d.value)}</td>
              </tr>`,
              )
              .join('')}
          </table>
        </td></tr>
      </table>`
    : '';

  const cta = args.cta
    ? `<p style="margin:28px 0 14px;font-family:Georgia,serif;font-size:15px;color:#4A3848;">${escapeHtml(args.cta.intro)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0;">
          <tr><td align="center" bgcolor="#2A1B2A" style="border-radius:999px;">
            <a href="${escapeHtml(args.cta.href)}" style="display:inline-block;padding:14px 30px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:500;letter-spacing:0.01em;color:#F4ECDF;text-decoration:none;border-radius:999px;">${escapeHtml(args.cta.label)} &rarr;</a>
          </td></tr>
        </table>`
    : '';

  const footnote = args.footnote
    ? `<p style="margin:26px 0 0;font-family:Georgia,serif;font-size:14px;line-height:1.7;color:#7A6A78;white-space:pre-line;">${escapeHtml(args.footnote)}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><title>${escapeHtml(args.subject)}</title></head>
<body style="margin:0;padding:0;background:#F4ECDF;font-family:Georgia,serif;color:#2A1B2A;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td align="center" style="padding:48px 16px;">
    <table role="presentation" width="540" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" style="padding:0 8px 28px;">
        <span style="font-family:Georgia,'Times New Roman',serif;font-size:13px;letter-spacing:0.22em;text-transform:uppercase;color:#7A6A78;">Songdance</span>
      </td></tr>
      <tr><td style="padding:0 8px;">
        <p style="margin:0;font-family:Georgia,serif;font-size:16px;line-height:1.7;color:#2A1B2A;">${escapeHtml(args.greet)}</p>
        ${paras}
        ${details}
        ${parasAfter}
        ${cta}
        ${footnote}
        <p style="margin:36px 0 0;font-family:Georgia,serif;font-size:16px;line-height:1.7;color:#2A1B2A;white-space:pre-line;">${escapeHtml(sig)}</p>
      </td></tr>
      <tr><td align="center" style="padding:36px 8px 0;">
        <p style="margin:0;font-family:Georgia,serif;font-size:11px;color:#B6A8B4;">songdance.co</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return { subject: args.subject, text, html };
}

// ── 1. You're on the list ──────────────────────────────────────────────
export function buildWaitlistJoinedEmail(args: {
  first_name: string | null;
  retreat_name: string;
  when_label: string | null;
  tier_name: string | null;
  position: number | null;
}): RetreatEmailContent {
  const { first_name, retreat_name, when_label, tier_name, position } = args;
  const greet = first_name ? `Hi ${first_name},` : 'Hi,';
  const when = when_label ? ` (${when_label})` : '';

  const paragraphs = [
    `You're on the waiting list for ${retreat_name}${when}. Every place is taken at the moment, so nothing is booked yet — but people's plans change, and when a place comes free we work down the list in the order people joined.`,
    tier_name
      ? `You've noted ${tier_name} as your preference. If a different room opens first we'll tell you what it is, and you decide.`
      : `You haven't tied yourself to one room, so we'll offer you whatever opens first and you decide.`,
    position
      ? `You're number ${position} on the list right now.`
      : `We'll be in touch the moment something opens.`,
    `If a place opens for you, you'll get an email with a link that holds it for a couple of days — long enough to think, short enough to be fair to the person behind you. Nothing is charged until you book.`,
  ];

  return retreatEmail({
    subject: `You're on the waiting list — ${retreat_name}`,
    greet,
    paragraphs,
    footnote:
      'Changed your mind, or want to come off the list? Just reply to this email.',
  });
}

// ── 2. A place has opened ──────────────────────────────────────────────
export function buildWaitlistOfferEmail(args: {
  first_name: string | null;
  retreat_name: string;
  when_label: string | null;
  tier_name: string;
  price_label: string | null;
  expires_label: string;
  link: string;
  message: string | null;
}): RetreatEmailContent {
  const {
    first_name,
    retreat_name,
    when_label,
    tier_name,
    price_label,
    expires_label,
    link,
    message,
  } = args;
  const greet = first_name ? `Hi ${first_name},` : 'Hi,';
  const when = when_label ? ` (${when_label})` : '';

  const paragraphs = [
    `A place has come free on ${retreat_name}${when}, and it's yours if you want it: ${tier_name}${price_label ? `, ${price_label}` : ''}.`,
    `It's held in your name until ${expires_label}. After that it goes to the next person on the list, so if you know you want it, take it now — and if you know you don't, a one-line reply frees it for someone else.`,
    ...(message ? [message] : []),
    `The link below opens the registration form with your place already unlocked and your details filled in. You pay in the ordinary way, and everything about the retreat stays as it was.`,
  ];

  return retreatEmail({
    subject: `A place has opened — ${retreat_name}`,
    greet,
    paragraphs,
    cta: { intro: 'Take your place:', label: 'Book my place', href: link },
    footnote: `If the button doesn't work, this is the link:\n${link}`,
  });
}
