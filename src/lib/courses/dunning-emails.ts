// The words of the failed-installment sequence — three reminders to the buyer
// and the internal hand-off to support. Pure builders (no DB, no Stripe) so
// /admin/emails can preview and test-send them beside the lifecycle mail; the
// cadence and the sending live in ./dunning.ts.
//
// Tone: this is somebody's money and somebody's course, and a failed card is
// almost never a decision — it's an expired card, a bank's fraud filter, a
// limit. So the reminders say what happened, say their place hasn't changed,
// give the one link that fixes it, and offer a person. No threats, no
// countdowns, nothing implied that nobody has decided: the third reminder says
// only what is true — that support takes it from there.
//
// Transactional (about a purchase they made), so they ignore marketing
// suppression, like the seat confirmation.

import { escapeHtml, shell, type EmailContent } from '../workshops/emails';
import { tidyFirstName } from '../email/names';

export type DunningReminderCtx = {
  name?: string | null;
  // "the 12-Week Somatic Vocal Healing Course"
  courseName: string;
  // The installment that failed, formatted in its own currency ("€190.95").
  installmentLabel: string;
  // When it fell due, already formatted ("23 August").
  dueLabel: string;
  // Everything outstanding on the plan right now — usually just that one
  // installment; more when the plan fell a month further behind.
  outstandingCount: number;
  outstandingLabel: string;
  // The durable card-update link (./card-update-link.ts).
  updateUrl: string;
};

export type DunningStep = 1 | 2 | 3;

const SIGN_OFF_TEXT = 'Warmly,\nJacob';

function greetingHtml(name?: string | null): string {
  const first = tidyFirstName(name);
  return first ? `Dear ${escapeHtml(first)},` : 'Hello,';
}

function greetingText(name?: string | null): string {
  const first = tidyFirstName(name);
  return first ? `Dear ${first},` : 'Hello,';
}

// "the €190.95 installment is charged" / "the 2 outstanding installments
// (€381.90 in total) are charged" — what the link will actually take.
function chargedClause(ctx: DunningReminderCtx): string {
  return ctx.outstandingCount > 1
    ? `the ${ctx.outstandingCount} outstanding installments (${ctx.outstandingLabel} in total) are charged`
    : `the ${ctx.installmentLabel} installment is charged`;
}

const P = 'margin:0 0 14px;';

