// Templated workshop emails — table-based, ~560px, parchment / plum-ink /
// ember palette ported from the existing transactional design. Each builder
// returns { subject, html, text } ready for Resend.

const PALETTE = {
  bg: '#F4ECDF',
  card: '#FBF6EC',
  ink: '#2A1B2A',
  soft: '#4A3848',
  faint: '#B6A8B4',
  ember: '#A14826',
  border: 'rgba(161,72,38,0.22)',
};

const LOGO_URL = 'https://site.songdance.co/brand/logo-wordmark-dark.png';

export type EmailContent = { subject: string; html: string; text: string };

type ButtonLink = { label: string; href: string };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Shared shell. `bodyHtml` is dropped into the parchment card; `cta` renders
// a primary button; `extras` renders secondary links beneath it.
function shell(opts: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  cta?: ButtonLink;
  extras?: ButtonLink[];
  footerNote?: string;
}): string {
  const { preheader, heading, bodyHtml, cta, extras, footerNote } = opts;
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light only" />
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PALETTE.bg};font-family:Georgia,'Times New Roman',serif;color:${PALETTE.ink};">
  <div style="display:none;font-size:1px;color:${PALETTE.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PALETTE.bg};">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;">
        <tr><td align="center" style="padding:0 24px 8px;">
          <h1 style="margin:0;font-family:Georgia,serif;font-weight:400;font-size:28px;line-height:1.2;letter-spacing:-0.01em;color:${PALETTE.ink};">${escapeHtml(heading)}</h1>
        </td></tr>
        <tr><td style="padding:20px 24px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PALETTE.card};border:1px solid ${PALETTE.border};border-radius:14px;">
            <tr><td style="padding:30px 34px;font-family:Georgia,serif;font-size:16px;line-height:1.65;color:${PALETTE.soft};">
              ${bodyHtml}
              ${cta ? `<div style="padding-top:22px;"><a href="${cta.href}" style="display:inline-block;background-color:${PALETTE.ink};color:${PALETTE.bg};font-family:Georgia,serif;font-size:15px;line-height:1;text-decoration:none;padding:14px 26px;border-radius:999px;">${escapeHtml(cta.label)}</a></div>` : ''}
              ${extras && extras.length ? `<div style="padding-top:18px;font-size:14px;line-height:1.8;">${extras.map((e) => `<a href="${e.href}" style="color:${PALETTE.ember};text-decoration:none;">${escapeHtml(e.label)}</a>`).join('&nbsp;&nbsp;·&nbsp;&nbsp;')}</div>` : ''}
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:40px 24px 6px;">
          <a href="https://songdance.co"><img src="${LOGO_URL}" alt="Songdance" width="96" style="display:block;width:96px;height:auto;opacity:0.55;" /></a>
        </td></tr>
        <tr><td align="center" style="padding:10px 24px 24px;">
          <p style="margin:0;font-family:Georgia,serif;font-size:11px;line-height:1.6;color:${PALETTE.faint};">${escapeHtml(footerNote ?? 'Songdance · songdance.co')}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export type WorkshopEmailCtx = {
  name?: string | null;
  workshopTitle: string;
  whenLocal: string; // already formatted in the registrant's tz
  joinUrl: string; // success/countdown page
  googleCalUrl?: string;
  icsUrl?: string;
};

function greeting(name?: string | null): string {
  const first = (name ?? '').trim().split(' ')[0];
  return first ? `Dear ${escapeHtml(first)},` : 'Hello,';
}

// ── Verification code ────────────────────────────────────────────────────
export function verificationEmail(code: string): EmailContent {
  const html = shell({
    preheader: `Your verification code is ${code}`,
    heading: 'Confirm your email',
    bodyHtml: `<p style="margin:0 0 14px;">Use this code to confirm your email and continue your registration:</p>
      <p style="margin:0;text-align:center;font-size:34px;letter-spacing:0.3em;color:${PALETTE.ink};font-weight:400;">${escapeHtml(code)}</p>
      <p style="margin:18px 0 0;font-size:13px;color:${PALETTE.faint};">This code expires in 15 minutes. If you didn't request it, you can ignore this email.</p>`,
  });
  return {
    subject: `${code} is your verification code`,
    html,
    text: `Your verification code is ${code}. It expires in 15 minutes.`,
  };
}

