// Render a broadcast into a Resend-ready { subject, html, text }.
//
// Two formats:
//   • 'simple' — the author's copy is paragraphs (light inline HTML allowed),
//     wrapped in the shared parchment shell so it matches the lifecycle mail.
//   • 'html'   — `body` IS the full email HTML, used as-is, so a designed
//     template can be pasted straight in. `{{unsubscribe_url}}` (alias
//     `{{preferences_url}}`) is substituted (and if it's missing an unsubscribe
//     footer is appended for compliance).
//
// The footer link of a broadcast is the reader's choices page
// (/email-preferences, built by the callers with preferencesPageUrl): leave the
// broadcast's topic, pick topics, or unsubscribe from everything. With a topic
// the footer names it ("This came to you as part of …").
//
// `{{first_name}}` is substituted in both. We also understand Drip/Liquid-style
// merge tags (e.g. `{{ subscriber.first_name | default: "there" }}`), honouring
// the `default:` value, so a pasted Drip template just works. Copy rules
// (docs/svh-copy-book.md) still apply to the words; this module only frames and
// personalises them.

import { shell, escapeHtml, MAILING_ADDRESS, type EmailContent } from '../workshops/emails';
import type { Broadcast } from './db';
import { tidyName } from '../email/names';

// Any {{ field | filters }} merge tag. The field allows a `subscriber.` prefix
// and dots; filters (`| default: "x" | upcase` …) are captured so we can read a
// default and so the whole tag is consumed (never left half-replaced).
const MERGE_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*((?:\|[^}]*)?)\}\}/g;