export function dunningReminderEmail(step: DunningStep, ctx: DunningReminderCtx): EmailContent {
  const course = ctx.courseName;
  const charged = chargedClause(ctx);
  const cta = { label: 'Update my card', href: ctx.updateUrl };

  if (step === 1) {
    const subject = "Your course installment didn't go through";
    const lines = [
      `Your ${ctx.installmentLabel} installment for ${course}, due on ${ctx.dueLabel}, didn't go through. It happens — a card expires, a bank flags a payment it doesn't recognise, a limit gets reached.`,
      `Nothing about your place in the course has changed. To keep your plan going, add a card on the secure page below. It takes a minute: as soon as the card is saved, ${charged}, and the rest of your installments run on the new card.`,
    ];
    const after = 'If something else is going on, just reply to this email. A person reads it.';
    return {
      subject,
      html: shell({
        preheader: 'Nothing about your place has changed — a new card takes a minute.',
        heading: "Your installment didn't go through",
        bodyHtml: `<p style="${P}">${greetingHtml(ctx.name)}</p>
      ${lines.map((l) => `<p style="${P}">${escapeHtml(l)}</p>`).join('\n      ')}
      <p style="margin:0;font-size:14px;">${escapeHtml(after)}</p>`,
        cta,
      }),
      text: `${greetingText(ctx.name)}\n\n${lines.join('\n\n')}\n\nUpdate your card here:\n${ctx.updateUrl}\n\n${after}\n\n${SIGN_OFF_TEXT}`,
    };
  }

  if (step === 2) {
    const subject = 'Your course installment is still open';
    const lines = [
      `A few days ago I wrote that your ${ctx.installmentLabel} installment for ${course} didn't go through. It's still open, so here is the link again.`,
      `It opens a secure page where you add a card — as soon as it's saved, ${charged}, and your plan carries on as before.`,
    ];
    const after =
      "If money is tight right now, or something else is in the way, reply and tell us. We'd rather hear from you than guess.";
    return {
      subject,
      html: shell({
        preheader: 'The link to add a new card, once more.',
        heading: 'Your installment is still open',
        bodyHtml: `<p style="${P}">${greetingHtml(ctx.name)}</p>
      ${lines.map((l) => `<p style="${P}">${escapeHtml(l)}</p>`).join('\n      ')}
      <p style="margin:0;font-size:14px;">${escapeHtml(after)}</p>`,
        cta,
      }),
      text: `${greetingText(ctx.name)}\n\n${lines.join('\n\n')}\n\nUpdate your card here:\n${ctx.updateUrl}\n\n${after}\n\n${SIGN_OFF_TEXT}`,
    };
  }

  const subject = 'Last reminder: your course installment';
  const lines = [
    `Your ${ctx.installmentLabel} installment for ${course} is still open, so this is the last automatic reminder about it.`,
    `Updating your card takes a minute: the link below opens a secure page, and as soon as the new card is saved, ${charged}.`,
  ];
  const after =
    "If it's still open after this, our support team will take it from there. And if you'd rather sort it out with a person now, simply reply to this email.";
  return {
    subject,
    html: shell({
      preheader: 'The last automatic reminder about your installment.',
      heading: 'One last reminder',
      bodyHtml: `<p style="${P}">${greetingHtml(ctx.name)}</p>
      ${lines.map((l) => `<p style="${P}">${escapeHtml(l)}</p>`).join('\n      ')}
      <p style="margin:0;font-size:14px;">${escapeHtml(after)}</p>`,
      cta,
    }),
    text: `${greetingText(ctx.name)}\n\n${lines.join('\n\n')}\n\nUpdate your card here:\n${ctx.updateUrl}\n\n${after}\n\n${SIGN_OFF_TEXT}`,
  };
}

// ── The hand-off to support (internal, "SD-PAYMENT") ───────────────────────

export type DunningEscalationCtx = {
  orderNo: string; // "C-123"
  name: string;
  email: string;
  courseName: string;
  plan: string; // "3×"
  installmentsPaid: number;
  installmentsTotal: number;
  outstandingCount: number;
  outstandingLabel: string;
  invoiceNumber: string | null;
  dueLabel: string;
  stripeAttempts: number;
  subscriptionStatus: string | null;
  // "12 Sep" per reminder, in order.
  reminders: string[];
  // What the buyer did with the link, if anything.
  cardUpdate: { when: string; outcome: string; message: string | null } | null;
  updateUrl: string;
  orderUrl: string;
  futureRevenueUrl: string;
  stripeUrl: string | null;
};

const CARD_OUTCOME_WORDS: Record<string, string> = {
  paid: 'the charge went through',
  nothing_owed: 'nothing was outstanding at the time',
  processing: 'a bank debit was started',
  declined: 'the bank declined the charge',
  needs_action: 'the bank asked them to confirm the charge, and it was not confirmed',
  error: 'the charge could not be attempted',
};

export function cardOutcomeWords(outcome: string): string {
  return CARD_OUTCOME_WORDS[outcome] ?? outcome;
}

