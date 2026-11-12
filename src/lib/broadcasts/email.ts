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
// the `default:` value, so a pasted Drip template just works.
//
// Links carry the reader (November 2026): a merge tag inside a link — the
// button's link (ctaHref), or any href="…" in the body — is url-encoded by
// itself, and `{{prefill}}` is the whole set a checkout form reads:
// `email=…&first_name=…&last_name=…` (the parts we know, encoded). So
// `/courses/forgiveness?{{prefill}}#register` opens the form filled in. The
// recipient's name is the contact's full name, split on the first space. Copy rules
// (docs/svh-copy-book.md) still apply to the words; this module only frames and
// personalises them.

import { shell, MAILING_ADDRESS, type EmailContent } from '../workshops/emails';
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
export type PersonalizeOpts = {
  firstName?: string;
  // The contact's full name ("Maria van Dam"). Gives the last name, and the
  // first name when `firstName` isn't passed.
  name?: string;
  unsubscribeUrl?: string;
  email?: string;
};

// First and last name from what we hold: the full name split on its first
// space ("Maria van Dam" → Maria / van Dam), tidied for display.
export function readerNames(opts: PersonalizeOpts): { first: string; last: string } {
  const full = (opts.name || '').trim().replace(/\s+/g, ' ');
  const at = full.indexOf(' ');
  const first = (opts.firstName || '').trim() || (at > 0 ? full.slice(0, at) : full);
  const last = at > 0 ? full.slice(at + 1) : '';
  return { first: tidyName(first), last: tidyName(last) };
}

// `email=…&first_name=…&last_name=…` — the parts we know, each encoded.
export function prefillQuery(opts: PersonalizeOpts): string {
  const { first, last } = readerNames(opts);
  const parts: string[] = [];
  const email = (opts.email || '').trim();
  if (email) parts.push(`email=${encodeURIComponent(email)}`);
  if (first) parts.push(`first_name=${encodeURIComponent(first)}`);
  if (last) parts.push(`last_name=${encodeURIComponent(last)}`);
  return parts.join('&');
}

const FIRST_KEYS = ['first_name', 'firstname', 'first', 'fname', 'name'];
const LAST_KEYS = ['last_name', 'lastname', 'last', 'lname', 'surname'];
const FULL_KEYS = ['full_name', 'fullname'];
const EMAIL_KEYS = ['email', 'email_address', 'emailaddress'];
const UNSUB_KEYS = ['unsubscribe_url', 'unsubscribeurl', 'unsub_url'];

// `inUrl`: the text is (part of) a link, so the reader's own details are
// url-encoded even without a `| url_encode` filter — an email with a '+', or a
// name with a space or an accent, would otherwise break the link. The
// unsubscribe URL is a whole address and never encoded there.
export function personalize(s: string, opts: PersonalizeOpts = {}, inUrl = false): string {
  const { first, last } = readerNames(opts);
  const email = (opts.email || '').trim();
  return s.replace(MERGE_RE, (_m, rawPath: string, filters: string) => {
    const key = rawPath.toLowerCase().replace(/^subscriber\./, '');
    const def = defaultOf(filters || '');
    const encodeFilter = /\|\s*url_encode\b/i.test(filters || '');
    if (key === 'prefill') return prefillQuery(opts);
    let val: string;
    let identity = true;
    if (FIRST_KEYS.includes(key)) {
      // In a link an unknown name stays empty: the form leaves the field blank
      // rather than filling in "friend".
      val = first || def || (inUrl ? '' : 'friend');
    } else if (LAST_KEYS.includes(key)) {
      val = last || def || '';
    } else if (FULL_KEYS.includes(key)) {
      val = [first, last].filter(Boolean).join(' ') || def || (inUrl ? '' : 'friend');
    } else if (UNSUB_KEYS.includes(key)) {
      val = opts.unsubscribeUrl || def || '';
      identity = false;
    } else if (EMAIL_KEYS.includes(key)) {
      val = email || def || '';
    } else {
      val = def || '';
    }
    // Honour a Liquid `| url_encode` filter — without it, an email with a '+'
    // (or the unsubscribe URL's own query string) breaks the link it sits in.
    if (encodeFilter || (inUrl && identity)) val = encodeURIComponent(val);
    return val;
  });
}

// Personalize HTML: merge tags inside an href="…" are treated as part of a
// link (above), everything else as text.
export function personalizeHtml(html: string, opts: PersonalizeOpts = {}): string {
  const HREF_RE = /(\bhref\s*=\s*)(["'])([\s\S]*?)\2/gi;
  let out = '';
  let last = 0;
  for (const m of html.matchAll(HREF_RE)) {
    const at = m.index ?? 0;
    out += personalize(html.slice(last, at), opts);
    out += `${m[1]}${m[2]}${personalize(m[3], opts, true)}${m[2]}`;
    last = at + m[0].length;
  }
  return out + personalize(html.slice(last), opts);
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
// footer link (the one-click RFC 8058 header is set separately on the send).
export function renderBroadcast(b: Broadcast, opts: PersonalizeOpts = {}): EmailContent {
  const unsub = opts.unsubscribeUrl ?? '';
  const who: PersonalizeOpts = { firstName: opts.firstName, name: opts.name, email: opts.email };
  const all: PersonalizeOpts = { ...who, unsubscribeUrl: unsub };
  const subject = personalize(b.subject, who);

  if (b.format === 'html') {
    const hadUnsub = hasUnsubToken(b.body);
    let html = personalizeHtml(b.body, all);
    // Append a footer only if the author didn't place their own unsubscribe tag.
    if (unsub && !hadUnsub) html = appendUnsubFooter(html, unsub);
    // Ensure the legal postal address is present (unless the author's footer
    // already has it). The text part is derived from the final html, so it
    // inherits the address without double-listing it.
    html = ensureAddress(html);
    const text = b.body_text
      ? personalize(b.body_text, all)
      : `${stripToText(html)}${unsub && !hadUnsub ? `\n\nUnsubscribe: ${unsub}` : ''}`;
    return { subject, html, text };
  }

  // simple
  const heading = personalize(b.heading, who);
  const bodyTokened = personalizeHtml(b.body, all);
  const cta =
    b.cta_label && b.cta_href
      ? { label: personalize(b.cta_label, who), href: personalize(b.cta_href, all, true) }
      : undefined;

  const html = shell({
    preheader: personalize(b.preheader || b.subject, who),
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
    text = personalize(b.body_text, all);
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
    name: 'Maria Peeters',
    email: 'maria@example.com',
    unsubscribeUrl: `${base.replace(/\/$/, '')}/unsubscribe?e=sample%40example.com&t=preview`,
  });
}
