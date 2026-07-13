// Produce a Drip-ready HTML version of a broadcast, to paste straight into
// Drip's HTML editor. Our site renderer fills the unsubscribe link + postal
// address itself at send time (see ./email.ts), but Drip needs its OWN footer
// merge tags, so here we:
//   • swap utm_source=broadcast → utm_source=drip
//   • upgrade our launch-design footer's single unsubscribe line to Drip's
//     two-tier launch unsubscribe (stop just the launch emails / everything)
//   • turn the literal postal address into Drip's {{ html_postal_address }} tag
//   • guarantee an unsubscribe link + a postal-address tag even for arbitrary
//     pasted HTML (Drip / CAN-SPAM requirement)
//
// {{ subscriber.first_name | default: "there" }} and {{ unsubscribe_url }} are
// already understood by Drip, so those pass straight through untouched.

import { shell, MAILING_ADDRESS } from '../workshops/emails';
import { bodyToHtml } from './email';
import type { Broadcast } from './db';

function hasUnsubToken(s: string): boolean {
  return /\{\{\s*(?:subscriber\.)?unsub(?:scribe)?[_\s]?url\b[^}]*\}\}/i.test(s);
}

// Transform a full HTML email body (broadcast-flavoured) into a Drip-flavoured one.
export function broadcastToDrip(html: string): string {
  let out = html.split('utm_source=broadcast').join('utm_source=drip');

  // Upgrade the launch-design footer's single unsubscribe paragraph
  //   "Not for you? Unsubscribe — you won't hear from this list again."
  // to Drip's two-tier launch unsubscribe, reusing that paragraph's own styles.
  out = out.replace(
    /<p style="([^"]*)">Not for you\?\s*<a href="\{\{\s*unsubscribe_url\s*\}\}" style="([^"]*)">Unsubscribe<\/a>[^<]*<\/p>/,
    (_m, pStyle: string, aStyle: string) =>
      `<p style="${pStyle}">A quiet list &mdash; about one email a month, a little more during a launch.</p>\n` +
      `  <p style="${pStyle}">Want only the launch emails to stop? ` +
      `<a href="https://songdance.co/unsubscribe-promo?e={{ subscriber.email | url_encode }}" style="${aStyle}">Stop these</a> ` +
      `&mdash; you&rsquo;ll stay on the regular monthly list. ` +
      `Or <a href="{{ unsubscribe_url }}" style="${aStyle}">unsubscribe from everything</a>.</p>`,
  );

  // Literal postal address → Drip's {{ html_postal_address }} tag.
  out = out.split(`Songdance BV &middot; ${MAILING_ADDRESS}`).join('{{ html_postal_address }}');
  out = out.split(`Songdance BV · ${MAILING_ADDRESS}`).join('{{ html_postal_address }}');
  out = out.split(MAILING_ADDRESS).join('{{ html_postal_address }}');

  // Drip requires an unsubscribe link and a postal address. Guarantee both,
  // even for arbitrary pasted HTML that carries neither.
  if (!hasUnsubToken(out)) {
    const foot =
      '<p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#7A6A78;text-align:center;padding:8px 12px;">' +
      'Don&rsquo;t want these? <a href="{{ unsubscribe_url }}" style="color:#7A6A78;text-decoration:underline;">Unsubscribe</a>.</p>';
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${foot}</body>`) : out + foot;
  }
  if (!out.includes('{{ html_postal_address }}')) {
    const addr =
      '<p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#9A8A78;text-align:center;padding:0 12px 8px;">' +
      '{{ html_postal_address }}</p>';
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${addr}</body>`) : out + addr;
  }
  return out;
}

// Drip HTML for a whole broadcast, handling both formats.
export function dripHtmlForBroadcast(b: Broadcast): string {
  if (b.format === 'html') return broadcastToDrip(b.body);
  // 'simple' → render our shared shell with the merge tags left intact
  // (bodyToHtml / heading are not personalised), then convert.
  const tagged = shell({
    preheader: b.preheader || b.subject,
    heading: b.heading,
    bodyHtml: bodyToHtml(b.body),
    heroImage: b.hero_image ? { src: b.hero_image, alt: b.heading } : undefined,
    cta: b.cta_label && b.cta_href ? { label: b.cta_label, href: b.cta_href } : undefined,
    footerNote: 'Songdance · songdance.co',
    address: MAILING_ADDRESS,
    unsubscribeUrl: '{{ unsubscribe_url }}',
  });
  return broadcastToDrip(tagged);
}