export function dunningEscalationEmail(ctx: DunningEscalationCtx): EmailContent {
  const subject = `SD-PAYMENT: installment still unpaid after 3 reminders — ${ctx.name} (${ctx.orderNo})`;
  const cardLine = ctx.cardUpdate
    ? `Saved a new card on ${ctx.cardUpdate.when} — ${cardOutcomeWords(ctx.cardUpdate.outcome)}${
        ctx.cardUpdate.message ? ` ("${ctx.cardUpdate.message}")` : ''
      }.`
    : 'Has not saved a new card.';
  const rows: Array<[string, string]> = [
    ['Customer', `${ctx.name} <${ctx.email}>`],
    ['Course', `${ctx.courseName} · ${ctx.orderNo}`],
    ['Plan', `${ctx.plan} · ${ctx.installmentsPaid}/${ctx.installmentsTotal} paid`],
    [
      'Outstanding',
      ctx.outstandingCount > 1
        ? `${ctx.outstandingLabel} (${ctx.outstandingCount} installments)`
        : ctx.outstandingLabel,
    ],
    [
      'Failed invoice',
      `${ctx.invoiceNumber ?? '—'} · due ${ctx.dueLabel} · ${ctx.stripeAttempts} Stripe attempt${ctx.stripeAttempts === 1 ? '' : 's'}`,
    ],
    ['Subscription', ctx.subscriptionStatus ?? '—'],
    ['Reminders', ctx.reminders.map((d, i) => `${i + 1}: ${d}`).join(' · ')],
    ['Card update', cardLine],
  ];
  const intro =
    'Three reminders have gone out and this installment is still unpaid, so the automatic sequence stops here and hands it to you. Nothing else happens on its own — the plan stays as it is until someone decides.';
  const options = [
    'Write to them personally — the card link below is theirs, it never expires, and it charges whatever is outstanding the moment a card is saved.',
    `Cancel the plan: on the Future revenue page, Cancel… → "Stop now" → Apply ends all further charges (the same control is under "Charges still to come" on ${ctx.orderNo}). Course access is not changed by that.`,
    'Or leave it open if they have told you a payment is coming.',
  ];

  const td =
    'padding:6px 14px 6px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#7A6A78;white-space:nowrap;vertical-align:top;';
  const tv = 'padding:6px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#2A1B2A;';
  const link = (href: string, label: string) =>
    `<a href="${escapeHtml(href)}" style="color:#A14826;">${escapeHtml(label)}</a>`;
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#F4ECDF;font-family:Helvetica,Arial,sans-serif;color:#2A1B2A;">
  <table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:100%;background:#FBF6EC;border:1px solid rgba(42,27,42,0.14);border-radius:12px;">
    <tr><td style="padding:24px 26px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#B53D3D;">Installment unpaid — your call</p>
      <h1 style="margin:0 0 14px;font-family:Georgia,serif;font-weight:400;font-size:22px;">${escapeHtml(ctx.name)} · ${escapeHtml(ctx.outstandingLabel)}</h1>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">${escapeHtml(intro)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        ${rows.map(([k, v]) => `<tr><td style="${td}">${escapeHtml(k)}</td><td style="${tv}">${escapeHtml(v)}</td></tr>`).join('\n        ')}
      </table>
      <p style="margin:22px 0 8px;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#7A6A78;">What you can do</p>
      ${options.map((o) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;">• ${escapeHtml(o)}</p>`).join('\n      ')}
      <p style="margin:18px 0 6px;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#7A6A78;">Their card link</p>
      <p style="margin:0 0 18px;font-size:13px;word-break:break-all;"><code>${escapeHtml(ctx.updateUrl)}</code></p>
      <p style="margin:0;font-size:14px;line-height:2;">
        ${link(ctx.orderUrl, `Open ${ctx.orderNo}`)} &nbsp;·&nbsp;
        ${link(ctx.futureRevenueUrl, 'Future revenue')}
        ${ctx.stripeUrl ? `&nbsp;·&nbsp; ${link(ctx.stripeUrl, 'Open in Stripe')}` : ''}
      </p>
    </td></tr>
  </table>
</body></html>`;

  const text =
    `${intro}\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\nWHAT YOU CAN DO\n${options.map((o) => `- ${o}`).join('\n')}` +
    `\n\nTheir card link:\n${ctx.updateUrl}\n\n` +
    `Open ${ctx.orderNo}: ${ctx.orderUrl}\nFuture revenue: ${ctx.futureRevenueUrl}` +
    (ctx.stripeUrl ? `\nStripe: ${ctx.stripeUrl}` : '');

  return { subject, html, text };
}