function defaultOf(filters: string): string {
  const m = filters.match(/default\s*:\s*(['"])([\s\S]*?)\1/i);
  return m ? m[2] : '';
}

// Substitute merge tags for one recipient. Recognises first name (ours +
// Drip's), the recipient email, and the unsubscribe URL. A `| url_encode` filter
// is honoured (e.g. an email dropped into a query string, like the promo-only
// unsubscribe link). Any OTHER merge tag resolves to its `default:` value, or is
// dropped — so an unrecognised `{{ subscriber.x }}` is never sent to a reader
// literally (custom fields aren't loaded at send time).
//
// `html: true` when the result is raw email HTML (an html-format body, or the
// simple-format body before bodyToHtml): the recipient's name and address are
// then HTML-escaped. Both come from outside — the public newsletter form lets
// anyone type a name for any address — so unescaped they could plant a link in
// mail sent from our own domain. The subject, the text parts and the shell's
// heading/preheader (which escapes on its own) take the raw value.
export function personalize(
  s: string,
  opts: { firstName?: string; unsubscribeUrl?: string; email?: string; html?: boolean } = {},
): string {
  const fn = tidyName(opts.firstName);
  const email = (opts.email || '').trim();
  return s.replace(MERGE_RE, (_m, rawPath: string, filters: string) => {
    const key = rawPath.toLowerCase().replace(/^subscriber\./, '');
    const def = defaultOf(filters || '');
    let val: string;
    let fromRecipient = false; // the name or address of the person we send to
    if (['first_name', 'firstname', 'first', 'fname', 'name', 'full_name', 'fullname'].includes(key)) {
      fromRecipient = !!fn;
      val = fn || def || 'friend';
    } else if (['unsubscribe_url', 'unsubscribeurl', 'unsub_url', 'preferences_url', 'preferencesurl'].includes(key)) {
      val = opts.unsubscribeUrl || def || '';
    } else if (['email', 'email_address', 'emailaddress'].includes(key)) {
      fromRecipient = !!email;
      val = email || def || '';
    } else {
      val = def || '';
    }
    // Honour a Liquid `| url_encode` filter — without it, an email with a '+'
    // (or the unsubscribe URL's own query string) breaks the link it sits in.
    if (/\|\s*url_encode\b/i.test(filters || '')) return encodeURIComponent(val);
    return opts.html && fromRecipient ? escapeHtml(val) : val;
  });
}

// Back-compat alias (first name only).
export function applyTokens(s: string, firstName: string): string {
  return personalize(s, { firstName });
}

function hasUnsubToken(s: string): boolean {
  return /\{\{\s*(?:subscriber\.)?(?:unsub(?:scribe)?|preferences)[_\s]?url\b[^}]*\}\}/i.test(s);
}

// The footer's words, fixed: with a topic the reader is told which one it came
// under; without, the link offers both ways.
export function broadcastFooterWords(topicName?: string | null): { label: string; note?: string } {
  const name = (topicName ?? '').trim();
  return name
    ? { label: 'Change what you get or unsubscribe', note: `This came to you as part of “${name}”.` }
    : { label: 'Unsubscribe or choose what you get' };
}

// Turn the author's copy into shell-ready HTML (simple format). A blank line
// starts a new paragraph; a single newline is a soft break. The copy is
// admin-authored and trusted, so inline HTML passes through untouched.
export function bodyToHtml(body: string): string {
  const blocks = body.replace(/\r\n/g, '\n').trim().split(/\n{2,}/);
  return blocks
    .map((block) => `<p style="margin:0 0 16px;">${block.trim().split('\n').join('<br />')}</p>`)
    .join('\n');
}

function stripToText(html: string): string {
  return html
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>(\n)?/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// A minimal unsubscribe footer for pasted-HTML emails that don't carry their
// own {{unsubscribe_url}}. Inserted before </body> when present.
function appendUnsubFooter(
  html: string,
  url: string,
  label = 'No more emails like this — unsubscribe',
  note?: string,
): string {
  const lead = note ? `${escapeHtml(note)} ` : '';
  const footer = `<div style="font-family:Georgia,serif;font-size:11px;line-height:1.6;color:#9b8fa0;text-align:center;padding:18px 12px;">Songdance · songdance.co<br />${lead}<a href="${url}" style="color:#9b8fa0;text-decoration:underline;">${escapeHtml(label)}</a></div>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${footer}</body>`);
  return html + footer;
}

// Ensure the legal postal address is present in a pasted-HTML email (it isn't in
// the shell-rendered ones — those get it via the shell footer). Idempotent: if
// the author's own footer already carries the street, we leave it alone (so the
// address never ends up in two places). Inserted before </body> when present.
function ensureAddress(html: string): string {
  if (/beaupr[ée]straat/i.test(html)) return html;
  const line = `<div style="font-family:Georgia,serif;font-size:11px;line-height:1.6;color:#9b8fa0;text-align:center;padding:0 12px 18px;">Songdance BV · ${MAILING_ADDRESS}</div>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${line}</body>`);
  return html + line;
}

// Render a broadcast for one recipient. `unsubscribeUrl` is the human-facing
// footer link — for a broadcast, the reader's choices page (preferencesPageUrl);
// the one-click RFC 8058 header is set separately on the send. `topicName` is
// the broadcast's topic, looked up by the caller (getTopic), since this is
// synchronous.
export function renderBroadcast(
  b: Broadcast,
  opts: { firstName?: string; unsubscribeUrl?: string; email?: string; topicName?: string | null } = {},
): EmailContent {
  const fn = opts.firstName ?? '';
  const unsub = opts.unsubscribeUrl ?? '';
  const em = opts.email ?? '';
  const subject = personalize(b.subject, { firstName: fn, email: em });
  const words = broadcastFooterWords(opts.topicName);
  const textUnsub = `${words.note ? `${words.note} ` : ''}Change what you get or unsubscribe: ${unsub}`;

  if (b.format === 'html') {
    const hadUnsub = hasUnsubToken(b.body);
    let html = personalize(b.body, { firstName: fn, unsubscribeUrl: unsub, email: em, html: true });
    // Append a footer only if the author didn't place their own unsubscribe tag.
    if (unsub && !hadUnsub) html = appendUnsubFooter(html, unsub, words.label, words.note);
    // Ensure the legal postal address is present (unless the author's footer
    // already has it). The text part is derived from the final html, so it
    // inherits the address without double-listing it.
    html = ensureAddress(html);
    const text = b.body_text
      ? personalize(b.body_text, { firstName: fn, unsubscribeUrl: unsub, email: em })
      : `${stripToText(html)}${unsub && !hadUnsub ? `\n\n${textUnsub}` : ''}`;
    return { subject, html, text };
  }

  // simple
  const heading = personalize(b.heading, { firstName: fn, email: em });
  const bodyTokened = personalize(b.body, { firstName: fn, unsubscribeUrl: unsub, email: em, html: true });
  const bodyText = personalize(b.body, { firstName: fn, unsubscribeUrl: unsub, email: em });
  const cta = b.cta_label && b.cta_href ? { label: b.cta_label, href: b.cta_href } : undefined;

  const html = shell({
    preheader: personalize(b.preheader || b.subject, { firstName: fn, email: em }),
    heading,
    bodyHtml: bodyToHtml(bodyTokened),
    heroImage: b.hero_image ? { src: b.hero_image, alt: heading } : undefined,
    cta,
    footerNote: 'Songdance · songdance.co',
    address: MAILING_ADDRESS,
    unsubscribeUrl: opts.unsubscribeUrl,
    unsubscribeLabel: words.label,
    unsubscribeNote: words.note,
  });

  let text: string;
  if (b.body_text) {
    text = personalize(b.body_text, { firstName: fn, unsubscribeUrl: unsub, email: em });
  } else {
    const lines = [heading, '', stripToText(bodyToHtml(bodyText))];
    if (cta) lines.push('', `${cta.label}: ${cta.href}`);
    lines.push('', 'Songdance · songdance.co', MAILING_ADDRESS);
    if (unsub) lines.push(textUnsub);
    text = lines.join('\n');
  }
  return { subject, html, text };
}

// The dummy choices-page link the admin previews carry, so the footer shows.
export function samplePreferencesUrl(base = 'https://songdance.co', topic?: string | null): string {
  const tp = topic ? `&topic=${encodeURIComponent(topic)}` : '';
  return `${base.replace(/\/$/, '')}/email-preferences?e=sample%40example.com&t=preview${tp}`;
}

// A sample render for the admin preview / iframe — placeholder first name and a
// dummy choices-page link so the footer shows. Pass the topic's name (getTopic)
// for the footer to name it.
export function previewBroadcast(
  b: Broadcast,
  base = 'https://songdance.co',
  topicName?: string | null,
): EmailContent {
  return renderBroadcast(b, {
    firstName: 'Maria',
    email: 'maria@example.com',
    unsubscribeUrl: samplePreferencesUrl(base, b.topic),
    topicName,
  });
}
