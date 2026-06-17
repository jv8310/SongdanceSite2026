// Templated workshop emails — table-based, ~560px, parchment / plum-ink /
// ember palette ported from the existing transactional design. Each builder
// returns { subject, html, text } ready for Resend.
//
// Copy rules: every string here obeys docs/svh-copy-book.md — the sound OF
// something (never for), acknowledgment (never "release"/"letting go"),
// sounding (never singing), facilitators hold space. No outcome promises, no
// manufactured urgency (deadlines are stated as plain facts, once), no rescue
// framing. Lifecycle emails are written in Jacob's voice and sent from
// MARKETING_FROM; transactional ones stay from the default Songdance sender.

const PALETTE = {
  bg: '#F4ECDF',
  card: '#FBF6EC',
  ink: '#2A1B2A',
  soft: '#4A3848',
  faint: '#B6A8B4',
  ember: '#A14826',
  border: 'rgba(161,72,38,0.22)',
};

const LOGO_URL = 'https://songdance.co/brand/logo-wordmark-dark.png';

// Email imagery must be absolute production URLs (inboxes can't resolve
// relative paths). These live in public/imagery/ — git-tracked, so the links
// are stable. NB: several files in that folder are named after a different
// subject than they show; every reference below was visually verified.
const IMG = {
  circleWide: 'https://songdance.co/imagery/circle-yurt-wide.jpg', // wide circle, Jacob at the far side
  soundingBlue: 'https://songdance.co/imagery/sounding-blue.jpg', // woman mid-tone, hand on chest, sunset
  soundingYellow: 'https://songdance.co/imagery/sounding-yellow.jpg', // woman, eyes closed, hand on heart
  jacobSounding: 'https://songdance.co/imagery/portrait-jacob-sounding.jpg', // Jacob sounding, golden field
  walkSunset: 'https://songdance.co/imagery/walk-tree-sunset.jpg', // figure walking toward the light
};

// Lifecycle (marketing-flavoured) emails come from a person, not a brand.
// These are the DEFAULTS; the MARKETING_FROM / MARKETING_REPLY_TO env vars
// override them (see env.d.ts) — set those to move marketing onto a dedicated
// verified subdomain so its reputation is isolated from transactional mail.
export const MARKETING_FROM_DEFAULT = 'Jacob from Songdance <info@mail.songdance.co>';
export const MARKETING_REPLY_TO_DEFAULT = 'support@songdance.co';

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