// ── Registration confirmation ────────────────────────────────────────────
export function confirmationEmail(ctx: WorkshopEmailCtx): EmailContent {
  const extras: ButtonLink[] = [];
  if (ctx.googleCalUrl) extras.push({ label: 'Add to Google Calendar', href: ctx.googleCalUrl });
  if (ctx.icsUrl) extras.push({ label: 'Apple / Outlook (.ics)', href: ctx.icsUrl });
  const html = shell({
    preheader: `You're registered for ${ctx.workshopTitle}`,
    heading: "You're in",
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">Your place in <strong>${escapeHtml(ctx.workshopTitle)}</strong> is confirmed.</p>
      <p style="margin:0 0 6px;">It takes place on:</p>
      <p style="margin:0 0 4px;font-size:18px;color:${PALETTE.ink};">${escapeHtml(ctx.whenLocal)}</p>
      <p style="margin:14px 0 0;">When the time comes, open your countdown page below — the Join button appears 5 minutes before we begin and takes you straight into the room.</p>`,
    cta: { label: 'Open my countdown page', href: ctx.joinUrl },
    extras,
  });
  return {
    subject: `You're registered — ${ctx.workshopTitle}`,
    html,
    text: `${greeting(ctx.name).replace(/<[^>]+>/g, '')}\n\nYour place in ${ctx.workshopTitle} is confirmed.\n\nWhen: ${ctx.whenLocal}\n\nYour countdown / join page: ${ctx.joinUrl}\n\nThe Join button appears 5 minutes before we begin.`,
  };
}

// ── Reminders ──────────────────────────────────────────────────────────────
const REMINDER_LEAD: Record<string, string> = {
  reminder_7d: 'in one week',
  reminder_2d: 'in two days',
  reminder_1d: 'tomorrow',
  reminder_6h: 'in a few hours',
  reminder_1h: 'in one hour',
  reminder_15m: 'in 15 minutes',
  at_time: 'now',
};

export function reminderEmail(type: string, ctx: WorkshopEmailCtx): EmailContent {
  const lead = REMINDER_LEAD[type] ?? 'soon';
  const isImminent = type === 'reminder_15m' || type === 'at_time' || type === 'reminder_1h';
  const html = shell({
    preheader: `${ctx.workshopTitle} starts ${lead}`,
    heading: type === 'at_time' ? "We're starting" : `Starting ${lead}`,
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;"><strong>${escapeHtml(ctx.workshopTitle)}</strong> starts ${lead}.</p>
      <p style="margin:0 0 4px;font-size:18px;color:${PALETTE.ink};">${escapeHtml(ctx.whenLocal)}</p>
      <p style="margin:14px 0 0;">${isImminent ? 'Open your page now — the Join button is ready.' : 'Open your countdown page below; the Join button appears 5 minutes before we begin.'}</p>`,
    cta: { label: isImminent ? 'Join now' : 'Open my countdown page', href: ctx.joinUrl },
  });
  return {
    subject: type === 'at_time'
      ? `We're starting — ${ctx.workshopTitle}`
      : `Reminder: ${ctx.workshopTitle} starts ${lead}`,
    html,
    text: `${greeting(ctx.name).replace(/<[^>]+>/g, '')}\n\n${ctx.workshopTitle} starts ${lead}.\nWhen: ${ctx.whenLocal}\n\nYour join page: ${ctx.joinUrl}`,
  };
}

// ── Post-workshop: attended ─────────────────────────────────────────────────
export function postAttendedEmail(
  ctx: { name?: string | null; workshopTitle: string; courseUrl: string; certUrl?: string },
): EmailContent {
  const extras: ButtonLink[] = [];
  if (ctx.certUrl) extras.push({ label: 'Explore the Certification', href: ctx.certUrl });
  const html = shell({
    preheader: `Thank you for being with us`,
    heading: 'Thank you for singing with us',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">Thank you for being part of <strong>${escapeHtml(ctx.workshopTitle)}</strong>. We hope something opened.</p>
      <p style="margin:0 0 14px;">If you'd like to take the practice further, the 12-week course is where the real work lives — twelve weeks to learn it properly, in your own time, with live Q&amp;A.</p>`,
    cta: { label: 'See the 12-week course', href: ctx.courseUrl },
    extras,
  });
  return {
    subject: `Thank you — ${ctx.workshopTitle}`,
    html,
    text: `${greeting(ctx.name).replace(/<[^>]+>/g, '')}\n\nThank you for being part of ${ctx.workshopTitle}.\n\nThe 12-week course: ${ctx.courseUrl}`,
  };
}

// ── Post-workshop: no-show ──────────────────────────────────────────────────
export function postNoShowEmail(
  ctx: { name?: string | null; workshopTitle: string; replayUrl: string },
): EmailContent {
  const html = shell({
    preheader: `We missed you`,
    heading: 'We missed you',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">We didn't see you at <strong>${escapeHtml(ctx.workshopTitle)}</strong> — life happens. We'd still love for you to experience it.</p>
      <p style="margin:0 0 14px;">Here is a replay / the next live date so you can join when it suits you.</p>`,
    cta: { label: 'Watch the replay', href: ctx.replayUrl },
  });
  return {
    subject: `We missed you — ${ctx.workshopTitle}`,
    html,
    text: `${greeting(ctx.name).replace(/<[^>]+>/g, '')}\n\nWe didn't see you at ${ctx.workshopTitle}. Here's a replay / the next date: ${ctx.replayUrl}`,
  };
}
