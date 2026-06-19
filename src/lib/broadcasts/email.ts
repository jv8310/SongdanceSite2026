// Render a broadcast into a Resend-ready { subject, html, text }.
//
// Two formats:
//   • 'simple' — the author's copy is paragraphs (light inline HTML allowed),
//     wrapped in the shared parchment shell so it matches the lifecycle mail.
//   • 'html'   — `body` IS the full email HTML, used as-is, so a designed
//     template can be pasted straight in. `{{unsubscribe_url}}` is substituted
//     (and if it's missing an unsubscribe footer is appended for compliance).
//
// `{{first_name}}` is substituted in both. We also understand Drip/Liquid-style
// merge tags (e.g. `{{ subscriber.first_name | default: "there" }}`), honouring
// the `default:` value, so a pasted Drip template just works. Copy rules
// (docs/svh-copy-book.md) still apply to the words; this module only frames and
// personalises them.

import { shell, MAILING_ADDRESS, type EmailContent } from '../workshops/emails';
import type { Broadcast } from './db';

// Any {{ field | filters }} merge tag. The field allows a `subscriber.` prefix
// and dots; filters (`| default: "x" | upcase` …) are captured so we can read a
// default and so the whole tag is consumed (never left half-replaced).
const MERGE_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*((?:\|[^}]*)?)\}\}/g;

function defaultOf(filters: string): string {
  const m = filters.match(/default\s*:\s*(['"])([\s\S]*?)\1/i);
  return m ? m[2] : '';
}

// Substitute merge tags for one recipient. Recognises first name (ours +
// Drip's), and the unsubscribe URL. Any OTHER merge tag resolves to its
// `default:` value, or is dropped — so an unrecognised `{{ subscriber.x }}` is
// never sent to a reader literally (custom fields aren't loaded at send time).
export function personalize(
  s: string,
  opts: { firstName?: string; unsubscribeUrl?: string } = {},
): string {
  const fn = (opts.firstName || '').trim();
  return s.replace(MERGE_RE, (_m, rawPath: string, filters: string) => {
    const key = rawPath.toLowerCase().replace(/^subscriber\./, '');
    const def = defaultOf(filters || '');
    if (['first_name', 'firstname', 'first', 'fname', 'name', 'full_name', 'fullname'].includes(key)) {
      return fn || def || 'friend';
    }
    if (['unsubscribe_url', 'unsubscribeurl', 'unsub_url'].includes(key)) {
      return opts.unsubscribeUrl || def || '';
    }
    return def || '';
  });
}

// Back-compat alias (first name only).
export function applyTokens(s: string, firstName: string): string {
  return personalize(s, { firstName });
}

function hasUnsubToken(s: string): boolean {
  return /\{\{\s*(?:subscriber\.)?unsub(?:scribe)?[_\s]?url\b[^}]*\}\}/i.test(s);
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
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// A minimal unsubscribe footer for pasted-HTML emails that don't carry their
// own {{unsubscribe_url}}. Inserted before </body> when present.
function appendUnsubFooter(html: string, url: string): string {
  const footer = `<div style="font-family:Georgia,serif;font-size:11px;line-height:1.6;color:#9b8fa0;text-align:center;padding:18px 12px;">Songdance · songdance.co<br /><a href="${url}" style="color:#9b8fa0;text-decoration:underline;">No more emails like this — unsubscribe</a></div>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${footer}</body>`);
  return html + footer;
}

// Ensure the legal postal address is present in a pasted-HTML email (it isn't in
// the shell-rendered ones — those get it via the shell footer). Idempotent: skips
// if the address is already in the markup. Inserted before </body> when present.
function ensureAddress(html: string): string {
  if (html.includes(MAILING_ADDRESS)) return html;
  const line = `<div style="font-family:Georgia,serif;font-size:11px;line-height:1.6;color:#9b8fa0;text-align:center;padding:0 12px 18px;">${MAILING_ADDRESS}</div>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${line}</body>`);
  return html + line;
}

// Render a broadcast for one recipient. `unsubscribeUrl` is the human-facing
// footer link (the one-click RFC 8058 header is set separately on the send).
export function renderBroadcast(
  b: Broadcast,
  opts: { firstName?: string; unsubscribeUrl?: string } = {},
): EmailContent {
  const fn = opts.firstName ?? '';
  const unsub = opts.unsubscribeUrl ?? '';
  const subject = personalize(b.subject, { firstName: fn });

  if (b.format === 'html') {
    const hadUnsub = hasUnsubToken(b.body);
    let html = personalize(b.body, { firstName: fn, unsubscribeUrl: unsub });
    // Append a footer only if the author didn't place their own unsubscribe tag.
    if (unsub && !hadUnsub) html = appendUnsubFooter(html, unsub);
    // Always ensure the legal postal address is present.
    html = ensureAddress(html);
    const text = b.body_text
      ? personalize(b.body_text, { firstName: fn, unsubscribeUrl: unsub })
      : `${stripToText(html)}\n\n${MAILING_ADDRESS}${unsub && !hadUnsub ? `\nUnsubscribe: ${unsub}` : ''}`;
    return { subject, html, text };
  }

  // simple
  const heading = personalize(b.heading, { firstName: fn });
  const bodyTokened = personalize(b.body, { firstName: fn, unsubscribeUrl: unsub });
  const cta = b.cta_label && b.cta_href ? { label: b.cta_label, href: b.cta_href } : undefined;

  const html = shell({
    preheader: personalize(b.preheader || b.subject, { firstName: fn }),
    heading,
    bodyHtml: bodyToHtml(bodyTokened),
    heroImage: b.hero_image ? { src: b.hero_image, alt: heading } : undefined,
    cta,
    footerNote: 'Songdance · songdance.co',
    address: MAILING_ADDRESS,
    unsubscribeUrl: opts.unsubscribeUrl,
  });

  let text: string;
  if (b.body_text) {
    text = personalize(b.body_text, { firstName: fn, unsubscribeUrl: unsub });
  } else {
    const lines = [heading, '', stripToText(bodyToHtml(bodyTokened))];
    if (cta) lines.push('', `${cta.label}: ${cta.href}`);
    lines.push('', 'Songdance · songdance.co', MAILING_ADDRESS);
    if (unsub) lines.push(`Unsubscribe: ${unsub}`);
    text = lines.join('\n');
  }
  return { subject, html, text };
}

// A sample render for the admin preview / iframe — placeholder first name and a
// dummy unsubscribe link so the footer shows.
export function previewBroadcast(b: Broadcast, base = 'https://songdance.co'): EmailContent {
  return renderBroadcast(b, {
    firstName: 'Maria',
    unsubscribeUrl: `${base.replace(/\/$/, '')}/unsubscribe?e=sample%40example.com&t=preview`,
  });
}
