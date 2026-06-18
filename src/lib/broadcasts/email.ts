// Render a broadcast into a Resend-ready { subject, html, text }, reusing the
// shared parchment shell so a blast looks identical to the lifecycle mail.
//
// Copy rules still apply: the words a broadcast carries are authored in the
// admin and must obey docs/svh-copy-book.md (the sound OF, acknowledgment,
// sounding-not-singing, hold space; no outcome promises, no manufactured
// scarcity). This module only frames and personalises that copy.

import { shell, type EmailContent } from '../workshops/emails';
import type { Broadcast } from './db';

// `{{first_name}}` is the one supported token. With no name on file it reads
// "friend" so a greeting never goes out blank.
export function applyTokens(s: string, firstName: string): string {
  const fn = (firstName || '').trim() || 'friend';
  return s.replace(/\{\{\s*first[_\s]?name\s*\}\}/gi, fn);
}

// Turn the author's copy into shell-ready HTML. A blank line starts a new
// paragraph; a single newline is a soft break. The copy is admin-authored and
// trusted, so inline HTML (links, <em>, <strong>) is passed through untouched —
// only the paragraph/line structure is added.
export function bodyToHtml(body: string): string {
  const blocks = body.replace(/\r\n/g, '\n').trim().split(/\n{2,}/);
  return blocks
    .map((block) => {
      const inner = block.trim().split('\n').join('<br />');
      return `<p style="margin:0 0 16px;">${inner}</p>`;
    })
    .join('\n');
}

// Plain-text fallback: strip any inline tags from the (token-applied) copy and
// append the CTA + unsubscribe line.
function toText(opts: {
  heading: string;
  body: string;
  cta?: { label: string; href: string };
  unsubscribeUrl?: string;
}): string {
  const bodyText = opts.body
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>(\n)?/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
  const lines = [opts.heading, '', bodyText];
  if (opts.cta) lines.push('', `${opts.cta.label}: ${opts.cta.href}`);
  lines.push('', 'Songdance · songdance.co');
  if (opts.unsubscribeUrl) lines.push(`Unsubscribe: ${opts.unsubscribeUrl}`);
  return lines.join('\n');
}

// Render a broadcast for one recipient. `unsubscribeUrl` is the human-facing
// footer link (the one-click RFC 8058 header is set separately on the send).
export function renderBroadcast(
  b: Broadcast,
  opts: { firstName?: string; unsubscribeUrl?: string } = {},
): EmailContent {
  const fn = opts.firstName ?? '';
  const subject = applyTokens(b.subject, fn);
  const heading = applyTokens(b.heading, fn);
  const bodyTokened = applyTokens(b.body, fn);
  const cta =
    b.cta_label && b.cta_href ? { label: b.cta_label, href: b.cta_href } : undefined;

  const html = shell({
    preheader: applyTokens(b.preheader || b.subject, fn),
    heading,
    bodyHtml: bodyToHtml(bodyTokened),
    heroImage: b.hero_image ? { src: b.hero_image, alt: heading } : undefined,
    cta,
    footerNote: 'Songdance · songdance.co',
    unsubscribeUrl: opts.unsubscribeUrl,
  });

  const text = toText({ heading, body: bodyTokened, cta, unsubscribeUrl: opts.unsubscribeUrl });
  return { subject, html, text };
}

// A sample render for the admin preview / iframe — uses a placeholder first
// name and a dummy unsubscribe link so the footer shows.
export function previewBroadcast(b: Broadcast, base = 'https://songdance.co'): EmailContent {
  return renderBroadcast(b, {
    firstName: 'Maria',
    unsubscribeUrl: `${base.replace(/\/$/, '')}/unsubscribe?e=sample%40example.com&t=preview`,
  });
}
