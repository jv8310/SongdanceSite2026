// The words of the "pay the remainder" email — pulled out of balance.ts so the
// /admin/emails preview page can render it without dragging the Stripe/PayPal
// checkout helpers along with it.
//
// Two ways to settle, in the order we prefer them:
//   1. a bank transfer to the Songdance account (the details are right in the
//      email), after which the guest replies and an admin marks the balance
//      paid by hand on /admin/retreats/<slug> → "Balance due" → "Mark paid";
//   2. the online checkout link, which settles itself through the webhook.

import { makeOrderNo } from '../admin/orders';
import { tidyFirstName } from '../email/names';

export interface BalanceEmailContent {
  subject: string;
  text: string;
  html: string;
}

// When the balance is due. Kept in sync with the deposit copy on the
// registration form + checkout.
export const BALANCE_DUE_LABEL = 'before 1 September 2026';

// The Songdance account. A SEPA transfer needs the IBAN alone (no BIC), which
// is why only these two lines are quoted.
export const BANK_TRANSFER = {
  accountName: 'Songdance BV',
  iban: 'BE43 0689 3690 1001',
} as const;

// Where "just reply and I'll mark it paid" lands. Matches the Reply-To the
// send sets, and is named in the copy in case a client hides it.
export const BALANCE_REPLY_TO = 'jacob@songdance.co';

// What the guest puts in the transfer's communication field, and what an admin
// can then search for on /admin/orders. Same namespaced number that page uses.
export function balancePaymentReference(registrationId: number): string {
  return makeOrderNo('retreat', registrationId);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildBalanceEmail(args: {
  first_name: string | null;
  event_name: string;
  amount_label: string;
  due_label: string;
  link: string;
  reference: string;
}): BalanceEmailContent {
  const { first_name, event_name, amount_label, due_label, link, reference } = args;
  const greetName = tidyFirstName(first_name);
  const greet = greetName ? `Hi ${greetName},` : 'Hi,';
  const subject = `Your remaining balance for ${event_name}`;

  const intro =
    `Thank you for reserving your place on ${event_name} with a deposit. ` +
    `Your remaining balance of ${amount_label} is now due (${due_label}).`;
  const choice =
    'There are two ways to settle it. A bank transfer is the one we prefer — ' +
    'it goes straight to us, with no card fees in between.';

  const bankHeading = 'Bank transfer — preferred';
  // `strong` marks the number they will actually copy across into their bank.
  const bankRows: Array<{ label: string; value: string; strong?: boolean }> = [
    { label: 'Account name', value: BANK_TRANSFER.accountName },
    { label: 'IBAN', value: BANK_TRANSFER.iban, strong: true },
    { label: 'Amount', value: amount_label },
    { label: 'Reference', value: reference },
  ];
  const bankNote =
    `Once you have sent it, simply reply to this email (it reaches me at ` +
    `${BALANCE_REPLY_TO}) and I will mark your balance as paid by hand. ` +
    `If your bank will not take the reference, your own name is enough.`;

  const cardHeading = 'Or pay online';
  // "opens a fresh checkout every time" is not filler: the link used to BE the
  // gateway's own checkout URL, which expired within a day and met everyone who
  // came back to the email with "this checkout session has timed out". It now
  // points at our own page, which mints a new checkout on each click — worth
  // saying to anyone who already hit the dead one.
  const cardBody =
    'If a card or PayPal is easier, this link is a checkout for your exact ' +
    'remaining balance — it takes a minute, and clears itself automatically. ' +
    'It opens a fresh checkout every time, so it keeps working however long ' +
    'you leave it.';
  const ctaBtn = `Pay ${amount_label}`;
  const sig = 'With warmth,\nJacob';

  const text =
    `${greet}\n\n${intro}\n\n${choice}\n\n` +
    `${bankHeading.toUpperCase()}\n` +
    bankRows.map((r) => `${r.label}: ${r.value}`).join('\n') +
    `\n\n${bankNote}\n\n` +
    `${cardHeading.toUpperCase()}\n${cardBody}\n${link}\n\n${sig}`;

  const p = 'margin:18px 0 0;font-family:Georgia,serif;font-size:16px;line-height:1.75;color:#2A1B2A;';
  const bankRowsHtml = bankRows
    .map(
      (r) => `
            <tr>
              <td style="padding:5px 14px 5px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#7A6A78;white-space:nowrap;vertical-align:top;">${escapeHtml(r.label)}</td>
              <td style="padding:5px 0;font-family:Georgia,serif;font-size:${r.strong ? '18px;font-weight:700;letter-spacing:0.04em' : '16px'};color:#2A1B2A;">${escapeHtml(r.value)}</td>
            </tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F4ECDF;font-family:Georgia,serif;color:#2A1B2A;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td align="center" style="padding:48px 16px;">
    <table role="presentation" width="540" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" style="padding:0 8px 28px;">
        <span style="font-family:Georgia,'Times New Roman',serif;font-size:13px;letter-spacing:0.22em;text-transform:uppercase;color:#7A6A78;">Songdance</span>
      </td></tr>
      <tr><td style="padding:0 8px;">
        <p style="margin:0;font-family:Georgia,serif;font-size:16px;line-height:1.7;color:#2A1B2A;">${escapeHtml(greet)}</p>
        <p style="${p}">${escapeHtml(intro)}</p>
        <p style="${p}">${escapeHtml(choice)}</p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;background:#FBF6EC;border:1px solid rgba(42,27,42,0.14);border-radius:12px;">
          <tr><td style="padding:20px 22px;">
            <p style="margin:0 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#8A5A2B;">${escapeHtml(bankHeading)}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">${bankRowsHtml}
            </table>
          </td></tr>
        </table>

        <p style="${p}">${escapeHtml(bankNote)}</p>

        <p style="margin:34px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#7A6A78;">${escapeHtml(cardHeading)}</p>
        <p style="margin:10px 0 0;font-family:Georgia,serif;font-size:16px;line-height:1.75;color:#2A1B2A;">${escapeHtml(cardBody)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;">
          <tr><td align="center" bgcolor="#2A1B2A" style="border-radius:999px;">
            <a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 30px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:500;letter-spacing:0.01em;color:#F4ECDF;text-decoration:none;border-radius:999px;">${escapeHtml(ctaBtn)} &rarr;</a>
          </td></tr>
        </table>

        <p style="margin:36px 0 0;font-family:Georgia,serif;font-size:16px;line-height:1.7;color:#2A1B2A;white-space:pre-line;">${escapeHtml(sig)}</p>
      </td></tr>
      <tr><td align="center" style="padding:36px 8px 0;">
        <p style="margin:0;font-family:Georgia,serif;font-size:11px;color:#B6A8B4;">songdance.co</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return { subject, html, text };
}
