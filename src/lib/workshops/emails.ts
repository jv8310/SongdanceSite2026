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
//
// The redesigned post-workshop "attended", "attended-PRO" and "downsell" emails
// render through the richer broadcast-quality toolkit in ./email-design
// (imported as `D`); the transactional/other lifecycle emails (confirmation,
// reminders, abandoned, no-show) keep the simpler `shell()` below.

import * as D from './email-design';
import { type DownsellOffer, BUNDLE_PATH } from './downsell-offers';
import { guarantee } from '../guarantee';
import { CERT_PATH_DISCOUNT_PERCENT } from '../courses/path';

// Plain-text line for the 30-day money-back guarantee (the text/plain part of
// the course-promoting lifecycle emails). The HTML part uses D.guaranteeNote().
const GUARANTEE_TEXT = `And there's a ${guarantee.days}-day money-back guarantee: give the course a real try, and if it isn't for you, write to ${guarantee.email} within ${guarantee.days} days for a full refund.`;

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

// Physical postal address for marketing footers (CAN-SPAM / GDPR compliance).
export const MAILING_ADDRESS = 'Beaupréstraat 13, 8310 Bruges, Belgium';

export type EmailContent = { subject: string; html: string; text: string };

type ButtonLink = { label: string; href: string };

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Shared shell. `bodyHtml` is dropped into the parchment card; `heroImage`
// renders edge-to-edge above it; `cta` renders a primary button; `extras`
// renders secondary links beneath it. Exported so one-off broadcasts
// (src/lib/broadcasts/email.ts) render in the exact same parchment frame.
export function shell(opts: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  // The hero renders as a fixed-height landscape band (object-fit cover) so a
  // tall portrait photo can't balloon the header; `objectPosition` aims the crop.
  heroImage?: { src: string; alt: string; objectPosition?: string };
  cta?: ButtonLink;
  extras?: ButtonLink[];
  footerNote?: string;
  unsubscribeUrl?: string;
  address?: string;
}): string {
  const { preheader, heading, bodyHtml, heroImage, cta, extras, footerNote, unsubscribeUrl, address } = opts;
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
            ${heroImage ? `<tr><td style="padding:0;"><img src="${heroImage.src}" alt="${escapeHtml(heroImage.alt)}" width="558" style="display:block;width:100%;height:260px;object-fit:cover;object-position:${heroImage.objectPosition ?? 'center'};border-radius:13px 13px 0 0;" /></td></tr>` : ''}
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
          ${address ? `<p style="margin:4px 0 0;font-family:Georgia,serif;font-size:11px;line-height:1.6;color:${PALETTE.faint};">${escapeHtml(address)}</p>` : ''}
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

// ── Date-change confirmation ──────────────────────────────────────────────
// Sent when a registrant moves their seat to a different live date from the
// countdown page. Focused on the one thing that changed — the date — and hands
// them fresh calendar links, since the old entry is now stale. Transactional
// (a service message about their own booking; always delivered).
export function dateChangedEmail(ctx: WorkshopEmailCtx): EmailContent {
  const extras: ButtonLink[] = [];
  if (ctx.googleCalUrl) extras.push({ label: 'Add to Google Calendar', href: ctx.googleCalUrl });
  if (ctx.icsUrl) extras.push({ label: 'Apple / Outlook (.ics)', href: ctx.icsUrl });
  const html = shell({
    preheader: `Your new date for ${ctx.workshopTitle} is confirmed`,
    heading: 'Your new date',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">Done — your place in <strong>${escapeHtml(ctx.workshopTitle)}</strong> has moved. Same seat, new day:</p>
      <p style="margin:0 0 4px;font-size:18px;color:${PALETTE.ink};">${escapeHtml(ctx.whenLocal)}</p>
      <p style="margin:16px 0 0;">Your earlier calendar entry is out of date now — the links below add the new time. Nothing else changes, and there's nothing to prepare.</p>
      ${quoteLine('Come as you sound.')}
      <p style="margin:14px 0 0;">When the time comes, open your page below — the Join button appears 5 minutes before we begin.</p>`,
    cta: { label: 'Open my countdown page', href: ctx.joinUrl },
    extras,
  });
  return {
    subject: `Your new date is confirmed — ${ctx.workshopTitle}`,
    html,
    text: `${greeting(ctx.name).replace(/<[^>]+>/g, '')}\n\nDone — your place in ${ctx.workshopTitle} has moved. Same seat, new day:\n\nWhen: ${ctx.whenLocal}\n\nYour earlier calendar entry is out of date now — re-add it from your countdown page. Nothing else changes, and there's nothing to prepare.\n\nYour countdown / join page: ${ctx.joinUrl}\n\nThe Join button appears 5 minutes before we begin.`,
  };
}

// ── Reminders ──────────────────────────────────────────────────────────────
const REMINDER_LEAD: Record<string, string> = {
  reminder_7d: 'in one week',
  reminder_2d: 'in two days',
  reminder_1d: 'tomorrow',
  reminder_6h: 'in a few hours',
  reminder_1h: 'in one hour',
  reminder_20m: 'in 20 minutes',
  reminder_5m: 'in a few minutes',
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
  // `reminder_5m` is the terminal "we're live now" touch — it goes ~5 min before
  // start (when the Join window opens) and also catches up if its tick is missed,
  // so its copy must read true right up to and just after the start.
  const isLive = type === 'reminder_5m';
  // Imminent = the Join button is open (within the 5-min join window). The live
  // touch qualifies; reminder_1h keeps its long-standing lean "just the door" copy.
  const isImminent = isLive || type === 'reminder_1h';
  const warm = reminderWarmth(type);
  const html = shell({
    preheader: isLive
      ? `${ctx.workshopTitle} — the room is open now`
      : `${ctx.workshopTitle} starts ${lead}`,
    heading: isLive ? "We're live now" : `Starting ${lead}`,
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">${
        isLive
          ? `<strong>${escapeHtml(ctx.workshopTitle)}</strong> is starting — the room is open now, come on in.`
          : `<strong>${escapeHtml(ctx.workshopTitle)}</strong> starts ${lead}.`
      }</p>
      <p style="margin:0 0 4px;font-size:18px;color:${PALETTE.ink};">${escapeHtml(ctx.whenLocal)}</p>
      ${warm.html}
      <p style="margin:14px 0 0;">${isImminent ? 'Open your page now — the Join button is ready.' : 'Open your countdown page below; the Join button appears 5 minutes before we begin.'}</p>`,
    cta: { label: isImminent ? 'Join now' : 'Open my countdown page', href: ctx.joinUrl },
  });
  return {
    subject: isLive
      ? `We're live now — ${ctx.workshopTitle}`
      : `Reminder: ${ctx.workshopTitle} starts ${lead}`,
    html,
    text: `${greeting(ctx.name).replace(/<[^>]+>/g, '')}\n\n${
      isLive
        ? `${ctx.workshopTitle} is starting — the room is open now, come on in.`
        : `${ctx.workshopTitle} starts ${lead}.`
    }\nWhen: ${ctx.whenLocal}\n${warm.text}\nYour join page: ${ctx.joinUrl}`,
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

// Hours left on the discount window, phrased plainly (the sanctioned urgency
// exception: a real deadline, stated as fact — no countdown theatrics). The
// caller computes it at send time so the figure is true even if the email was
// held for the recipient's local morning. Floored at 1 (we never send a "0
// hours" or negative figure — the deadline emails always go before the window
// shuts).
function hoursPhrase(hours: number): string {
  const h = Math.max(1, Math.round(hours));
  return h === 1 ? '1 hour' : `${h} hours`;
}

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

// ── Course abandoned checkout ──────────────────────────────────────────────
// The considered-purchase courses (12-week, certification, grief) get the same
// two-touch cart nudge as the workshops above. No live date, so no whenLocal;
// the resume link is the course page with an ?email= prefill (see
// src/lib/courses/abandoned.ts), not an access token.
export type CourseAbandonedCtx = {
  name?: string | null;
  courseName: string; // e.g. "the 12-Week Somatic Vocal Healing Course"
  resumeUrl: string;
  unsubscribeUrl?: string;
};

// Course abandoned 1 (~45 min after they stopped).
export function courseAbandonedEmail1(ctx: CourseAbandonedCtx): EmailContent {
  const html = shell({
    preheader: 'You started signing up — it takes a minute to finish.',
    heading: 'Your place is still open',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">You started signing up for <strong>${escapeHtml(ctx.courseName)}</strong> and stopped somewhere along the way. That happens — pages close, life interrupts.</p>
      <p style="margin:0 0 14px;">Your details are saved. If you'd like to finish, this takes you straight back:</p>
      <p style="margin:0;font-size:14px;color:${PALETTE.soft};">If something didn't work — a card refused, a page that wouldn't load — just reply to this email. A person reads it.</p>`,
    cta: { label: 'Complete my sign-up', href: ctx.resumeUrl },
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
  return {
    subject: 'Your place is still open',
    html,
    text: `${textGreeting(ctx.name)}\n\nYou started signing up for ${ctx.courseName} and stopped somewhere along the way. That happens.\n\nYour details are saved — finish here: ${ctx.resumeUrl}\n\nIf something didn't work on the page, just reply to this email. A person reads it.\n\nWarmly,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// Course abandoned 2 (~20h after; the honest small print).
export function courseAbandonedEmail2(ctx: CourseAbandonedCtx): EmailContent {
  const html = shell({
    preheader: 'Honest small print, in case it helps.',
    heading: 'Still thinking it over?',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">Yesterday you almost joined <strong>${escapeHtml(ctx.courseName)}</strong>. Maybe life got in the way — or maybe you weren't sure it's for you.</p>
      ${figureRow(
        IMG.soundingYellow,
        'A participant sounding — eyes closed, hand on heart',
        `<p style="margin:0;">In case it's the second one, the honest small print: this is a practice of sounding, not singing. You don't need a good voice — you need an honest one. One tone, the tone of what's actually there. You go at your own pace, in your own room, and soft counts.</p>`,
      )}
      <p style="margin:0;">And if now simply isn't the time — that's an honest answer too. The door doesn't disappear.</p>`,
    cta: { label: 'Finish signing up', href: ctx.resumeUrl },
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
  return {
    subject: 'Still thinking it over?',
    html,
    text: `${textGreeting(ctx.name)}\n\nYesterday you almost joined ${ctx.courseName}. Maybe life got in the way — or maybe you weren't sure it's for you.\n\nIn case it's the second one, the honest small print: this is a practice of sounding, not singing. You don't need a good voice — you need an honest one. One tone, the tone of what's actually there. You go at your own pace, in your own room, and soft counts.\n\nAnd if now simply isn't the time — that's an honest answer too. The door doesn't disappear.\n\n— Jacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// Imagery for the redesigned course emails (verified R2 keys).
const COURSE_IMG = {
  circleSunset:
    'https://songdance.co/media/library/svh-retreat-circle-sunset-group-jacob-central.webp',
  oneBreath: 'https://songdance.co/media/library/svhgpt-01-hero-in-one-breath.webp',
};

// Imagery for the redesigned PRO / certification emails (verified, landscape):
// Jacob facilitating a circle, and a giving/receiving glow between two people.
const PRO_IMG = {
  facilitating: 'https://songdance.co/media/library/jacob-holding-space.webp',
  givingReceiving: 'https://songdance.co/media/library/svhgpt-06-holding-space.webp',
};

// ── Attended 1 (right after the session): thank-you + the 48h window ───────
export function attendedEmail1(
  ctx: LifecycleCtx & {
    courseUrl: string;
    discountEndsLocal: string;
    hoursRemaining: number;
    discountPercent: number;
    promo: boolean;
    alreadyBoughtCourse?: boolean;
  },
): EmailContent {
  const left = hoursPhrase(ctx.hoursRemaining);
  const pct = ctx.discountPercent;
  // Promo: the launch sale, named by its plain calendar deadline. Otherwise the
  // 20% participant window on its 48h countdown. See postWorkshopEmailOffer.
  const discountTextLine = ctx.promo
    ? `Right now everything is ${pct}% off for our launch — through ${ctx.discountEndsLocal}. The link below already knows it's you: your discounted price is on the page, nothing to type.`
    : `As a participant you have ${pct}% off — for the next ${left}, until ${ctx.discountEndsLocal}. The link below already knows it's you: your discounted price is on the page, nothing to type.`;
  const opener = [
    D.para(greeting(ctx.name)),
    D.para(
      `Thank you for being part of <strong>${escapeHtml(
        ctx.workshopTitle,
      )}</strong>. Whatever sound you made today — it was the right one. You cannot do it wrong; it always expresses something.`,
    ),
    D.para(
      'In the day or two after a session the body sometimes keeps commenting — a yawn out of nowhere, tiredness, a feeling passing through. Nothing is wrong. Give it room, and when in doubt: one breath in, one tone out.',
    ),
  ].join('');

  if (ctx.alreadyBoughtCourse) {
    const html = D.designShell({
      preheader: 'A note for the days after.',
      title: 'Thank you for sounding with us',
      heroImage: { src: COURSE_IMG.circleSunset, alt: 'A Songdance circle, gathered at sunset' },
      blocks: [
        D.eyebrow('After the workshop'),
        D.displayHeading(`Thank you for ${D.accent('sounding')} with us`),
        opener,
        D.para(
          "And since your next step here is already booked, we'll be seeing more of each other. Until then: three breaths and a tone.",
        ),
        D.signoff(),
      ].join(''),
      footer: { unsubscribeUrl: ctx.unsubscribeUrl },
    });
    return {
      subject: 'Thank you for sounding with us',
      html,
      text: `${textGreeting(ctx.name)}\n\nThank you for being part of ${ctx.workshopTitle}. Whatever sound you made today — it was the right one. You cannot do it wrong; it always expresses something.\n\nIn the day or two after a session the body sometimes keeps commenting — a yawn out of nowhere, tiredness, a feeling passing through. Nothing is wrong. Give it room.\n\nAnd since your next step here is already booked, we'll be seeing more of each other. Until then: three breaths and a tone.\n\nWith love,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
    };
  }

  const html = D.designShell({
    preheader: ctx.promo
      ? `A note for the days after — and ${pct}% off the 12-week course through ${ctx.discountEndsLocal}.`
      : `A note for the days after — and ${left} of ${pct}% off the 12-week course.`,
    title: 'Thank you for sounding with us',
    heroImage: {
      src: COURSE_IMG.circleSunset,
      alt: 'A Songdance circle, gathered at sunset',
      href: ctx.courseUrl,
    },
    blocks: [
      D.eyebrow('After the workshop'),
      D.displayHeading(`Thank you for ${D.accent('sounding')} with us`),
      opener,
      D.divider(),
      D.para(
        'If you’d like to take this further, the 12-week course is where the practice becomes your own — twelve weeks, one layer at a time, in your own time, with live Q&amp;A whenever you want company.',
      ),
      D.sectionLabel('What the twelve weeks hold'),
      D.bullet(
        '<strong>18+ hours of guided practice</strong> across twelve modules — chaptered, self-paced, yours to return to for life.',
      ),
      D.bullet(
        '<strong>Weekly live Q&amp;A with Jacob</strong>, on a rotating schedule for every timezone, with replays.',
      ),
      D.bullet(
        'A path that moves one layer at a time — reading your own voice, working <em>with</em> the nervous system, the five core wounds, sounding toward essence.',
      ),
      D.bullet('A supportive student community — and, on joining, five of Jacob’s original mantras.'),
      D.offerBox({
        variant: 'cream',
        badge: ctx.promo ? `${pct}% off · launch sale` : `${pct}% off · for participants`,
        title: ctx.promo ? 'Your launch price is waiting' : 'Your participant price is waiting',
        lines: [
          ctx.promo
            ? `Right now everything is <strong>${pct}% off</strong> for our launch — through ${escapeHtml(
                ctx.discountEndsLocal,
              )}.`
            : `As a participant you have <strong>${pct}% off</strong> — for the next ${escapeHtml(
                left,
              )}, until ${escapeHtml(ctx.discountEndsLocal)}.`,
          "The button below already knows it's you: your discounted price is on the page, nothing to type.",
        ],
        button: { label: `See my price — ${pct}% off`, href: ctx.courseUrl },
        footnote: 'Prefer to spread it out? A three-part monthly plan carries the discount too.',
      }),
      D.guaranteeNote(),
      D.signoff(),
    ].join(''),
    footer: { unsubscribeUrl: ctx.unsubscribeUrl },
  });
  return {
    // The email's heading stays "Thank you for sounding with us"; the subject
    // points at the next step (the 12-week course) so the inbox line earns the
    // open on its own terms rather than reading as a bare thank-you.
    subject: 'How to continue this practice',
    html,
    text: `${textGreeting(ctx.name)}\n\nThank you for being part of ${ctx.workshopTitle}. Whatever sound you made today — it was the right one. You cannot do it wrong; it always expresses something.\n\nIn the day or two after a session the body sometimes keeps commenting — a yawn out of nowhere, tiredness, a feeling passing through. Nothing is wrong. Give it room, and when in doubt: one breath in, one tone out.\n\nIf you'd like to take this further, the 12-week course is where the practice becomes your own — twelve weeks, one layer at a time, in your own time, with live Q&A whenever you want company.\n\nWhat the twelve weeks hold:\n- 18+ hours of guided practice across twelve modules — chaptered, self-paced, yours to return to for life.\n- Weekly live Q&A with Jacob, on a rotating schedule for every timezone, with replays.\n- A path that moves one layer at a time — reading your own voice, working with the nervous system, the five core wounds, sounding toward essence.\n- A supportive student community — and, on joining, five of Jacob's original mantras.\n\n${discountTextLine}\n\n${GUARANTEE_TEXT}\n\n${ctx.courseUrl}\n\nWith love,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── Attended 2 (+24h): the case for the course, factually ──────────────────
export function attendedEmail2(
  ctx: LifecycleCtx & {
    courseUrl: string;
    discountEndsLocal: string;
    hoursRemaining: number;
    discountPercent: number;
    promo: boolean;
  },
): EmailContent {
  const left = hoursPhrase(ctx.hoursRemaining);
  const pct = ctx.discountPercent;
  const html = D.designShell({
    preheader: ctx.promo
      ? `${pct}% off the 12-week course — through ${ctx.discountEndsLocal}.`
      : `Your ${pct}% ends in about ${left} — ${ctx.discountEndsLocal}.`,
    title: 'What is below that?',
    heroImage: { src: COURSE_IMG.oneBreath, alt: 'One breath in, one tone out' },
    blocks: [
      D.eyebrow('The method, gently'),
      D.displayHeading(`What is ${D.accent('below')} that?`),
      D.para(greeting(ctx.name)),
      D.para(
        "In the workshop you made the sound of the moment — one breath in, one tone out. That's the front door of this practice.",
      ),
      D.para(
        'Behind it sits a method. After the first tone you ask: <em>what is below that?</em> — and you make the sound of that. You only ever need to go one level deeper. Learning to do that kindly, at your own tempo, is what the twelve weeks are for.',
      ),
      D.sectionLabel('Where the twelve weeks take you'),
      D.para(
        'It moves gently, one module at a time — from what sounding actually is (and how it differs from singing, toning, chanting), through hearing the feeling and the pattern inside your own voice and using sound to settle the nervous system, into the five core wounds met safely, sounding toward your own essence, and finally carrying the practice forward on your own.',
        { tone: 'soft' },
      ),
      D.para(
        'The shape is built to fit a life: <strong>18+ hours of video you take at your own pace</strong>, a <strong>weekly live hour with Jacob</strong> for questions (rotating timezones, with replays), a student community to practise with, and <strong>lifetime access</strong> to all of it.',
      ),
      D.para(
        "It's not an eternal excavation — it's a tool you keep. Don't expect miracles; expect a real relationship with your own voice.",
      ),
      D.pullQuote('Below every wound, another door.'),
      D.offerBox({
        variant: 'cream',
        badge: ctx.promo ? `${pct}% off · launch sale` : `about ${left} left`,
        title: `Your ${pct}% is still on`,
        lines: [
          ctx.promo
            ? `The launch sale runs <strong>through ${escapeHtml(
                ctx.discountEndsLocal,
              )}</strong>. After that, the regular price returns.`
            : `Your participant discount ends in about <strong>${escapeHtml(
                left,
              )} — ${escapeHtml(ctx.discountEndsLocal)}</strong>. After that, full price.`,
          'The button opens the page with your price already showing — nothing to type.',
        ],
        button: { label: `See my price — ${pct}% off`, href: ctx.courseUrl },
      }),
      D.guaranteeNote(),
      D.signoff(),
    ].join(''),
    footer: { unsubscribeUrl: ctx.unsubscribeUrl },
  });
  return {
    subject: 'What is below that?',
    html,
    text: `${textGreeting(ctx.name)}\n\nIn the workshop you made the sound of the moment — one breath in, one tone out. That's the front door of this practice.\n\nBehind it sits a method. After the first tone you ask: what is below that? — and you make the sound of that. You only ever need to go one level deeper. Learning to do that kindly, at your own tempo, is what the twelve weeks are for.\n\nWhere the twelve weeks take you: it moves gently, one module at a time — from what sounding actually is (and how it differs from singing, toning, chanting), through hearing the feeling and the pattern inside your own voice and using sound to settle the nervous system, into the five core wounds met safely, sounding toward your own essence, and finally carrying the practice forward on your own.\n\nThe shape is built to fit a life: 18+ hours of video you take at your own pace, a weekly live hour with Jacob for questions (rotating timezones, with replays), a student community to practise with, and lifetime access to all of it.\n\nIt's not an eternal excavation — it's a tool you keep. Don't expect miracles; expect a real relationship with your own voice.\n\n${
      ctx.promo
        ? `A practical note: the launch sale runs through ${ctx.discountEndsLocal}. The link below opens the page with your price already showing. After that, the regular price returns.`
        : `A practical note: your ${pct}% ends in about ${left} — ${ctx.discountEndsLocal}. The link below opens the page with your price already showing. After that, full price.`
    }\n\n${GUARANTEE_TEXT}\n\n${ctx.courseUrl}\n\n— Jacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── Attended 3 (+42h): the third touch ─────────────────────────────────────
// Two moods. Normally (20% participant window) this is the *last-chance* push —
// the one email in the sequence allowed to press, with the ticking countdown,
// because a real 48h window is genuinely about to shut. During the launch promo
// there is no 48h cliff (the 50% runs to a fixed calendar date, days away), so
// pressing "last chance" here would be false urgency — instead it becomes a
// soft, no-countdown reminder that the sale is still on. Reverts to the tight
// version automatically the moment the promo ends. See postWorkshopEmailOffer.
export function attendedEmail3(
  ctx: LifecycleCtx & {
    courseUrl: string;
    discountEndsLocal: string;
    hoursRemaining: number;
    countdownGifUrl: string;
    discountPercent: number;
    promo: boolean;
  },
): EmailContent {
  const left = hoursPhrase(ctx.hoursRemaining);
  const pct = ctx.discountPercent;

  if (ctx.promo) {
    // Soft reminder — no "last chance", no countdown. The sale is real and the
    // deadline is named plainly, but the tone stays gentle.
    const html = D.designShell({
      preheader: `A gentle note — ${pct}% off the 12-week course runs through ${ctx.discountEndsLocal}.`,
      title: "Still here when you're ready",
      blocks: [
        D.eyebrow('While the sale is on'),
        D.displayHeading(`Still here when you're ${D.accent('ready')}`),
        D.para(greeting(ctx.name)),
        D.para(
          `A gentle note, no countdown: the launch sale — <strong>${pct}% off</strong> the 12-week course — runs through <strong>${escapeHtml(
            ctx.discountEndsLocal,
          )}</strong>. If the practice has been on your mind, the door is open at that price until then; if now isn't the time, that's an honest answer too.`,
        ),
        D.para(
          "What you'd be stepping into: eighteen-plus hours of guided practice across twelve modules, a weekly live hour with Jacob, a student community, and lifetime access.",
        ),
        D.offerBox({
          variant: 'cream',
          badge: `${pct}% off · launch sale`,
          title: "Here when you're ready",
          lines: [
            `${pct}% off, already applied for you — the button opens the page with your price showing.`,
            "If spreading it out helps, there's a three-part monthly plan; the discount counts there too.",
          ],
          button: { label: `See my price — ${pct}% off`, href: ctx.courseUrl },
          footnote:
            "If the answer is “not now”, that's an honest answer and nothing is lost — no pressure either way.",
        }),
        D.guaranteeNote(),
        D.para(
          "Unsure whether it's for you? Reply with your question any time; a person answers plainly. If it's not for you, we'll say so.",
          { tone: 'soft' },
        ),
        D.signoff(),
      ].join(''),
      footer: { unsubscribeUrl: ctx.unsubscribeUrl },
    });
    return {
      subject: 'Still here, if the 12-week course is calling',
      html,
      text: `${textGreeting(ctx.name)}\n\nA gentle note, no countdown: the launch sale — ${pct}% off the 12-week course — runs through ${ctx.discountEndsLocal}. If the practice has been on your mind, the door is open at that price until then; if now isn't the time, that's an honest answer too.\n\nWhat you'd be stepping into: eighteen-plus hours of guided practice across twelve modules, a weekly live hour with Jacob, a student community, and lifetime access. ${pct}% off is already applied for you — the link below opens the page with your price showing. If spreading it out helps, there's a three-part monthly plan; the discount counts there too.\n\nUnsure whether it's for you? Reply with your question any time; a person answers plainly. If it's not for you, we'll say so.\n\n${GUARANTEE_TEXT}\n\n${ctx.courseUrl}\n\nWith love,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
    };
  }

  const html = D.designShell({
    preheader: `It ends ${ctx.discountEndsLocal}, about ${left} from now. After that, full price.`,
    title: `Last chance on your ${pct}%`,
    blocks: [
      D.eyebrow('The window is closing'),
      D.displayHeading(`Last ${D.accent('chance')} on your ${pct}%`),
      D.para(greeting(ctx.name)),
      D.countdownPanel({
        gifUrl: ctx.countdownGifUrl,
        altText: `Your ${pct}% ends ${ctx.discountEndsLocal} — about ${left} left`,
        caption: 'Time left on your participant discount',
      }),
      D.para(
        `This is the last call I'll send about it: your participant discount on the 12-week course ends <strong>${escapeHtml(
          ctx.discountEndsLocal,
        )}</strong> — about ${escapeHtml(left)} from now. After that, full price.`,
      ),
      D.para(
        "What you'd be stepping into: eighteen-plus hours of guided practice across twelve modules, a weekly live hour with Jacob, a student community, and lifetime access.",
      ),
      D.offerBox({
        variant: 'plum',
        badge: `${pct}% off · ending`,
        title: 'Take it before the window shuts',
        lines: [
          `${pct}% off, already applied for you — the button opens the page with your price showing.`,
          "If spreading it out helps, there's a three-part monthly plan; the discount counts there too.",
        ],
        button: { label: `Take ${pct}% off before it ends`, href: ctx.courseUrl },
        footnote:
          "If the answer is “not now”, that's an honest answer and nothing is lost. But if you've been meaning to — this is the moment it costs the least.",
      }),
      D.guaranteeNote(),
      D.para(
        "Unsure whether it's for you? Reply with your question before the window shuts; a person answers plainly. If it's not for you, we'll say so.",
        { tone: 'soft' },
      ),
      D.signoff(),
    ].join(''),
    footer: { unsubscribeUrl: ctx.unsubscribeUrl },
  });
  return {
    subject: `Last chance — your ${pct}% ends in about ${left}`,
    html,
    text: `${textGreeting(ctx.name)}\n\nThis is the last call I'll send about it: your participant discount on the 12-week course ends ${ctx.discountEndsLocal} — about ${left} from now. After that, full price.\n\nWhat you'd be stepping into: eighteen-plus hours of guided practice across twelve modules, a weekly live hour with Jacob, a student community, and lifetime access.\n\nThe facts, once more: ${pct}% off, already applied for you — the link below opens the page with your price showing. If spreading it out helps, there's a three-part monthly plan; the discount counts there too.\n\nIf the answer is "not now", that's an honest answer and nothing is lost. But if you've been meaning to — this is the moment it costs the least.\n\nUnsure whether it's for you? Reply with your question before the window shuts; a person answers plainly. If it's not for you, we'll say so.\n\n${GUARANTEE_TEXT}\n\n${ctx.courseUrl}\n\nWith love,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── Attended, PRO branch (masterclass / is_pro): the certification path ────
// Rendered through the richer design toolkit (`D`), matching the redesigned
// attended/downsell emails — a hero band, eyebrow, Spectral heading, bullets,
// and a contained CTA. Copy-book voice unchanged (space-holder, not fixer).
export function attendedProEmail1(
  ctx: LifecycleCtx & {
    certUrl: string;
    courseUrl: string;
    hoursRemaining: number;
    discountEndsLocal: string;
    discountPercent: number;
    promo: boolean;
  },
): EmailContent {
  const left = hoursPhrase(ctx.hoursRemaining);
  const pct = ctx.discountPercent;
  const html = D.designShell({
    preheader: 'For the ones who hold space for others.',
    title: 'Thank you for sounding with us',
    heroImage: {
      src: PRO_IMG.facilitating,
      alt: 'Jacob facilitating a sounding circle',
      href: ctx.certUrl,
    },
    blocks: [
      D.eyebrow('For practitioners'),
      D.displayHeading(`Thank you for ${D.accent('sounding')} with us`),
      D.para(greeting(ctx.name)),
      D.para(`Thank you for being part of <strong>${escapeHtml(ctx.workshopTitle)}</strong>.`),
      D.para(
        "Because you work with people yourself, there's a path here that may matter more to you than the rest: the <strong>SVH Certification</strong> — learning to hold this space for others.",
      ),
      D.para(
        'Not healer, not fixer: space holder. Someone who keeps the room steady while another person does the one thing only they can do.',
      ),
      D.sectionLabel('What the path involves'),
      D.bullet(
        'The complete class library, each class with a written manual — self-paced, instant access the moment you join.',
      ),
      D.bullet(
        'Weekly live Q&amp;A and monthly deepening sessions through the end of 2026, so the learning stays live, not just recorded.',
      ),
      D.bullet(
        'Hosted practice sessions with peers — giving and receiving is the quiet heart of it, and where facilitation actually grows.',
      ),
      D.bullet(
        'The Somatic Vocal Healing app, a full replay library, a global community, and lifetime access.',
      ),
      D.offerBox({
        variant: 'cream',
        badge: 'The practitioner path',
        title: 'Learning to hold this space',
        lines: [
          'If that sounds like your work, the certification page has the full structure, the classes, and the honest small print.',
        ],
        button: { label: 'Explore the certification path', href: ctx.certUrl },
        footnote: ctx.promo
          ? `Your 12-week price (${pct}% off) is also live through ${escapeHtml(
              ctx.discountEndsLocal,
            )} — ${D.secondaryLink('see your price', ctx.courseUrl)}.`
          : `Your participant window is live for the next ${escapeHtml(
              left,
            )}: ${CERT_PATH_DISCOUNT_PERCENT}% off the whole certification path, or ${pct}% off the 12-week course alone — ${D.secondaryLink('see your price', ctx.courseUrl)}.`,
      }),
      D.guaranteeNote(),
      D.signoff('Warmly,'),
    ].join(''),
    footer: { unsubscribeUrl: ctx.unsubscribeUrl },
  });
  return {
    subject: 'Thank you — and a word for practitioners',
    html,
    text: `${textGreeting(ctx.name)}\n\nThank you for being part of ${ctx.workshopTitle}.\n\nBecause you work with people yourself, there's a path here that may matter more to you than the rest: the SVH Certification — learning to hold this space for others.\n\nNot healer, not fixer: space holder. Someone who keeps the room steady while another person does the one thing only they can do.\n\nWhat the path involves:\n- The complete class library, each class with a written manual — self-paced, instant access the moment you join.\n- Weekly live Q&A and monthly deepening sessions through the end of 2026, so the learning stays live, not just recorded.\n- Hosted practice sessions with peers — giving and receiving is the quiet heart of it, and where facilitation actually grows.\n- The Somatic Vocal Healing app, a full replay library, a global community, and lifetime access.\n\n${ctx.certUrl}\n\n${
      ctx.promo
        ? `PS — ${pct}% off the 12-week course is also live through ${ctx.discountEndsLocal}; this link shows your price directly: ${ctx.courseUrl}`
        : `PS — your participant window is live for the next ${left}: ${CERT_PATH_DISCOUNT_PERCENT}% off the whole certification path, or ${pct}% off the 12-week course alone. This link shows your price directly: ${ctx.courseUrl}`
    }\n\n${GUARANTEE_TEXT}\n\nWarmly,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

export function attendedProEmail2(ctx: LifecycleCtx & { certUrl: string }): EmailContent {
  const html = D.designShell({
    preheader: 'What a facilitator actually does here.',
    title: 'Holding space is a craft',
    heroImage: {
      src: PRO_IMG.givingReceiving,
      alt: 'One person sounding, another holding the space',
      href: ctx.certUrl,
    },
    blocks: [
      D.eyebrow("The facilitator's craft"),
      D.displayHeading(`Holding space is a ${D.accent('craft')}`),
      D.para(greeting(ctx.name)),
      D.para(
        "The facilitator's work in this practice is quiet: keep the room steady, ask the next honest question, hear what the other person can't hear yet — and then get out of the way.",
      ),
      D.para(
        "When someone discovers a connection, you leave that gift to them. You're never the smart one who points it out.",
      ),
      D.pullQuote('The healing is theirs; the space is yours.'),
      D.sectionLabel('What you learn to do'),
      D.bullet(
        'Travel through the layers of a sound, and guide a whole session from the first tone to integration.',
      ),
      D.bullet(
        'Meet the core emotions in the voice — anger, fear, pain, grief — and stay with what is truly being expressed.',
      ),
      D.bullet(
        'Weave in systemic work: mother, father, the line behind a person; giving back what was never theirs to carry.',
      ),
      D.bullet(
        'The therapeutic craft — pacing, regulation, co-regulation, the volume button; knowing when to hold, when to wait, when to let silence do the work.',
      ),
      D.bullet(
        "Your own inner work — projection, transference, what stirs in you when another person's material touches your own.",
      ),
      D.para(
        'And a great deal of practice: hosted sessions with peers, and a final supervised class where you lead in front of the group and get direct feedback. The method, the listening, the safety architecture — so you can bring sounding into the work you already do.',
      ),
      D.para(
        'If you have questions about whether it fits your practice, reply to this email and ask. A person answers.',
        { tone: 'soft' },
      ),
      D.offerBox({
        variant: 'plum',
        title: 'The certification path',
        lines: ['The full structure, the classes, and the honest small print — in one place.'],
        button: { label: 'Explore the certification path', href: ctx.certUrl },
      }),
      D.signoff('Warmly,'),
    ].join(''),
    footer: { unsubscribeUrl: ctx.unsubscribeUrl },
  });
  return {
    subject: 'Holding space is a craft',
    html,
    text: `${textGreeting(ctx.name)}\n\nThe facilitator's work in this practice is quiet: keep the room steady, ask the next honest question, hear what the other person can't hear yet — and then get out of the way.\n\nWhen someone discovers a connection, you leave that gift to them. You're never the smart one who points it out. The healing is theirs; the space is yours.\n\nWhat you learn to do:\n- Travel through the layers of a sound, and guide a whole session from the first tone to integration.\n- Meet the core emotions in the voice — anger, fear, pain, grief — and stay with what is truly being expressed.\n- Weave in systemic work: mother, father, the line behind a person; giving back what was never theirs to carry.\n- The therapeutic craft — pacing, regulation, co-regulation, the volume button; knowing when to hold, when to wait, when to let silence do the work.\n- Your own inner work — projection, transference, what stirs in you when another person's material touches your own.\n\nAnd a great deal of practice: hosted sessions with peers, and a final supervised class where you lead in front of the group and get direct feedback. The method, the listening, the safety architecture — so you can bring sounding into the work you already do.\n\nIf you have questions about whether it fits your practice, reply to this email and ask. A person answers.\n\n${ctx.certUrl}\n\n— Jacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

export function attendedProEmail3(ctx: LifecycleCtx & { certUrl: string }): EmailContent {
  const html = D.designShell({
    preheader: "The work isn't something you do — it's something you become.",
    title: 'If the certification path is calling',
    heroImage: {
      src: IMG.walkSunset,
      alt: 'A figure walking toward the evening light',
      href: ctx.certUrl,
      objectPosition: 'center 62%',
      height: 360,
    },
    blocks: [
      D.eyebrow('No deadline — just the door'),
      D.displayHeading(`If the path is ${D.accent('calling')}`),
      D.para(greeting(ctx.name)),
      D.para("A last note on this — then we'll leave it with you."),
      D.para('Two of our students said something that has stayed with me. The first is a therapist:'),
      D.pullQuote(
        'SVH has added so much to what I can offer people. As a healthcare practitioner, it was the missing piece.',
      ),
      D.para(`The ${D.lyric('missing piece')}.`),
      D.para('Another put it this way:'),
      D.pullQuote(
        'You think you are learning how to work with others, but what really happens is that you come home to yourself — deeply connected to who you are, to why you are here, and quietly confident in holding space for others.',
      ),
      D.para(
        'Again and again, this is what we witness. People arrive believing they are learning a method. They leave realising they have been changed by the very work they hoped to share. What begins as professional training becomes a deeply personal journey — and that inner shift, quietly, becomes the greatest thing they can offer anyone else.',
      ),
      D.pullQuote("This work isn't something you do. It's something you become."),
      D.para(
        "If you've been circling the certification course, the page below has the structure, the classes, and the honest small print. One honest thing before you decide: it isn't a full therapist training — if you'll work with clients, you bring your own ground for holding emotional process. There's no deadline attached either, and no spots-left theatre. Trees don't hurry, and neither does this.",
      ),
      D.para(
        'Not everyone who walks this path is meant to facilitate, and that is right. Some come simply to go all the way in with their own voice — a beautiful calling in its own right. You can come out a certified practitioner, or just changed. Both are welcome here.',
      ),
      D.para(
        "But if something quietly comes alive in you when you imagine guiding another person — if your heart says yes, even softly — don't dismiss that. Sometimes the soul recognises its path long before the mind understands it.",
      ),
      D.para(
        `If it helps to talk it through first, reply here and say where you're standing. We'll answer plainly — including "not yet", if that's the truth.`,
        { tone: 'soft' },
      ),
      D.pillButton('See the certification course', ctx.certUrl),
      D.signoff('Warmly,'),
    ].join(''),
    footer: { unsubscribeUrl: ctx.unsubscribeUrl },
  });
  return {
    subject: 'If the certification path is calling',
    html,
    text: `${textGreeting(ctx.name)}\n\nA last note on this — then we'll leave it with you.\n\nTwo of our students said something that has stayed with me. The first is a therapist:\n\n"SVH has added so much to what I can offer people. As a healthcare practitioner, it was the missing piece."\n\nThe missing piece.\n\nAnother put it this way:\n\n"You think you are learning how to work with others, but what really happens is that you come home to yourself — deeply connected to who you are, to why you are here, and quietly confident in holding space for others."\n\nAgain and again, this is what we witness. People arrive believing they are learning a method. They leave realising they have been changed by the very work they hoped to share. What begins as professional training becomes a deeply personal journey — and that inner shift, quietly, becomes the greatest thing they can offer anyone else.\n\nThis work isn't something you do. It's something you become.\n\nIf you've been circling the certification course, the page below has the structure, the classes, and the honest small print. One honest thing before you decide: it isn't a full therapist training — if you'll work with clients, you bring your own ground for holding emotional process. There's no deadline attached either, and no spots-left theatre. Trees don't hurry, and neither does this.\n\nNot everyone who walks this path is meant to facilitate, and that is right. Some come simply to go all the way in with their own voice — a beautiful calling in its own right. You can come out a certified practitioner, or just changed. Both are welcome here.\n\nBut if something quietly comes alive in you when you imagine guiding another person — if your heart says yes, even softly — don't dismiss that. Sometimes the soul recognises its path long before the mind understands it.\n\nIf it helps to talk it through first, reply here and say where you're standing. We'll answer plainly — including "not yet", if that's the truth.\n\n${ctx.certUrl}\n\nWarmly,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── Song Deck gift claim (transactional) ────────────────────────────────────
// Sent once when a course purchase that carries the post-workshop Song Deck
// gift is fulfilled (the zero-amount `songdeck-gift` bumps row — see
// src/lib/courses/deck-promo.ts; the send lives in
// src/lib/orders/notification.ts). The button opens songdeck.shop with the
// SVH-BONUS coupon already applied, so deck + worldwide shipping land at €0;
// Shopify collects the shipping address and places the order. Transactional:
// part of the purchase, so no unsubscribe gating.
export function deckGiftClaimEmail(ctx: {
  name?: string | null;
  claimUrl: string;
  couponCode: string;
  shopUrl: string;
}): EmailContent {
  const html = shell({
    preheader: 'Your free Songdeck — one tap, shipped free, anywhere.',
    heading: 'Your Songdeck is waiting',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">You said yes within the hour — so the <strong>Songdeck</strong> is our gift, to honour your momentum: thirty-six illustrated song cards, each with its own written message and its own music, in a sturdy magnetic box.</p>
      <p style="margin:0 0 14px;">The button below opens the Songdeck shop with your coupon already applied — the deck and worldwide shipping come to <strong>€0</strong> at checkout. Fill in your shipping address there and it's on its way to you.</p>
      <p style="margin:0;">If the code doesn't carry over for any reason, enter <strong>${escapeHtml(ctx.couponCode)}</strong> at checkout yourself.</p>`,
    cta: { label: 'Claim your free Songdeck →', href: ctx.claimUrl },
    footerNote: 'This gift came with your course registration — no strings attached to it.',
  });
  return {
    subject: 'Your free Songdeck — claim it here',
    html,
    text: `${textGreeting(ctx.name)}\n\nYou said yes within the hour — so the Songdeck is our gift, to honour your momentum: thirty-six illustrated song cards, each with its own written message and its own music, in a sturdy magnetic box.\n\nThis link opens the Songdeck shop with your coupon already applied — the deck and worldwide shipping come to €0 at checkout. Fill in your shipping address there and it's on its way to you:\n\n${ctx.claimUrl}\n\nIf the code doesn't carry over for any reason, enter ${ctx.couponCode} at checkout yourself: ${ctx.shopUrl}\n\nWarmly,\nJacob`,
  };
}

// ── Song Deck gift — order placed, on its way ───────────────────────────────
// Sent instead of the claim email when we placed the free deck order on Shopify
// directly (the buyer gave a shipping address at checkout). Confirms it's on its
// way to the address they gave, so there's nothing left for them to do.
// Transactional: part of the purchase, so no unsubscribe gating.
export function deckGiftConfirmedEmail(ctx: {
  name?: string | null;
  // Pre-formatted multi-line address to echo back (already escaped-safe text).
  addressLines: string[];
}): EmailContent {
  const addrHtml = ctx.addressLines
    .filter((l) => l.trim())
    .map((l) => escapeHtml(l))
    .join('<br />');
  const addrText = ctx.addressLines.filter((l) => l.trim()).join('\n');
  const html = shell({
    preheader: "Ordered and paid for — we'll email you the moment it ships.",
    heading: "We're on it — your Songdeck is coming",
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">You said yes within the hour — so the <strong>Songdeck</strong> is our gift, to honour your momentum: thirty-six illustrated song cards, each with its own written message and its own music, in a sturdy magnetic box.</p>
      <p style="margin:0 0 14px;">We're on it — the order is placed and paid for, and it ships free, worldwide, so there's nothing left to do on your end. Each deck is made and sent with care, so it can take up to 30 days to reach you. We'll email you the moment it ships. Here's where it's headed:</p>
      <p style="margin:0 0 14px;padding:14px 16px;background-color:${PALETTE.bg};border:1px solid ${PALETTE.border};border-radius:10px;font-size:15px;line-height:1.6;color:${PALETTE.ink};">${addrHtml}</p>
      <p style="margin:0;">If anything there looks off, just reply to this email and we'll fix it before it ships.</p>`,
    footerNote: 'This gift came with your course registration — no strings attached to it.',
  });
  return {
    subject: "We're on it — your free Songdeck is coming",
    html,
    text: `${textGreeting(ctx.name)}\n\nYou said yes within the hour — so the Songdeck is our gift, to honour your momentum: thirty-six illustrated song cards, each with its own written message and its own music, in a sturdy magnetic box.\n\nWe're on it — the order is placed and paid for, and it ships free, worldwide, so there's nothing left to do on your end. Each deck is made and sent with care, so it can take up to 30 days to reach you. We'll email you the moment it ships. Here's where it's headed:\n\n${addrText}\n\nIf anything there looks off, just reply to this email and we'll fix it before it ships.\n\nWarmly,\nJacob`,
  };
}

// ── Mantra pack delivery (transactional) ───────────────────────────────────
// Sent when a workshop/masterclass order carries the "Empowering You" mantra
// pack order bump. The pack lives as a gated music album (src/lib/music/), so
// this email hands over the player link and names the email that opens it —
// the buyer's own address, which is the login there.
//
// Copy note: mantras are deliberately NOT framed as the practice. The copy book
// (ch. 6) keeps them apart — a mantra hands you a chosen quality to lean on,
// sounding asks what's here. So this says "a different door", never blurs the
// two, and promises nothing beyond what the recordings are.
// Shared pieces for the two album-delivery emails — the mantra-pack bump here
// and a standalone album purchase below. The player link both hand over already
// carries the buyer's address (`?email=`), so the page opens *signed in*; the
// address is still named because that's what opens it on another device, and
// because a forwarded/expired link should leave them knowing the way in.
type AlbumEmailCtx = {
  name?: string | null;
  loginEmail: string;
  albumTitle: string;
  albumUrl: string; // already carries ?email= — see src/lib/music/delivery.ts
  trackTitles: string[];
  coverUrl?: string | null;
};

function albumSectionHead(label: string): string {
  return `<p style="margin:20px 0 10px;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:${PALETTE.ember};">${escapeHtml(label)}</p>`;
}

function albumTracksHtml(titles: string[]): string {
  if (!titles.length) return '';
  return `${albumSectionHead("What's inside")}${titles.map((t) => dot(escapeHtml(t))).join('')}`;
}

function albumTracksText(titles: string[]): string {
  if (!titles.length) return '';
  return `\nWhat's inside:\n${titles.map((t) => `- ${t}`).join('\n')}\n`;
}

function albumOpenHtml(loginEmail: string): string {
  return `${albumSectionHead('How to open it')}
      <p style="margin:0 0 14px;">Just press the button — the link knows it's you, so it opens straight into the player. Nothing to download, nothing to install; bookmark the page and it's there for good.</p>
      <p style="margin:0 0 14px;font-size:14px;color:${PALETTE.soft};">On another device, or if you ever land on the email box: it opens with <strong>${escapeHtml(loginEmail)}</strong>, the address you ordered with.</p>`;
}

function albumOpenText(loginEmail: string, albumUrl: string): string {
  return `\nHow to open it — this link knows it's you, so it opens straight into the player:\n${albumUrl}\n\nNothing to download, nothing to install; bookmark the page and it's there for good. On another device, or if you ever land on the email box, it opens with ${loginEmail} — the address you ordered with.\n`;
}

export function mantraPackEmail(ctx: AlbumEmailCtx): EmailContent {
  const intro = `<p style="margin:0 0 14px;">These are five mantras, recorded live with a choir in South Africa and set to original music. Not tracks to sit back and listen to — lines to carry with your own voice, as loudly or as quietly as you like.</p>`;
  const introBlock = ctx.coverUrl
    ? figureRow(ctx.coverUrl, `${ctx.albumTitle} — album cover`, intro)
    : intro;
  const html = shell({
    preheader: `Your mantras are ready — open the player any time.`,
    heading: 'Your mantras are ready',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">You added the <strong>${escapeHtml(ctx.albumTitle)}</strong> mantra pack to your order — thank you. It's yours now, and it stays yours: open it whenever you want, on any device, as often as you like.</p>
      ${introBlock}
      ${albumTracksHtml(ctx.trackTitles)}
      ${albumOpenHtml(ctx.loginEmail)}
      <p style="margin:0 0 14px;">A mantra is a different door from the sounding we do together. Sounding asks what's here today and lets that out, unedited; a mantra hands you a line and lets the music carry it. Both belong. Some days one is what you want, some days the other.</p>
      ${quoteLine('Words worth repeating, in your own voice.')}`,
    cta: { label: 'Open my mantra player →', href: ctx.albumUrl },
    footerNote: "This came with your order — it's yours to keep.",
  });
  return {
    subject: `Your mantras are ready — ${ctx.albumTitle}`,
    html,
    text: `${textGreeting(ctx.name)}\n\nYou added the ${ctx.albumTitle} mantra pack to your order — thank you. It's yours now, and it stays yours: open it whenever you want, on any device, as often as you like.\n\nThese are five mantras, recorded live with a choir in South Africa and set to original music. Not tracks to sit back and listen to — lines to carry with your own voice, as loudly or as quietly as you like.\n${albumTracksText(ctx.trackTitles)}${albumOpenText(ctx.loginEmail, ctx.albumUrl)}\nA mantra is a different door from the sounding we do together. Sounding asks what's here today and lets that out, unedited; a mantra hands you a line and lets the music carry it. Both belong.\n\nWarmly,\nJacob`,
  };
}

// ── Album purchase delivery (transactional) ────────────────────────────────
// Sent when someone buys a music album on its own (product slug `album-<id>`,
// src/lib/music/product.ts) rather than getting it as an order bump. Deliberately
// generic over the album: the character comes from the album's own description
// on its `music_albums` row, so a second album needs no new template — and a
// standalone mantra-pack sale reads true without borrowing the bump's framing.
export function albumPurchaseEmail(
  ctx: AlbumEmailCtx & { albumDescription?: string | null },
): EmailContent {
  const desc = (ctx.albumDescription ?? '').trim();
  const intro = desc
    ? `<p style="margin:0 0 14px;">${escapeHtml(desc)}</p>`
    : `<p style="margin:0 0 14px;">It's yours to keep — play it whenever you want, on any device, as often as you like.</p>`;
  const introBlock = ctx.coverUrl
    ? figureRow(ctx.coverUrl, `${ctx.albumTitle} — album cover`, intro)
    : intro;
  const html = shell({
    preheader: `${ctx.albumTitle} is yours — open the player any time.`,
    heading: 'Your album is ready',
    bodyHtml: `<p style="margin:0 0 14px;">${greeting(ctx.name)}</p>
      <p style="margin:0 0 14px;">Thank you — <strong>${escapeHtml(ctx.albumTitle)}</strong> is yours. It stays yours: no subscription, no expiry, nothing to renew.</p>
      ${introBlock}
      ${albumTracksHtml(ctx.trackTitles)}
      ${albumOpenHtml(ctx.loginEmail)}
      <p style="margin:0 0 14px;">If anything doesn't play, or you'd rather have the files another way, just reply to this email — a person reads it.</p>`,
    cta: { label: 'Open my album →', href: ctx.albumUrl },
    footerNote: "Your album — yours to keep.",
  });
  return {
    subject: `Your album is ready — ${ctx.albumTitle}`,
    html,
    text: `${textGreeting(ctx.name)}\n\nThank you — ${ctx.albumTitle} is yours. It stays yours: no subscription, no expiry, nothing to renew.\n${desc ? `\n${desc}\n` : ''}${albumTracksText(ctx.trackTitles)}${albumOpenText(ctx.loginEmail, ctx.albumUrl)}\nIf anything doesn't play, or you'd rather have the files another way, just reply to this email — a person reads it.\n\nWarmly,\nJacob`,
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

// ═══════════════════════════════════════════════════════════════════════════
// Downsell — reworked. After the 20% window closes unbought, we stop nagging
// about the €650 course and offer the gentler doors instead: the journeys and
// the grief course. WHICH offers a person sees is chosen per-recipient by the
// cron from what they don't already own (Drip product tags + paid purchases,
// including the workshop's asj order bump), passed in as `offers`. If they own
// the lot, the cron sends only email 1 as a no-pitch wind-down.
// ═══════════════════════════════════════════════════════════════════════════

export type DownsellCtx = LifecycleCtx & {
  base: string;
  courseUrl: string;
  calendarUrl: string;
  offers: DownsellOffer[]; // eligible (not-yet-owned), in preference order; may be empty
  bundleEligible: boolean; // owns none of the three journeys → mention the bundle
};

function offerUrl(base: string, offer: DownsellOffer): string {
  return `${base}${offer.path}?utm_source=email&utm_medium=lifecycle&utm_campaign=downsell&utm_content=${offer.key}`;
}

function bundleUrl(base: string): string {
  return `${base}${BUNDLE_PATH}?utm_source=email&utm_medium=lifecycle&utm_campaign=downsell&utm_content=bundle`;
}

function offerCtaLabel(offer: DownsellOffer): string {
  return offer.key === 'grief' ? 'See the grief course' : 'Explore the journey';
}

function offerFeatureCard(base: string, offer: DownsellOffer): string {
  return D.featureCard({
    image: offer.image,
    imageAlt: offer.imageAlt,
    eyebrow: offer.eyebrow,
    title: offer.label,
    blurb: offer.blurb,
    points: offer.points,
    priceNote: offer.priceNote,
    cta: { label: offerCtaLabel(offer), href: offerUrl(base, offer) },
  });
}

function offerMiniCard(base: string, offer: DownsellOffer): string {
  return D.miniCard({
    image: offer.image,
    title: offer.label,
    line: offer.miniLine,
    href: offerUrl(base, offer),
  });
}

// A plain-text line for an offer (text/plain part).
function offerTextLine(base: string, offer: DownsellOffer): string {
  return `• ${offer.label} — ${offer.miniLine}\n  ${offerUrl(base, offer)}`;
}

// ── Downsell 1 (+4d): a gentler door — feature the top not-owned offer ──────
export function downsellEmail1(ctx: DownsellCtx): EmailContent {
  // Owns everything we'd promote → a no-pitch wind-down (and the cron won't send
  // emails 2 & 3).
  if (ctx.offers.length === 0) {
    const html = D.designShell({
      preheader: 'The practice that needs no purchase — and where to find us live.',
      title: 'The sound was always yours',
      heroImage: { src: IMG.soundingYellow, alt: 'A participant sounding, hand on heart', objectPosition: 'center 42%' },
      blocks: [
        D.eyebrow('After the window'),
        D.displayHeading(`The sound was always ${D.accent('yours')}`),
        D.para(greeting(ctx.name)),
        D.para(
          'The participant discount on the 12-week course has closed — a real window, so it stayed shut.',
        ),
        D.para(
          "You already hold a good deal of this practice, so I won't point you at more to buy. The most useful thing needs no purchase anyway:",
        ),
        D.pullQuote('How am I feeling, in this moment? — and make the sound of that.'),
        D.para(
          'Thirty seconds, most mornings. The kitchen is a fine temple. And when you’d like company, come sound with us live again —',
        ),
        D.pillButton('See upcoming live dates', ctx.calendarUrl),
        D.signoff(),
      ].join(''),
      footer: { unsubscribeUrl: ctx.unsubscribeUrl },
    });
    return {
      subject: 'The sound was always yours',
      html,
      text: `${textGreeting(ctx.name)}\n\nThe participant discount on the 12-week course has closed — a real window, so it stayed shut.\n\nYou already hold a good deal of this practice, so I won't point you at more to buy. The most useful thing needs no purchase anyway: in the morning, ask how am I feeling, in this moment? — and make the sound of that. Thirty seconds. The kitchen is a fine temple.\n\nAnd when you'd like company, come sound with us live again: ${ctx.calendarUrl}\n\nWith love,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
    };
  }

  const primary = ctx.offers[0];
  const html = D.designShell({
    preheader: 'The discount has closed — but a gentler door is open.',
    title: "If the timing wasn't right",
    // No hero — the featured product card lower down carries the image.
    blocks: [
      D.eyebrow('After the window'),
      D.displayHeading(`A ${D.accent('gentler')} door`),
      D.para(greeting(ctx.name)),
      D.para(
        "The participant discount on the 12-week course has closed — a real window, so it stayed shut. But this practice doesn't begin or end with one course, and I didn't want to leave you only at the most expensive door.",
      ),
      D.para("If a smaller, kinder step is the honest one for now, here's where I'd point you:"),
      offerFeatureCard(ctx.base, primary),
      D.para(
        `And the 12-week course keeps its door open for a later season — there's a three-part monthly plan too, if spreading it out is what helps. ${D.secondaryLink(
          'See the 12-week course',
          ctx.courseUrl,
        )}`,
        { tone: 'soft' },
      ),
      D.para(
        "If it's doubt rather than timing, just reply and tell me where you're standing — a person reads these. We'd rather under-promise.",
      ),
      D.signoff(),
    ].join(''),
    footer: { unsubscribeUrl: ctx.unsubscribeUrl },
  });
  return {
    subject: "If the timing wasn't right",
    html,
    text: `${textGreeting(ctx.name)}\n\nThe participant discount on the 12-week course has closed — a real window, so it stayed shut. But this practice doesn't begin or end with one course, and I didn't want to leave you only at the most expensive door.\n\nIf a smaller, kinder step is the honest one for now, here's where I'd point you:\n\n${offerTextLine(
      ctx.base,
      primary,
    )}\n\nAnd the 12-week course keeps its door open for a later season — there's a three-part monthly plan too, if spreading it out helps: ${ctx.courseUrl}\n\nIf it's doubt rather than timing, just reply and tell me where you're standing — a person reads these. We'd rather under-promise.\n\nWith love,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── Downsell 2 (+8d): in your own room — the next door + the rest ───────────
export function downsellEmail2(ctx: DownsellCtx): EmailContent {
  const primary = ctx.offers[Math.min(1, ctx.offers.length - 1)] ?? null;
  const minis = primary ? ctx.offers.filter((o) => o.key !== primary.key) : ctx.offers;
  const bundleLine = ctx.bundleEligible
    ? D.para(
        `Or take all three journeys together — 20% off the three. ${D.secondaryLink(
          'The three journeys',
          bundleUrl(ctx.base),
        )}`,
        { tone: 'soft' },
      )
    : '';
  const html = D.designShell({
    preheader: 'The practice that lives in your own room, between the live hours.',
    title: 'In your own room',
    // No hero — the featured product card lower down carries the image.
    blocks: [
      D.eyebrow('Between sessions'),
      D.displayHeading(`In your own ${D.accent('room')}`),
      D.para(greeting(ctx.name)),
      D.para(
        'One workshop hour plants the seed. What grows it is small and daily — a few minutes in your own room, no Zoom link, no audience, no one to be good enough for.',
      ),
      primary
        ? D.para("If you'd like something to practise with between the live hours, this is the one I'd reach for:")
        : '',
      primary ? offerFeatureCard(ctx.base, primary) : '',
      minis.length ? D.sectionLabel('Also, if it calls') : '',
      minis.map((o) => offerMiniCard(ctx.base, o)).join(''),
      bundleLine,
      D.signoff(),
    ].join(''),
    footer: { unsubscribeUrl: ctx.unsubscribeUrl },
  });
  const minisText = minis.length
    ? `\n\nAlso, if it calls:\n${minis.map((o) => offerTextLine(ctx.base, o)).join('\n')}`
    : '';
  const bundleText = ctx.bundleEligible
    ? `\n\nOr take all three journeys together — 20% off: ${bundleUrl(ctx.base)}`
    : '';
  return {
    subject: 'In your own room',
    html,
    text: `${textGreeting(ctx.name)}\n\nOne workshop hour plants the seed. What grows it is small and daily — a few minutes in your own room, no Zoom link, no audience, no one to be good enough for.\n\n${
      primary
        ? `If you'd like something to practise with between the live hours, this is the one I'd reach for:\n\n${offerTextLine(
            ctx.base,
            primary,
          )}`
        : ''
    }${minisText}${bundleText}\n\nWith love,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}

// ── Downsell 3 (+12d): three breaths and a tone — the free practice, then quiet ─
export function downsellEmail3(ctx: DownsellCtx): EmailContent {
  const recap = ctx.offers.length
    ? [
        D.sectionLabel('And whenever you’d like more'),
        ctx.offers.map((o) => offerMiniCard(ctx.base, o)).join(''),
      ].join('')
    : '';
  const html = D.designShell({
    preheader: 'The practice that needs no purchase — and where to find us live.',
    title: 'Three breaths and a tone',
    heroImage: { src: IMG.soundingYellow, alt: 'A participant sounding, hand on heart', objectPosition: 'center 42%' },
    blocks: [
      D.eyebrow('Last note'),
      D.displayHeading(`Three breaths and a ${D.accent('tone')}`),
      D.para(greeting(ctx.name)),
      D.para(
        'This is the last of these — then quiet. The most important thing I can leave you with costs nothing:',
      ),
      D.para(
        `In the morning, ask: ${D.lyric(
          'how am I feeling, in this moment?',
        )} — and make the sound of that. Thirty honest seconds. Half this practice happens in parked cars and kitchens.`,
      ),
      D.pullQuote('The kitchen is a fine temple.'),
      D.para(
        'And if you’d like company doing it, come sound with us live again — the calendar of upcoming workshops and masterclasses is here:',
      ),
      D.pillButton('See upcoming live dates', ctx.calendarUrl),
      recap,
      D.signoff(),
    ].join(''),
    footer: {
      unsubscribeUrl: ctx.unsubscribeUrl,
      tagline: 'The sound was always yours.',
    },
  });
  const recapText = ctx.offers.length
    ? `\n\nAnd whenever you'd like more:\n${ctx.offers.map((o) => offerTextLine(ctx.base, o)).join('\n')}`
    : '';
  return {
    subject: 'Three breaths and a tone',
    html,
    text: `${textGreeting(ctx.name)}\n\nThis is the last of these — then quiet. The most important thing I can leave you with costs nothing:\n\nIn the morning, ask: how am I feeling, in this moment? — and make the sound of that. Thirty honest seconds. Half this practice happens in parked cars and kitchens.\n\nAnd if you'd like company doing it, come sound with us live again — the calendar of upcoming workshops and masterclasses: ${ctx.calendarUrl}${recapText}\n\nThe sound was always yours.\n\nWith love,\nJacob${unsubText(ctx.unsubscribeUrl)}`,
  };
}
