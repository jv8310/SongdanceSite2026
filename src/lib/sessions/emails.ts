// The words of the individual-session emails. All transactional (they are
// about the client's own booking), so never suppression-gated; sent from the
// default Songdance sender with replies to support@.
//
// Copy-book rules hold here as everywhere: sounding, not singing; Jacob holds
// space, the client does the healing; acknowledgment, never "release"; no
// outcome promises.

import { escapeHtml, PALETTE, shell, type EmailContent } from '../workshops/emails';
import { tidyFirstName } from '../email/names';

type Link = { label: string; href: string };

export type SessionEmailCtx = {
  name?: string | null;
  whenLocal: string; // "Thu, 12 Nov 2026, 10:00 Brussels time" on the client's clock
  durationMin: number;
  joinUrl: string | null;
  passcode: string | null;
  manageUrl: string;
  icsUrl: string;
  googleCalUrl: string;
  // "Wed, 11 Nov 2026, 10:00 Brussels time" — the last moment they can move it
  // themselves; null when that has passed (or moving is switched off).
  moveUntilLabel: string | null;
};

function greeting(name?: string | null): string {
  const first = tidyFirstName(name);
  return first ? `Dear ${escapeHtml(first)},` : 'Hello,';
}
const textGreeting = (name?: string | null) => greeting(name).replace(/<[^>]+>/g, '').replace(/&#39;/g, "'");

const p = (html: string) => `<p style="margin:0 0 14px;">${html}</p>`;
const label = (text: string) =>
  `<p style="margin:20px 0 8px;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:${PALETTE.ember};">${escapeHtml(text)}</p>`;
const when = (text: string) => `<p style="margin:0 0 4px;font-size:18px;color:${PALETTE.ink};">${escapeHtml(text)}</p>`;

function zoomBlock(ctx: SessionEmailCtx): { html: string; text: string } {
  if (!ctx.joinUrl) {
    return {
      html: p('Your Zoom link follows by email before the session — and it will be on your booking page as soon as it is ready.'),
      text: 'Your Zoom link follows by email before the session — and it will be on your booking page as soon as it is ready.',
    };
  }
  const pass = ctx.passcode ? ` · passcode <strong>${escapeHtml(ctx.passcode)}</strong>` : '';
  return {
    html: `<p style="margin:0 0 14px;">Zoom: <a href="${escapeHtml(ctx.joinUrl)}" style="color:${PALETTE.ember};">${escapeHtml(ctx.joinUrl)}</a>${pass}</p>`,
    text: `Zoom: ${ctx.joinUrl}${ctx.passcode ? ` (passcode ${ctx.passcode})` : ''}`,
  };
}

const PREPARE_HTML = p(
  'There is nothing to prepare. If you would like to be comfortable: a quiet-ish room where a little sound is allowed, headphones if you share walls, water nearby. Come as you are — and as you sound.',
);
const PREPARE_TEXT =
  'There is nothing to prepare. If you would like to be comfortable: a quiet-ish room where a little sound is allowed, headphones if you share walls, water nearby. Come as you are — and as you sound.';

function moveLine(ctx: SessionEmailCtx): { html: string; text: string } {
  if (!ctx.moveUntilLabel) {
    return {
      html: p('Need to change something? Just reply to this email — a person reads it.'),
      text: 'Need to change something? Just reply to this email — a person reads it.',
    };
  }
  const t = `Need another moment? You can move the session yourself from your booking page until ${ctx.moveUntilLabel}. After that, just reply to this email.`;
  return { html: p(escapeHtml(t)), text: t };
}

function calendarExtras(ctx: SessionEmailCtx): Link[] {
  return [
    { label: 'Add to Google Calendar', href: ctx.googleCalUrl },
    { label: 'Apple / Outlook (.ics)', href: ctx.icsUrl },
  ];
}

// ── Booked ──────────────────────────────────────────────────────────────────
export function sessionConfirmedEmail(ctx: SessionEmailCtx): EmailContent {
  const z = zoomBlock(ctx);
  const mv = moveLine(ctx);
  const html = shell({
    preheader: `Your individual session with Jacob — ${ctx.whenLocal}`,
    heading: 'Your session is booked',
    bodyHtml: `${p(greeting(ctx.name))}
      ${p('Thank you — your individual session with Jacob is booked.')}
      ${when(ctx.whenLocal)}
      <p style="margin:0 0 14px;color:${PALETTE.soft};">${ctx.durationMin} minutes, one to one, on Zoom.</p>
      ${z.html}
      ${label('What happens')}
      ${p('Jacob holds the space; you bring what is there today. A few words to arrive, then sounding — at your pace, as soft as you like. Nothing is asked of you that you do not choose.')}
      ${label('How to prepare')}
      ${PREPARE_HTML}
      ${mv.html}
      <p style="margin:0;">We will send a reminder the day before and an hour before, each with the link.</p>`,
    cta: { label: 'Open my booking page', href: ctx.manageUrl },
    extras: calendarExtras(ctx),
    footerNote: 'Your individual session with Jacob · Songdance',
  });
  return {
    subject: `Your session with Jacob is booked — ${ctx.whenLocal}`,
    html,
    text: `${textGreeting(ctx.name)}\n\nThank you — your individual session with Jacob is booked.\n\nWhen: ${ctx.whenLocal}\n${ctx.durationMin} minutes, one to one, on Zoom.\n\n${z.text}\n\nWhat happens: Jacob holds the space; you bring what is there today. A few words to arrive, then sounding — at your pace, as soft as you like.\n\n${PREPARE_TEXT}\n\n${mv.text}\n\nYour booking page: ${ctx.manageUrl}\nAdd to Google Calendar: ${ctx.googleCalUrl}\nApple / Outlook (.ics): ${ctx.icsUrl}\n\nWe will send a reminder the day before and an hour before, each with the link.\n\nWarmly,\nJacob`,
  };
}

// ── Reminders ──────────────────────────────────────────────────────────────
export function sessionReminderEmail(kind: '24h' | '1h', ctx: SessionEmailCtx): EmailContent {
  const soon = kind === '1h';
  const z = zoomBlock(ctx);
  const lead = soon ? 'in an hour' : 'tomorrow';
  const html = shell({
    preheader: `Your session with Jacob is ${lead} — ${ctx.whenLocal}`,
    heading: soon ? 'Your session starts in an hour' : 'Your session is tomorrow',
    bodyHtml: `${p(greeting(ctx.name))}
      ${p(`Your individual session with Jacob is ${lead}:`)}
      ${when(ctx.whenLocal)}
      <p style="margin:0 0 14px;color:${PALETTE.soft};">${ctx.durationMin} minutes, on Zoom.</p>
      ${z.html}
      ${soon ? p('A few minutes early is perfect: Jacob lets you in from the waiting room when it begins.') : PREPARE_HTML}
      ${soon ? '' : moveLine(ctx).html}`,
    cta: ctx.joinUrl ? { label: 'Join on Zoom', href: ctx.joinUrl } : { label: 'Open my booking page', href: ctx.manageUrl },
    extras: ctx.joinUrl ? [{ label: 'My booking page', href: ctx.manageUrl }, ...(soon ? [] : calendarExtras(ctx))] : calendarExtras(ctx),
    footerNote: 'Your individual session with Jacob · Songdance',
  });
  return {
    subject: soon ? `In an hour: your session with Jacob` : `Tomorrow: your session with Jacob — ${ctx.whenLocal}`,
    html,
    text: `${textGreeting(ctx.name)}\n\nYour individual session with Jacob is ${lead}:\n${ctx.whenLocal} (${ctx.durationMin} minutes, on Zoom)\n\n${z.text}\n\n${soon ? 'A few minutes early is perfect: Jacob lets you in from the waiting room when it begins.' : `${PREPARE_TEXT}\n\n${moveLine(ctx).text}`}\n\nYour booking page: ${ctx.manageUrl}\n\nWarmly,\nJacob`,
  };
}

// ── Moved ──────────────────────────────────────────────────────────────────
export function sessionMovedEmail(ctx: SessionEmailCtx & { previousLocal: string }): EmailContent {
  const z = zoomBlock(ctx);
  const html = shell({
    preheader: `Your session with Jacob is now on ${ctx.whenLocal}`,
    heading: 'Your session has moved',
    bodyHtml: `${p(greeting(ctx.name))}
      ${p('Your individual session with Jacob is now on:')}
      ${when(ctx.whenLocal)}
      <p style="margin:0 0 14px;color:${PALETTE.soft};">instead of ${escapeHtml(ctx.previousLocal)}.</p>
      ${z.html}
      ${p('The calendar entry you may have saved still shows the old time — the buttons below add the new one.')}
      ${moveLine(ctx).html}`,
    cta: { label: 'Open my booking page', href: ctx.manageUrl },
    extras: calendarExtras(ctx),
    footerNote: 'Your individual session with Jacob · Songdance',
  });
  return {
    subject: `Your session with Jacob has moved — ${ctx.whenLocal}`,
    html,
    text: `${textGreeting(ctx.name)}\n\nYour individual session with Jacob is now on:\n${ctx.whenLocal}\ninstead of ${ctx.previousLocal}.\n\n${z.text}\n\nThe calendar entry you may have saved still shows the old time.\nAdd to Google Calendar: ${ctx.googleCalUrl}\nApple / Outlook (.ics): ${ctx.icsUrl}\n\n${moveLine(ctx).text}\n\nYour booking page: ${ctx.manageUrl}\n\nWarmly,\nJacob`,
  };
}

// ── Cancelled by Jacob ──────────────────────────────────────────────────────
export function sessionCancelledEmail(ctx: { name?: string | null; whenLocal: string; message?: string | null }): EmailContent {
  const msg = (ctx.message ?? '').trim();
  const html = shell({
    preheader: `Your session with Jacob on ${ctx.whenLocal} is cancelled`,
    heading: 'Your session is cancelled',
    bodyHtml: `${p(greeting(ctx.name))}
      ${p('Your individual session with Jacob on')}
      ${when(ctx.whenLocal)}
      ${p('is cancelled.')}
      ${msg ? `<p style="margin:0 0 14px;white-space:pre-line;">${escapeHtml(msg)}</p>` : ''}
      ${p('Questions? Just reply to this email — a person reads it.')}`,
    footerNote: 'Songdance · songdance.co',
  });
  return {
    subject: `Your session with Jacob on ${ctx.whenLocal} is cancelled`,
    html,
    text: `${textGreeting(ctx.name)}\n\nYour individual session with Jacob on ${ctx.whenLocal} is cancelled.\n${msg ? `\n${msg}\n` : ''}\nQuestions? Just reply to this email — a person reads it.\n\nWarmly,\nJacob`,
  };
}

// ── Paid, but the moment was taken meanwhile ─────────────────────────────────
export function sessionConflictEmail(ctx: { name?: string | null; whenLocal: string }): EmailContent {
  const html = shell({
    preheader: 'Your payment came through — we will find your moment with you',
    heading: 'Your payment came through',
    bodyHtml: `${p(greeting(ctx.name))}
      ${p('Thank you — your payment for an individual session with Jacob came through.')}
      ${p(`The moment you chose, <strong>${escapeHtml(ctx.whenLocal)}</strong>, was taken by someone else while you were paying. Nothing is lost: we will write to you within a day to find another time that suits you — or refund you in full, if you prefer.`)}
      ${p('You can also reply to this email straight away with a few moments that work for you.')}`,
    footerNote: 'Songdance · songdance.co',
  });
  return {
    subject: 'Your session with Jacob — we will find your moment with you',
    html,
    text: `${textGreeting(ctx.name)}\n\nThank you — your payment for an individual session with Jacob came through.\n\nThe moment you chose, ${ctx.whenLocal}, was taken by someone else while you were paying. Nothing is lost: we will write to you within a day to find another time that suits you — or refund you in full, if you prefer.\n\nYou can also reply to this email straight away with a few moments that work for you.\n\nWarmly,\nJacob`,
  };
}

// ── Internal note to Jacob / support (plain) ─────────────────────────────────
export function sessionInternalEmail(input: {
  subject: string;
  lines: string[];
  adminUrl: string;
}): EmailContent {
  const rows = input.lines.map((l) => `<p style="margin:0 0 8px;font-size:14px;color:#111827;">${escapeHtml(l)}</p>`).join('');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:22px 26px;">
    <h1 style="margin:0 0 14px;font-size:18px;color:#111827;">${escapeHtml(input.subject)}</h1>
    ${rows}
    <p style="margin:18px 0 0;"><a href="${input.adminUrl}" style="display:inline-block;padding:11px 18px;background:#c2410c;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;">Open individual sessions in admin →</a></p>
  </div>
</body></html>`;
  return { subject: input.subject, html, text: [input.subject, '', ...input.lines, '', input.adminUrl].join('\n') };
}