// Shared shell. `bodyHtml` is dropped into the parchment card; `heroImage`
// renders edge-to-edge above it; `cta` renders a primary button; `extras`
// renders secondary links beneath it.
function shell(opts: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  heroImage?: { src: string; alt: string };
  cta?: ButtonLink;
  extras?: ButtonLink[];
  footerNote?: string;
  unsubscribeUrl?: string;
}): string {
  const { preheader, heading, bodyHtml, heroImage, cta, extras, footerNote, unsubscribeUrl } = opts;
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
            ${heroImage ? `<tr><td style="padding:0;"><img src="${heroImage.src}" alt="${escapeHtml(heroImage.alt)}" width="558" style="display:block;width:100%;height:auto;border-radius:13px 13px 0 0;" /></td></tr>` : ''}
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
          ${unsubscribeUrl ? `<p style="margin:6px 0 0;font-family:Georgia,serif;font-size:11px;line-height:1.6;color:${PALETTE.faint};"><a href="${unsubscribeUrl}" style="color:${PALETTE.faint};text-decoration:underline;">No more emails like this — unsubscribe</a></p>` : ''}
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

// A small photo beside a paragraph — the "visual element here and there".
// Table-based so it survives every mail client; stacks poorly nowhere
// because 150px + text fits even narrow phones.
function figureRow(src: string, alt: string, bodyHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 14px;"><tr>
    <td width="150" valign="top" style="padding:0 16px 0 0;"><img src="${src}" alt="${escapeHtml(alt)}" width="150" style="display:block;width:150px;height:auto;border-radius:10px;" /></td>
    <td valign="top" style="font-family:Georgia,serif;font-size:16px;line-height:1.65;color:${PALETTE.soft};">${bodyHtml}</td>
  </tr></table>`;
}

// A centered italic line in the brand ember — for the copy-book one-liners.
function quoteLine(text: string): string {
  return `<p style="margin:20px 0;text-align:center;font-style:italic;font-size:17px;line-height:1.5;color:${PALETTE.ember};">${escapeHtml(text)}</p>`;
}

// An ember-dotted list row (email-safe bullet).
function dot(html: string): string {
  return `<p style="margin:0 0 10px;"><span style="color:${PALETTE.ember};">&#9679;&nbsp;&nbsp;</span>${html}</p>`;
}

// A small uppercase ember section label (matches the confirmation email's
// "What to expect" / "How to prepare" headers).
function sectionLabel(text: string): string {
  return `<p style="margin:20px 0 10px;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:${PALETTE.ember};">${escapeHtml(text)}</p>`;
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
export function confirmationEmail(ctx: WorkshopEmailCtx & { isReplay?: boolean }): EmailContent {
  const extras: ButtonLink[] = [];
  if (ctx.googleCalUrl) extras.push({ label: 'Add to Google Calendar', href: ctx.googleCalUrl });
  if (ctx.icsUrl) extras.push({ label: 'Apple / Outlook (.ics)', href: ctx.icsUrl });
  const expectBlock = ctx.isReplay
    ? ''
    : `<p style="margin:20px 0 10px;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:${PALETTE.ember};">What to expect</p>
      ${dot('We gather on Zoom. A few words to arrive, then the practice itself — one breath in, one tone out, together.')}
      ${dot(`Nobody is put on the spot. Cameras can stay off, you're muted unless you choose otherwise, and soft counts.`)}
      ${dot(`You don't need a good voice — you need an honest one. No experience, no skill, no warm-up.`)}
      <p style="margin:20px 0 10px;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:${PALETTE.ember};">How to prepare</p>
      <p style="margin:0 0 14px;">There's nothing to prepare. If you'd like to be comfortable: a quiet-ish corner where a little sound is allowed — a bedroom, even a parked car. Headphones if you share walls. Water nearby. That's the whole list.</p>`;
  const html = shell({
    preheader: `You're registered for ${ctx.workshopTitle}`,
    heading: "You're in",
    heroImage: { src: IMG.circleWide, alt: 'A Songdance circle, mid-gathering' },
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">Your place in <strong>${escapeHtml(ctx.workshopTitle)}</strong> is confirmed.</p>
      <p style="margin:0 0 6px;">It takes place on:</p>
      <p style="margin:0 0 4px;font-size:18px;color:${PALETTE.ink};">${escapeHtml(ctx.whenLocal)}</p>
      ${expectBlock}
      ${ctx.isReplay ? '' : quoteLine('Come as you sound.')}
      <p style="margin:14px 0 0;">When the time comes, open your page below — the Join button appears 5 minutes before we begin and takes you straight into the room.</p>`,
    cta: { label: 'Open my countdown page', href: ctx.joinUrl },
    extras,
  });
  const expectText = ctx.isReplay
    ? ''
    : `\nWhat to expect:\n- We gather on Zoom. A few words to arrive, then the practice itself — one breath in, one tone out, together.\n- Nobody is put on the spot. Cameras can stay off, you're muted unless you choose otherwise, and soft counts.\n- You don't need a good voice — you need an honest one. No experience, no skill, no warm-up.\n\nHow to prepare: nothing. If you'd like to be comfortable: a quiet-ish corner where a little sound is allowed, headphones if you share walls, water nearby. That's the whole list.\n`;
  return {
    subject: `You're registered — ${ctx.workshopTitle}`,
    html,
    text: `${greeting(ctx.name).replace(/<[^>]+>/g, '')}\n\nYour place in ${ctx.workshopTitle} is confirmed.\n\nWhen: ${ctx.whenLocal}\n${expectText}\nYour countdown / join page: ${ctx.joinUrl}\n\nThe Join button appears 5 minutes before we begin.`,
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

// The early reminders each carry their own beat, so the seven-touch cadence
// reads like a build rather than the same note struck repeatedly:
//   7d → a spacious heads-up + reassurance for the hesitant
//   2d → the practical prep list
//   1d → the shape of the hour + the seed practice to try first
// The imminent ones (6h onward) stay lean — just the door.
function reminderWarmth(type: string): { html: string; text: string } {
  if (type === 'reminder_7d') {
    return {
      html: `<p style="margin:14px 0 0;">A week from now, we sound together. There's nothing to do between now and then — let it sit in the calendar.</p>
      <p style="margin:14px 0 0;">If the idea of using your voice where others can hear it sits oddly, that's normal, and expected. Nobody is put on the spot, cameras can stay off, and soft counts — soft often counts double.</p>
      ${quoteLine("You don't need a good voice. You need an honest one.")}`,
      text: `\nA week from now, we sound together. There's nothing to do between now and then — let it sit in the calendar.\n\nIf the idea of using your voice where others can hear it sits oddly, that's normal, and expected. Nobody is put on the spot, cameras can stay off, and soft counts — soft often counts double.\n`,
    };
  }
  if (type === 'reminder_2d') {
    return {
      html: `<p style="margin:14px 0 0;">Two days out — a few practical notes, so the hour is easy when it comes:</p>
      ${dot('A quiet-ish corner where a little sound is allowed — a bedroom, even a parked car.')}
      ${dot('Headphones if you share walls; water within reach.')}
      ${dot("Cameras can stay off, and you're muted unless you choose otherwise.")}
      <p style="margin:10px 0 0;">That's the whole list. Nothing to prepare, nothing to read first.</p>`,
      text: `\nTwo days out — a few practical notes, so the hour is easy when it comes:\n- A quiet-ish corner where a little sound is allowed — a bedroom, even a parked car.\n- Headphones if you share walls; water within reach.\n- Cameras can stay off, and you're muted unless you choose otherwise.\n\nThat's the whole list. Nothing to prepare, nothing to read first.\n`,
    };
  }
  if (type === 'reminder_1d') {
    return {
      html: `<p style="margin:14px 0 0;">Tomorrow. Here's the shape of it: a few words to arrive, then the practice itself — one breath in, one tone out, together. No experience, no warm-up, no skill required.</p>
      <p style="margin:14px 0 0;">If you're curious before we begin, try it once: the sound of how this moment actually is. That's the seed of everything we'll do.</p>
      ${quoteLine('You cannot do it wrong. It always expresses something.')}`,
      text: `\nTomorrow. Here's the shape of it: a few words to arrive, then the practice itself — one breath in, one tone out, together. No experience, no warm-up, no skill required.\n\nIf you're curious before we begin, try it once: the sound of how this moment actually is. That's the seed of everything we'll do.\n`,
    };
  }
  return { html: '', text: '' };
}

export function reminderEmail(type: string, ctx: WorkshopEmailCtx): EmailContent {
  const lead = REMINDER_LEAD[type] ?? 'soon';
  const isImminent = type === 'reminder_15m' || type === 'at_time' || type === 'reminder_1h';
  const warm = reminderWarmth(type);
  const html = shell({
    preheader: `${ctx.workshopTitle} starts ${lead}`,
    heading: type === 'at_time' ? "We're starting" : `Starting ${lead}`,
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;"><strong>${escapeHtml(ctx.workshopTitle)}</strong> starts ${lead}.</p>
      <p style="margin:0 0 4px;font-size:18px;color:${PALETTE.ink};">${escapeHtml(ctx.whenLocal)}</p>
      ${warm.html}
      <p style="margin:14px 0 0;">${isImminent ? 'Open your page now — the Join button is ready.' : 'Open your countdown page below; the Join button appears 5 minutes before we begin.'}</p>`,
    cta: { label: isImminent ? 'Join now' : 'Open my countdown page', href: ctx.joinUrl },
  });
  return {
    subject: type === 'at_time'
      ? `We're starting — ${ctx.workshopTitle}`
      : `Reminder: ${ctx.workshopTitle} starts ${lead}`,
    html,
    text: `${greeting(ctx.name).replace(/<[^>]+>/g, '')}\n\n${ctx.workshopTitle} starts ${lead}.\nWhen: ${ctx.whenLocal}\n${warm.text}\nYour join page: ${ctx.joinUrl}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Lifecycle sequences (marketing-flavoured — sent from MARKETING_FROM, carry
// an unsubscribe link, and are gated by the email_suppressions table).
// Cadence lives in cron.ts; this file is only the words.
// ═══════════════════════════════════════════════════════════════════════════

function textGreeting(name?: string | null): string {
  return greeting(name).replace(/<[^>]+>/g, '');
}

function unsubText(unsubscribeUrl?: string): string {
  return unsubscribeUrl ? `\n\nNo more emails like this — unsubscribe: ${unsubscribeUrl}` : '';
}

export type LifecycleCtx = {
  name?: string | null;
  workshopTitle: string;
  unsubscribeUrl?: string;
};

// ── Abandoned checkout 1 (~1h after they stopped) ──────────────────────────
export function abandonedEmail1(
  ctx: LifecycleCtx & { whenLocal: string | null; resumeUrl: string },
): EmailContent {
  const html = shell({
    preheader: 'You started registering — it takes a minute to finish.',
    heading: 'Your place is still open',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">You started registering for <strong>${escapeHtml(ctx.workshopTitle)}</strong> and stopped somewhere along the way. That happens — pages close, life interrupts.</p>
      ${ctx.whenLocal ? `<p style="margin:0 0 6px;">It takes place on:</p>
      <p style="margin:0 0 14px;font-size:18px;color:${PALETTE.ink};">${escapeHtml(ctx.whenLocal)}</p>` : ''}
      <p style="margin:0 0 14px;">Your details are saved. If you'd like to finish, this takes you straight back:</p>
      <p style="margin:0;font-size:14px;color:${PALETTE.soft};">If something didn't work — a card refused, a page that wouldn't load — just reply to this email. A person reads it.</p>`,
    cta: { label: 'Complete my registration', href: ctx.resumeUrl },
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
  return {
    subject: 'Your place is still open',
    html,
    text: `${textGreeting(ctx.name)}\n\nYou started registering for ${ctx.workshopTitle} and stopped somewhere along the way. That happens.\n${ctx.whenLocal ? `\nIt takes place on: ${ctx.whenLocal}\n` : ''}\nYour details are saved — finish here: ${ctx.resumeUrl}\n\nIf something didn't work on the page, just reply to this email. A person reads it.\n\nWarmly,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── Abandoned checkout 2 (~20h after; only while the date is still ahead) ──
export function abandonedEmail2(
  ctx: LifecycleCtx & { whenLocal: string | null; resumeUrl: string },
): EmailContent {
  const html = shell({
    preheader: 'Honest small print, in case it helps.',
    heading: 'Still thinking it over?',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">Yesterday you almost joined <strong>${escapeHtml(ctx.workshopTitle)}</strong>. Maybe life got in the way — or maybe you weren't sure it's for you.</p>
      ${figureRow(
        IMG.soundingYellow,
        'A participant sounding — eyes closed, hand on heart',
        `<p style="margin:0;">In case it's the second one, the honest small print: this is not a singing course. You don't need a good voice — you need an honest one. One tone, the tone of what's actually there. Nobody is put on the spot, cameras can stay off, and soft counts.</p>`,
      )}
      ${ctx.whenLocal ? `<p style="margin:0 0 6px;">We begin on:</p>
      <p style="margin:0 0 14px;font-size:18px;color:${PALETTE.ink};">${escapeHtml(ctx.whenLocal)}</p>` : ''}
      <p style="margin:0;">And if now simply isn't the time — that's an honest answer too. The door doesn't disappear.</p>`,
    cta: { label: 'Finish my registration', href: ctx.resumeUrl },
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
  return {
    subject: 'Still thinking it over?',
    html,
    text: `${textGreeting(ctx.name)}\n\nYesterday you almost joined ${ctx.workshopTitle}. Maybe life got in the way — or maybe you weren't sure it's for you.\n\nIn case it's the second one, the honest small print: this is not a singing course. You don't need a good voice — you need an honest one. One tone, the tone of what's actually there. Nobody is put on the spot, cameras can stay off, and soft counts.\n${ctx.whenLocal ? `\nWe begin on: ${ctx.whenLocal}\n` : ''}\nFinish your registration: ${ctx.resumeUrl}\n\nAnd if now simply isn't the time — that's an honest answer too. The door doesn't disappear.\n\n— Jacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── Attended 1 (right after the session): thank-you + the 48h window ───────
export function attendedEmail1(
  ctx: LifecycleCtx & {
    courseUrl: string;
    discountEndsLocal: string;
    alreadyBoughtCourse?: boolean;
  },
): EmailContent {
  const opener = `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">Thank you for being part of <strong>${escapeHtml(ctx.workshopTitle)}</strong>. Whatever sound you made today — it was the right one. You cannot do it wrong; it always expresses something.</p>
      <p style="margin:0 0 14px;">In the day or two after a session the body sometimes keeps commenting — a yawn out of nowhere, tiredness, a feeling passing through. Nothing is wrong. Give it room, and when in doubt: one breath in, one tone out.</p>`;
  if (ctx.alreadyBoughtCourse) {
    const html = shell({
      preheader: 'A note for the days after.',
      heading: 'Thank you for sounding with us',
      bodyHtml: `${opener}
      <p style="margin:0;">And since your next step here is already booked, we'll be seeing more of each other. Until then: three breaths and a tone.</p>`,
      unsubscribeUrl: ctx.unsubscribeUrl,
    });
    return {
      subject: 'Thank you for sounding with us',
      html,
      text: `${textGreeting(ctx.name)}\n\nThank you for being part of ${ctx.workshopTitle}. Whatever sound you made today — it was the right one. You cannot do it wrong; it always expresses something.\n\nIn the day or two after a session the body sometimes keeps commenting — a yawn out of nowhere, tiredness, a feeling passing through. Nothing is wrong. Give it room.\n\nAnd since your next step here is already booked, we'll be seeing more of each other. Until then: three breaths and a tone.\n\nWarmly,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
    };
  }
  const html = shell({
    preheader: 'A note for the days after — and 48 hours of 20% off the 12-week course.',
    heading: 'Thank you for sounding with us',
    bodyHtml: `${opener}
      ${figureRow(
        IMG.soundingBlue,
        'A participant mid-tone, hand on chest',
        `<p style="margin:0;">If you'd like to take this further, the 12-week course is where the practice becomes your own — twelve weeks, one layer at a time, in your own time, with live Q&amp;A whenever you want company.</p>`,
      )}
      ${sectionLabel('What the twelve weeks hold')}
      ${dot('<strong>18+ hours of guided practice</strong> across twelve modules — chaptered, self-paced, yours to return to for life.')}
      ${dot('<strong>Weekly live Q&amp;A with Jacob</strong>, on a rotating schedule for every timezone, with replays.')}
      ${dot('A path that moves one layer at a time — reading your own voice, working <em>with</em> the nervous system, the five core wounds, sounding toward essence, and carrying the practice on alone.')}
      ${dot('A supportive student community — and, on joining, five of Jacob&rsquo;s original mantras.')}
      <p style="margin:16px 0 0;">As a participant you have <strong>20% off — for 48 hours only</strong>, until ${escapeHtml(ctx.discountEndsLocal)}. The button below already knows it's you: your discounted price is on the page, nothing to type.</p>`,
    cta: { label: 'See my price — 20% off', href: ctx.courseUrl },
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
  return {
    subject: 'Thank you for sounding with us',
    html,
    text: `${textGreeting(ctx.name)}\n\nThank you for being part of ${ctx.workshopTitle}. Whatever sound you made today — it was the right one. You cannot do it wrong; it always expresses something.\n\nIn the day or two after a session the body sometimes keeps commenting — a yawn out of nowhere, tiredness, a feeling passing through. Nothing is wrong. Give it room, and when in doubt: one breath in, one tone out.\n\nIf you'd like to take this further, the 12-week course is where the practice becomes your own — twelve weeks, one layer at a time, in your own time, with live Q&A whenever you want company.\n\nWhat the twelve weeks hold:\n- 18+ hours of guided practice across twelve modules — chaptered, self-paced, yours to return to for life.\n- Weekly live Q&A with Jacob, on a rotating schedule for every timezone, with replays.\n- A path that moves one layer at a time — reading your own voice, working with the nervous system, the five core wounds, sounding toward essence, and carrying the practice on alone.\n- A supportive student community — and, on joining, five of Jacob's original mantras.\n\nAs a participant you have 20% off — for 48 hours only, until ${ctx.discountEndsLocal}. The link below already knows it's you: your discounted price is on the page, nothing to type.\n\n${ctx.courseUrl}\n\nWarmly,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── Attended 2 (+24h): the case for the course, factually ──────────────────
export function attendedEmail2(
  ctx: LifecycleCtx & { courseUrl: string; discountEndsLocal: string },
): EmailContent {
  const html = shell({
    preheader: `Your 20% ends tomorrow — ${ctx.discountEndsLocal}.`,
    heading: 'What is below that?',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">In the workshop you made the sound of the moment — one breath in, one tone out. That's the front door of this practice.</p>
      <p style="margin:0 0 14px;">Behind it sits a method. After the first tone you ask: <em>what is below that?</em> — and you make the sound of that. You only ever need to go one level deeper. Learning to do that kindly, at your own tempo, is what the twelve weeks are for.</p>
      ${sectionLabel('Where the twelve weeks take you')}
      <p style="margin:0 0 14px;">It moves gently, one module at a time — from what sounding actually is (and how it differs from singing, toning, chanting), through hearing the feeling and the pattern inside your own voice and using sound to settle the nervous system, into the five core wounds met safely, sounding toward your own essence, and finally carrying the practice forward on your own.</p>
      <p style="margin:0 0 14px;">The shape is built to fit a life: <strong>18+ hours of video you take at your own pace</strong>, a <strong>weekly live hour with Jacob</strong> for questions (rotating timezones, with replays), a student community to practise with, and <strong>lifetime access</strong> to all of it.</p>
      <p style="margin:0 0 14px;">It's not an eternal excavation — it's a tool you keep. Don't expect miracles; expect a real relationship with your own voice.</p>
      ${quoteLine('Below every wound, another door.')}
      <p style="margin:0;">A practical note: your 20% ends <strong>tomorrow — ${escapeHtml(ctx.discountEndsLocal)}</strong>. The button below opens the page with your price already showing. After that, full price.</p>`,
    cta: { label: 'See my price — 20% off', href: ctx.courseUrl },
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
  return {
    subject: 'What is below that?',
    html,
    text: `${textGreeting(ctx.name)}\n\nIn the workshop you made the sound of the moment — one breath in, one tone out. That's the front door of this practice.\n\nBehind it sits a method. After the first tone you ask: what is below that? — and you make the sound of that. You only ever need to go one level deeper. Learning to do that kindly, at your own tempo, is what the twelve weeks are for.\n\nWhere the twelve weeks take you: it moves gently, one module at a time — from what sounding actually is (and how it differs from singing, toning, chanting), through hearing the feeling and the pattern inside your own voice and using sound to settle the nervous system, into the five core wounds met safely, sounding toward your own essence, and finally carrying the practice forward on your own.\n\nThe shape is built to fit a life: 18+ hours of video you take at your own pace, a weekly live hour with Jacob for questions (rotating timezones, with replays), a student community to practise with, and lifetime access to all of it.\n\nIt's not an eternal excavation — it's a tool you keep. Don't expect miracles; expect a real relationship with your own voice.\n\nA practical note: your 20% ends tomorrow — ${ctx.discountEndsLocal}. The link below opens the page with your price already showing. After that, full price.\n\n${ctx.courseUrl}\n\n— Jacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── Attended 3 (+42h): last chance — the one email that's allowed to push ──
export function attendedEmail3(
  ctx: LifecycleCtx & { courseUrl: string; discountEndsLocal: string },
): EmailContent {
  const html = shell({
    preheader: `It ends ${ctx.discountEndsLocal}. After that, full price.`,
    heading: 'Last chance on your 20%',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">This is the last call I'll send about it: your participant discount on the 12-week course ends <strong>${escapeHtml(ctx.discountEndsLocal)}</strong> — a few hours from now. After that, full price.</p>
      <p style="margin:0 0 14px;">What you'd be stepping into: eighteen-plus hours of guided practice across twelve modules, a weekly live hour with Jacob, a student community, and lifetime access.</p>
      <p style="margin:0 0 14px;">The facts, once more: 20% off, already applied for you — the button below opens the page with your price showing. If spreading it out helps, there's a three-part monthly plan; the discount counts there too.</p>
      <p style="margin:0 0 14px;">If the answer is "not now", that's an honest answer and nothing is lost. But if you've been meaning to — this is the moment it costs the least.</p>
      <p style="margin:0;">Unsure whether it's for you? Reply with your question before the window shuts; a person answers plainly. If it's not for you, we'll say so.</p>`,
    cta: { label: 'Take the 20% before it ends', href: ctx.courseUrl },
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
  return {
    subject: 'Last chance — your 20% ends in a few hours',
    html,
    text: `${textGreeting(ctx.name)}\n\nThis is the last call I'll send about it: your participant discount on the 12-week course ends ${ctx.discountEndsLocal} — a few hours from now. After that, full price.\n\nWhat you'd be stepping into: eighteen-plus hours of guided practice across twelve modules, a weekly live hour with Jacob, a student community, and lifetime access.\n\nThe facts, once more: 20% off, already applied for you — the link below opens the page with your price showing. If spreading it out helps, there's a three-part monthly plan; the discount counts there too.\n\nIf the answer is "not now", that's an honest answer and nothing is lost. But if you've been meaning to — this is the moment it costs the least.\n\nUnsure whether it's for you? Reply with your question before the window shuts; a person answers plainly. If it's not for you, we'll say so.\n\n${ctx.courseUrl}\n\n— Jacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── Attended, PRO branch (masterclass / is_pro): the certification path ────
export function attendedProEmail1(
  ctx: LifecycleCtx & { certUrl: string; courseUrl: string },
): EmailContent {
  const html = shell({
    preheader: 'For the ones who hold space for others.',
    heading: 'Thank you for sounding with us',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">Thank you for being part of <strong>${escapeHtml(ctx.workshopTitle)}</strong>.</p>
      ${figureRow(
        IMG.jacobSounding,
        'Jacob sounding — hand on chest, eyes closed',
        `<p style="margin:0;">Because you work with people yourself, there's a path here that may matter more to you than the rest: the <strong>SVH Certification</strong> — learning to hold this space for others.</p>`,
      )}
      <p style="margin:0 0 14px;">Not healer, not fixer: space holder. Someone who keeps the room steady while another person does the one thing only they can do.</p>
      ${sectionLabel('What the path involves')}
      ${dot('Live classes, each with a written manual — and instant access to the ones already held, the moment you join.')}
      ${dot('Weekly live Q&amp;A and monthly deepening sessions, so the learning stays live, not just recorded.')}
      ${dot('Hosted practice sessions with peers — giving and receiving is the quiet heart of it, and where facilitation actually grows.')}
      ${dot('The Somatic Vocal Healing app, a full replay library, a global community, and lifetime access.')}
      <p style="margin:16px 0 0;">If that sounds like your work, have a look:</p>`,
    cta: { label: 'Explore the certification path', href: ctx.certUrl },
    extras: [{ label: 'Your 12-week price (20% off, 48 hours)', href: ctx.courseUrl }],
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
  return {
    subject: 'Thank you — and a word for practitioners',
    html,
    text: `${textGreeting(ctx.name)}\n\nThank you for being part of ${ctx.workshopTitle}.\n\nBecause you work with people yourself, there's a path here that may matter more to you than the rest: the SVH Certification — learning to hold this space for others.\n\nNot healer, not fixer: space holder. Someone who keeps the room steady while another person does the one thing only they can do.\n\nWhat the path involves:\n- Live classes, each with a written manual — and instant access to the ones already held, the moment you join.\n- Weekly live Q&A and monthly deepening sessions, so the learning stays live, not just recorded.\n- Hosted practice sessions with peers — giving and receiving is the quiet heart of it, and where facilitation actually grows.\n- The Somatic Vocal Healing app, a full replay library, a global community, and lifetime access.\n\n${ctx.certUrl}\n\nPS — your 20% on the 12-week course is also live for the next 48 hours; this link shows your price directly: ${ctx.courseUrl}\n\nWarmly,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

export function attendedProEmail2(ctx: LifecycleCtx & { certUrl: string }): EmailContent {
  const html = shell({
    preheader: 'What a facilitator actually does here.',
    heading: 'Holding space is a craft',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">The facilitator's work in this practice is quiet: keep the room steady, ask the next honest question, hear what the other person can't hear yet — and then get out of the way.</p>
      <p style="margin:0 0 14px;">When someone discovers a connection, you leave that gift to them. You're never the smart one who points it out. The healing is theirs; the space is yours.</p>
      ${sectionLabel('What you learn to do')}
      ${dot('Travel through the layers of a sound, and guide a whole session from the first tone to integration.')}
      ${dot('Meet the core emotions in the voice — anger, fear, pain, grief — and stay with what is truly being expressed.')}
      ${dot('Weave in systemic work: mother, father, the line behind a person; giving back what was never theirs to carry.')}
      ${dot('The therapeutic craft — pacing, regulation, co-regulation, the volume button; knowing when to hold, when to wait, when to let silence do the work.')}
      ${dot("Your own inner work — projection, transference, what stirs in you when another person's material touches your own.")}
      <p style="margin:16px 0 14px;">And a great deal of practice: hosted sessions with peers, and a final supervised class where you lead in front of the group and get direct feedback. The method, the listening, the safety architecture — so you can bring sounding into the work you already do.</p>
      <p style="margin:0;">If you have questions about whether it fits your practice, reply to this email and ask. A person answers.</p>`,
    cta: { label: 'Explore the certification path', href: ctx.certUrl },
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
  return {
    subject: 'Holding space is a craft',
    html,
    text: `${textGreeting(ctx.name)}\n\nThe facilitator's work in this practice is quiet: keep the room steady, ask the next honest question, hear what the other person can't hear yet — and then get out of the way.\n\nWhen someone discovers a connection, you leave that gift to them. You're never the smart one who points it out. The healing is theirs; the space is yours.\n\nWhat you learn to do:\n- Travel through the layers of a sound, and guide a whole session from the first tone to integration.\n- Meet the core emotions in the voice — anger, fear, pain, grief — and stay with what is truly being expressed.\n- Weave in systemic work: mother, father, the line behind a person; giving back what was never theirs to carry.\n- The therapeutic craft — pacing, regulation, co-regulation, the volume button; knowing when to hold, when to wait, when to let silence do the work.\n- Your own inner work — projection, transference, what stirs in you when another person's material touches your own.\n\nAnd a great deal of practice: hosted sessions with peers, and a final supervised class where you lead in front of the group and get direct feedback. The method, the listening, the safety architecture — so you can bring sounding into the work you already do.\n\nIf you have questions about whether it fits your practice, reply to this email and ask. A person answers.\n\n${ctx.certUrl}\n\n— Jacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

export function attendedProEmail3(ctx: LifecycleCtx & { certUrl: string }): EmailContent {
  const html = shell({
    preheader: 'No deadline here — just the door.',
    heading: 'If the path is calling',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">A last note on this — then we'll leave it with you.</p>
      <p style="margin:0 0 14px;">If you've been circling the certification course, the page below has the structure, the classes, and the honest small print. There's no deadline attached and no spots-left theatre. Trees don't hurry, and neither does this.</p>
      <p style="margin:0 0 14px;">Two honest things before we go: it isn't a full therapist training — if you'll work with clients, you bring your own ground for holding emotional process. And there's no obligation to practise professionally at all; many walk it simply to go fully in with their own voice. You can come out a certified practitioner, or just changed. Both are welcome.</p>
      <p style="margin:0;">If it helps to talk it through first, reply here and say where you're standing. We'll answer plainly — including "not yet", if that's the truth.</p>`,
    cta: { label: 'See the certification course', href: ctx.certUrl },
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
  return {
    subject: 'If the certification path is calling',
    html,
    text: `${textGreeting(ctx.name)}\n\nA last note on this — then we'll leave it with you.\n\nIf you've been circling the certification course, the page below has the structure, the classes, and the honest small print. There's no deadline attached and no spots-left theatre. Trees don't hurry, and neither does this.\n\nTwo honest things before we go: it isn't a full therapist training — if you'll work with clients, you bring your own ground for holding emotional process. And there's no obligation to practise professionally at all; many walk it simply to go fully in with their own voice. You can come out a certified practitioner, or just changed. Both are welcome.\n\nIf it helps to talk it through first, reply here and say where you're standing. We'll answer plainly — including "not yet", if that's the truth.\n\n${ctx.certUrl}\n\nWarmly,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── No-show 1 (right after): seat is safe ──────────────────────────────────
export function noShowEmail1(ctx: LifecycleCtx & { hubUrl: string }): EmailContent {
  const html = shell({
    preheader: 'Watch the replay or move to another date, free.',
    heading: 'We missed you',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">We didn't see you at <strong>${escapeHtml(ctx.workshopTitle)}</strong> today. Life happens — no explanation needed.</p>
      <p style="margin:0;">Your registration is still good, and you have two doors: watch the replay, or move to another live date, free of charge. Both live on your personal page:</p>`,
    cta: { label: 'Open my page', href: ctx.hubUrl },
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
  return {
    subject: 'We missed you — your seat is safe',
    html,
    text: `${textGreeting(ctx.name)}\n\nWe didn't see you at ${ctx.workshopTitle} today. Life happens — no explanation needed.\n\nYour registration is still good, and you have two doors: watch the replay, or move to another live date, free of charge. Both live on your personal page:\n\n${ctx.hubUrl}\n\n— Jacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── No-show 2 (+2d): rebook, with permission for the hesitant ──────────────
export function noShowEmail2(ctx: LifecycleCtx & { hubUrl: string }): EmailContent {
  const html = shell({
    preheader: "Pick a new date — it's already paid for.",
    heading: 'Your seat is still yours',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">A couple of days ago you missed <strong>${escapeHtml(ctx.workshopTitle)}</strong>. Your place didn't expire — you can put it on any upcoming date, free. It's already paid for.</p>
      <p style="margin:0 0 14px;">And if what stopped you was the idea of sounding where strangers can hear you — that's more common than you'd think. Nobody is put on the spot. Cameras can stay off. Soft counts; soft often counts double.</p>
      <p style="margin:0;">The replay is there too, but the live hour is the thing — witnessed is different from watched.</p>`,
    cta: { label: 'Choose a new date', href: ctx.hubUrl },
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
  return {
    subject: 'Your seat is still yours',
    html,
    text: `${textGreeting(ctx.name)}\n\nA couple of days ago you missed ${ctx.workshopTitle}. Your place didn't expire — you can put it on any upcoming date, free. It's already paid for.\n\nAnd if what stopped you was the idea of sounding where strangers can hear you — that's more common than you'd think. Nobody is put on the spot. Cameras can stay off. Soft counts; soft often counts double.\n\nThe replay is there too, but the live hour is the thing — witnessed is different from watched.\n\n${ctx.hubUrl}\n\n— Jacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── No-show 3 (+6d): last note, then quiet ─────────────────────────────────
export function noShowEmail3(ctx: LifecycleCtx & { hubUrl: string }): EmailContent {
  const html = shell({
    preheader: "One last note about your missed session — then we'll go quiet.",
    heading: 'The door stays open',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">This is the last note about the session you missed — we won't keep nudging.</p>
      ${figureRow(
        IMG.walkSunset,
        'A figure walking toward the evening light',
        `<p style="margin:0;">Your page keeps working: the replay, and the free move onto any upcoming date, whenever the season suits.</p>`,
      )}
      <p style="margin:0;">Until then, a practice that needs no Zoom link: one breath in, one tone out — the sound of how it actually is. Thirty honest seconds. Half this practice happens in parked cars.</p>`,
    cta: { label: 'Open my page', href: ctx.hubUrl },
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
  return {
    subject: 'The door stays open',
    html,
    text: `${textGreeting(ctx.name)}\n\nThis is the last note about the session you missed — we won't keep nudging.\n\nYour page keeps working: the replay, and the free move onto any upcoming date, whenever the season suits.\n\nUntil then, a practice that needs no Zoom link: one breath in, one tone out — the sound of how it actually is. Thirty honest seconds. Half this practice happens in parked cars.\n\n${ctx.hubUrl}\n\nWarmly,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── Downsell 1 (+4d, attended, window closed, didn't buy) ──────────────────
export function downsellEmail1(ctx: LifecycleCtx & { courseUrl: string }): EmailContent {
  const html = shell({
    preheader: 'Two honest notes about the 12-week course.',
    heading: "If the timing wasn't right",
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">The participant discount on the 12-week course has closed — it was a real window, so it stayed closed. But I didn't want the conversation to end on a price.</p>
      <p style="margin:0 0 14px;">Two honest notes, in case they're useful:</p>
      <p style="margin:0 0 14px;"><strong>If it was the amount</strong> — there's a three-part monthly plan: the course in three payments instead of one. Spreading it out is allowed.</p>
      <p style="margin:0;"><strong>If it was doubt</strong> — reply to this email and say where you're standing. I read these. If the course isn't for you, I'll say so; we'd rather under-promise.</p>`,
    cta: { label: 'See the 12-week course', href: ctx.courseUrl },
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
  return {
    subject: "If the timing wasn't right",
    html,
    text: `${textGreeting(ctx.name)}\n\nThe participant discount on the 12-week course has closed — it was a real window, so it stayed closed. But I didn't want the conversation to end on a price.\n\nTwo honest notes, in case they're useful:\n\n1. If it was the amount — there's a three-part monthly plan: the course in three payments instead of one. Spreading it out is allowed.\n\n2. If it was doubt — reply to this email and say where you're standing. I read these. If the course isn't for you, I'll say so; we'd rather under-promise.\n\n${ctx.courseUrl}\n\n— Jacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── Downsell 2 (+8d): the free practice + live calendar; series ends ───────
export function downsellEmail2(
  ctx: LifecycleCtx & { courseUrl: string; calendarUrl: string },
): EmailContent {
  const html = shell({
    preheader: 'The practice that needs no purchase — and where to find us live.',
    heading: 'Three breaths and a tone',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">This is the last email in this little series — then quiet. Before that, the most important thing I can leave you with:</p>
      ${figureRow(
        IMG.soundingYellow,
        'A participant sounding — eyes closed, hand on heart',
        `<p style="margin:0;">The practice needs no purchase. In the morning, ask: <em>how am I feeling, in this moment?</em> — and make the sound of that. Thirty seconds. The kitchen is a fine temple.</p>`,
      )}
      <p style="margin:0;">If you'd like company doing it, come sound with us live again — the calendar of upcoming workshops and masterclasses is below. And the 12-week course keeps its door open if a later season is the right one.</p>`,
    cta: { label: 'See upcoming live dates', href: ctx.calendarUrl },
    extras: [{ label: 'The 12-week course', href: ctx.courseUrl }],
    footerNote: 'The sound was always yours. · Songdance · songdance.co',
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
  return {
    subject: 'Three breaths and a tone',
    html,
    text: `${textGreeting(ctx.name)}\n\nThis is the last email in this little series — then quiet. Before that, the most important thing I can leave you with:\n\nThe practice needs no purchase. In the morning, ask: how am I feeling, in this moment? — and make the sound of that. Thirty seconds. The kitchen is a fine temple.\n\nIf you'd like company doing it, come sound with us live again — the calendar of upcoming workshops and masterclasses: ${ctx.calendarUrl}\n\nAnd the 12-week course keeps its door open if a later season is the right one: ${ctx.courseUrl}\n\nThe sound was always yours.\n\n— Jacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}
