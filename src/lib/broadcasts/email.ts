// Render a broadcast into a Resend-ready { subject, html, text }.
//
// Two formats:
//   • 'simple' — the author's copy is paragraphs (light inline HTML allowed),
//     wrapped in the shared parchment shell so it matches the lifecycle mail.
//   • 'html'   — `body` IS the full email HTML, used as-is, so a designed
//     template can be pasted straight in. `{{unsubscribe_url}}` is substituted
//     (and if it's missing an unsubscribe footer is appended for compliance).
//
// `{{first_name}}` is substituted in both. Copy rules (docs/svh-copy-book.md)
// still apply to the words; this module only frames and personalises them.

import { shell, type EmailContent } from '../workshops/emails';
import type { Broadcast } from './db';

// `{{first_name}}` reads "friend" when no name is on file so a greeting never
// goes out blank.
export function applyTokens(s: string, firstName: string): string {
  const fn = (firstName || '').trim() || 'friend';
  return s.replace(/\{\{\s*first[_\s]?name\s*\}\}/gi, fn);
}

function applyUnsubToken(s: string, url: string): string {
  return s.replace(/\{\{\s*unsubscribe[_\s]?url\s*\}\}/gi, url);
}

function hasUnsubToken(s: string): boolean {
  return /\{\{\s*unsubscribe[_\s]?url\s*\}\}/i.test(s);
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

// Render a broadcast for one recipient. `unsubscribeUrl` is the human-facing
// footer link (the one-click RFC 8058 header is set separately on the send).
export function renderBroadcast(
  b: Broadcast,
  opts: { firstName?: string; unsubscribeUrl?: string } = {},
): EmailContent {
  const fn = opts.firstName ?? '';
  const unsub = opts.unsubscribeUrl ?? '';
  const subject = applyTokens(b.subject, fn);

  if (b.format === 'html') {
    let html = applyTokens(b.body, fn);
    if (unsub) {
      html = hasUnsubToken(html) ? applyUnsubToken(html, unsub) : appendUnsubFooter(html, unsub);
    }
    const text = b.body_text
      ? applyTokens(b.body_text, fn)
      : `${stripToText(html)}${unsub ? `\n\nUnsubscribe: ${unsub}` : ''}`;
    return { subject, html, text };
  }

  // simple
  const heading = applyTokens(b.heading, fn);
  const bodyTokened = applyTokens(b.body, fn);
  const cta = b.cta_label && b.cta_href ? { label: b.cta_label, href: b.cta_href } : undefined;

  const html = shell({
    preheader: applyTokens(b.preheader || b.subject, fn),
    heading,
    bodyHtml: bodyToHtml(bodyTokened),
    heroImage: b.hero_image ? { src: b.hero_image, alt: heading } : undefined,
    cta,
    footerNote: 'Songdance · songdance.co',
    unsubscribeUrl: opts.unsubscribeUrl,
  });

  let text: string;
  if (b.body_text) {
    text = applyTokens(b.body_text, fn);
  } else {
    const lines = [heading, '', stripToText(bodyToHtml(bodyTokened))];
    if (cta) lines.push('', `${cta.label}: ${cta.href}`);
    lines.push('', 'Songdance · songdance.co');
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
