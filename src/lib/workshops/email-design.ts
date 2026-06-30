// Richer marketing-email design primitives — the "broadcast-quality" toolkit.
//
// The transactional/lifecycle `shell()` in emails.ts is a clean Georgia frame.
// This module is its dressier sibling: the design language of the hand-built
// broadcasts (docs/emails/asj-origin-story.*) — a 600px parchment card, the
// Spectral / Cormorant Garamond / Figtree type system with web-safe fallbacks,
// an edge-to-edge hero, eyebrow labels, Cormorant pull-quotes, bordered offer
// boxes, product cards, and a proper footer. The redesigned post-workshop
// "attended" and "downsell" emails render through this.
//
// TYPOGRAPHY LAW (docs CLAUDE.md): Cormorant Garamond optically reads smaller
// than the body/display fonts, so every inline Cormorant italic MUST be sized
// up — ~1.05em inside a Spectral heading, ~1.2–1.35em inside Figtree body. The
// `accent()` and `lyric()` helpers below bake that in; use them rather than raw
// <em> so the law can't be forgotten.
//
// COPY-BOOK LAW (docs/svh-copy-book.md) governs the WORDS, not this file — but
// keep it in mind in every string passed in.

import { escapeHtml } from './emails';

// Palette — the parchment / plum-ink / ember system, extended with the broadcast
// tones (a warmer outer wash, the brighter ember accent, the muted caption grey,
// the faint border, and the dark plum used for high-contrast offer boxes).
export const DPAL = {
  outer: '#EADFCB', // page wash (a touch warmer than the card)
  card: '#F4ECDF', // the 600px card
  panel: '#FBF6EC', // inner panels / cream offer box
  ink: '#2A1B2A', // primary text (plum-black)
  soft: '#4A3848', // secondary text
  muted: '#7A6A78', // captions / fine print
  ember: '#A14826', // accent (terracotta)
  emberBright: '#C9603A', // brighter accent for heading words / quote rules
  line: '#DCCBB4', // hairline borders
  dark: '#4A2540', // dark plum — strong offer boxes
  onDark: '#F4ECDF', // text on the dark box
  onDarkSoft: '#E7D8C4',
};

const FONT_DISPLAY = "'Spectral', Georgia, 'Times New Roman', serif";
const FONT_BODY =
  "'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const FONT_LYRIC = "'Cormorant Garamond', Georgia, serif";

const LOGO_URL = 'https://songdance.co/brand/logo-wordmark-dark.png';
const MAILING_ADDRESS = 'Beaupréstraat 13, 8310 Bruges, Belgium';
const COMPANY_LINE = 'Songdance BV · Beaupréstraat 13, 8310 Bruges, Belgium';

// ── Inline accents (the typography law, enforced) ───────────────────────────

// A Cormorant italic word inside a Spectral display heading (sized to 1.05em).
export function accent(text: string): string {
  return `<em style="font-family:${FONT_LYRIC};font-style:italic;font-size:1.05em;color:${DPAL.emberBright};">${escapeHtml(
    text,
  )}</em>`;
}

// A Cormorant italic phrase inside Figtree body text (sized up to 1.25em).
export function lyric(text: string): string {
  return `<em style="font-family:${FONT_LYRIC};font-style:italic;font-size:1.25em;color:${DPAL.ember};">${escapeHtml(
    text,
  )}</em>`;
}

// ── Content blocks (stacked inside the padded content cell) ──────────────────

// A small uppercase eyebrow with a short leading rule — the broadcast's
// "the story behind the journey" label.
export function eyebrow(text: string): string {
  return `<p style="margin:0 0 22px;font-family:${FONT_BODY};font-size:11px;letter-spacing:2.5px;color:${DPAL.ember};font-weight:600;text-transform:uppercase;"><span style="display:inline-block;width:26px;height:1px;background-color:${DPAL.ember};vertical-align:middle;margin-right:12px;"></span>${escapeHtml(
    text,
  )}</p>`;
}

// The big Spectral headline. `html` may include accent()/lyric() spans.
export function displayHeading(html: string): string {
  return `<h1 class="h1" style="font-family:${FONT_DISPLAY};font-weight:400;font-size:38px;line-height:1.14;color:${DPAL.ink};margin:0 0 26px;">${html}</h1>`;
}

// A body paragraph (Figtree). tone: 'ink' (default) or 'soft'.
export function para(html: string, opts: { tone?: 'ink' | 'soft'; mb?: number } = {}): string {
  const color = opts.tone === 'soft' ? DPAL.soft : DPAL.ink;
  const mb = opts.mb ?? 16;
  return `<p style="font-family:${FONT_BODY};font-size:16px;line-height:1.7;color:${color};margin:0 0 ${mb}px;">${html}</p>`;
}

// A full-width image with optional italic caption and link. (Only the shell's
// hero is truly edge-to-edge; in-body images sit inside the content padding.)
export function bandImage(
  src: string,
  alt: string,
  opts: { caption?: string; href?: string } = {},
): string {
  const img = `<img src="${src}" width="512" alt="${escapeHtml(
    alt,
  )}" style="width:100%;height:auto;border-radius:5px;background-color:${DPAL.ink};" />`;
  const wrapped = opts.href
    ? `<a href="${opts.href}" style="text-decoration:none;display:block;">${img}</a>`
    : img;
  const caption = opts.caption
    ? `<p style="font-family:${FONT_LYRIC};font-style:italic;font-size:16px;line-height:1.5;color:${DPAL.muted};text-align:center;margin:12px 0 0;">${escapeHtml(
        opts.caption,
      )}</p>`
    : '';
  return `<div style="margin:26px 0;">${wrapped}${caption}</div>`;
}

// A left-ruled Cormorant pull-quote.
export function pullQuote(text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0 24px;"><tr>
    <td style="border-left:2px solid ${DPAL.emberBright};padding:2px 0 2px 20px;"><p style="font-family:${FONT_LYRIC};font-style:italic;font-size:23px;line-height:1.4;color:${DPAL.soft};margin:0;">${escapeHtml(
      text,
    )}</p></td>
  </tr></table>`;
}

// A small uppercase section label (ember).
export function sectionLabel(text: string): string {
  return `<p style="margin:26px 0 12px;font-family:${FONT_BODY};font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:${DPAL.ember};font-weight:600;">${escapeHtml(
    text,
  )}</p>`;
}

// An ember-dotted bullet (HTML allowed in the content).
export function bullet(html: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;"><tr>
    <td width="18" valign="top" style="font-family:${FONT_BODY};font-size:16px;line-height:1.6;color:${DPAL.ember};">&#9679;</td>
    <td valign="top" style="font-family:${FONT_BODY};font-size:15.5px;line-height:1.6;color:${DPAL.soft};">${html}</td>
  </tr></table>`;
}

// The ember pill button (with arrow). On the dark offer box pass invert:true.
export function pillButton(
  label: string,
  href: string,
  opts: { invert?: boolean } = {},
): string {
  const bg = opts.invert ? DPAL.onDark : DPAL.ember;
  const fg = opts.invert ? DPAL.dark : DPAL.onDark;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0;"><tr>
    <td style="background-color:${bg};border-radius:32px;"><a href="${href}" style="display:inline-block;font-family:${FONT_BODY};font-size:14px;font-weight:600;letter-spacing:0.3px;color:${fg};padding:15px 32px;text-decoration:none;">${escapeHtml(
      label,
    )} &rarr;</a></td>
  </tr></table>`;
}

// A secondary, low-emphasis text link.
export function secondaryLink(label: string, href: string): string {
  return `<a href="${href}" style="font-family:${FONT_BODY};font-size:14px;color:${DPAL.ember};text-decoration:none;border-bottom:1px solid ${DPAL.line};padding-bottom:1px;">${escapeHtml(
    label,
  )}</a>`;
}

// A thin divider rule.
export function divider(): string {
  return `<div style="height:1px;background-color:${DPAL.line};margin:30px 0;line-height:1px;font-size:1px;">&nbsp;</div>`;
}

// The offer / CTA box. variant 'cream' (default, #FBF6EC + border) or 'plum'
// (dark, high-contrast). `badge` is the little pill (e.g. "20% OFF"); `lines`
// are HTML paragraphs; `button` is the primary CTA.
export function offerBox(opts: {
  variant?: 'cream' | 'plum';
  badge?: string;
  title: string;
  lines: string[];
  button: { label: string; href: string };
  footnote?: string;
}): string {
  const dark = opts.variant === 'plum';
  const bg = dark ? DPAL.dark : DPAL.panel;
  const border = dark ? DPAL.dark : DPAL.line;
  const titleColor = dark ? DPAL.onDark : DPAL.ink;
  const bodyColor = dark ? DPAL.onDarkSoft : DPAL.soft;
  const badge = opts.badge
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr><td style="background-color:${
        dark ? DPAL.ember : DPAL.emberBright
      };border-radius:4px;"><span style="display:inline-block;font-family:${FONT_BODY};font-size:12px;font-weight:700;letter-spacing:1.5px;color:#FFFFFF;padding:6px 12px;text-transform:uppercase;">${escapeHtml(
        opts.badge,
      )}</span></td></tr></table>`
    : '';
  const lines = opts.lines
    .map(
      (l) =>
        `<p style="font-family:${FONT_BODY};font-size:15.5px;line-height:1.65;color:${bodyColor};margin:0 0 14px;">${l}</p>`,
    )
    .join('');
  const footnote = opts.footnote
    ? `<p style="font-family:${FONT_BODY};font-size:12.5px;line-height:1.6;color:${
        dark ? DPAL.onDarkSoft : DPAL.muted
      };margin:16px 0 0;">${opts.footnote}</p>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:34px 0;background-color:${bg};border:1px solid ${border};border-radius:6px;"><tr>
    <td style="padding:32px 34px;">
      ${badge}
      <p style="font-family:${FONT_DISPLAY};font-size:23px;line-height:1.25;color:${titleColor};margin:0 0 16px;">${opts.title}</p>
      ${lines}
      <div style="padding-top:8px;">${pillButton(opts.button.label, opts.button.href, { invert: dark })}</div>
      ${footnote}
    </td>
  </tr></table>`;
}

// The full-width "feature" product card — image on top, then copy + CTA. The
// primary promoted product in a downsell email.
export function featureCard(opts: {
  image: string;
  imageAlt: string;
  eyebrow?: string;
  title: string;
  blurb: string;
  points?: string[];
  priceNote?: string;
  cta: { label: string; href: string };
}): string {
  const pts = opts.points && opts.points.length
    ? `<div style="margin:4px 0 18px;">${opts.points.map((p) => bullet(p)).join('')}</div>`
    : '';
  const price = opts.priceNote
    ? `<p style="font-family:${FONT_BODY};font-size:13px;letter-spacing:0.4px;color:${DPAL.ember};margin:0 0 18px;text-transform:uppercase;font-weight:600;">${escapeHtml(
        opts.priceNote,
      )}</p>`
    : '';
  const eye = opts.eyebrow
    ? `<p style="font-family:${FONT_BODY};font-size:11px;letter-spacing:2px;color:${DPAL.ember};font-weight:600;text-transform:uppercase;margin:0 0 10px;">${escapeHtml(
        opts.eyebrow,
      )}</p>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0;background-color:${DPAL.panel};border:1px solid ${DPAL.line};border-radius:6px;overflow:hidden;"><tr>
    <td style="padding:0;">
      <a href="${opts.cta.href}" style="text-decoration:none;display:block;"><img src="${opts.image}" width="558" alt="${escapeHtml(
        opts.imageAlt,
      )}" style="display:block;width:100%;height:auto;background-color:${DPAL.ink};" /></a>
    </td>
  </tr><tr>
    <td style="padding:26px 30px 30px;">
      ${eye}
      <p style="font-family:${FONT_DISPLAY};font-size:24px;line-height:1.2;color:${DPAL.ink};margin:0 0 12px;">${opts.title}</p>
      <p style="font-family:${FONT_BODY};font-size:15.5px;line-height:1.7;color:${DPAL.soft};margin:0 0 16px;">${opts.blurb}</p>
      ${pts}
      ${price}
      ${pillButton(opts.cta.label, opts.cta.href)}
    </td>
  </tr></table>`;
}

// A slim "also available" card — thumbnail left, one line, arrow. For the
// secondary offers beneath the feature.
export function miniCard(opts: {
  image: string;
  title: string;
  line: string;
  href: string;
}): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;background-color:${DPAL.panel};border:1px solid ${DPAL.line};border-radius:6px;"><tr>
    <td width="92" valign="middle" style="padding:0;">
      <a href="${opts.href}" style="text-decoration:none;display:block;"><img src="${opts.image}" width="92" alt="${escapeHtml(
        opts.title,
      )}" style="display:block;width:92px;height:92px;object-fit:cover;border-radius:6px 0 0 6px;background-color:${DPAL.ink};" /></a>
    </td>
    <td valign="middle" style="padding:12px 16px;">
      <a href="${opts.href}" style="text-decoration:none;">
        <span style="display:block;font-family:${FONT_DISPLAY};font-size:17px;line-height:1.25;color:${DPAL.ink};margin:0 0 3px;">${escapeHtml(
          opts.title,
        )}</span>
        <span style="display:block;font-family:${FONT_BODY};font-size:13.5px;line-height:1.5;color:${DPAL.soft};">${escapeHtml(
          opts.line,
        )}</span>
      </a>
    </td>
    <td width="34" valign="middle" align="center" style="padding:0 14px 0 0;font-family:${FONT_BODY};font-size:18px;color:${DPAL.ember};">&rarr;</td>
  </tr></table>`;
}

// The animated countdown block: the GIF (with a meaningful alt), framed, over a
// plain-text deadline line so it still reads with images off.
export function countdownPanel(opts: {
  gifUrl: string;
  altText: string;
  caption: string;
}): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;background-color:${DPAL.panel};border:1px solid ${DPAL.line};border-radius:6px;"><tr>
    <td align="center" style="padding:26px 20px 18px;">
      <img src="${opts.gifUrl}" width="354" alt="${escapeHtml(
        opts.altText,
      )}" style="display:block;width:354px;max-width:100%;height:auto;margin:0 auto;" />
      <p style="font-family:${FONT_BODY};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${DPAL.ember};font-weight:600;margin:14px 0 0;">${escapeHtml(
        opts.caption,
      )}</p>
    </td>
  </tr></table>`;
}

// The Cormorant sign-off ("With love, Jacob").
export function signoff(text = 'With love,', name = 'Jacob'): string {
  return `<p style="font-family:${FONT_LYRIC};font-style:italic;font-size:18px;line-height:1.5;color:${DPAL.soft};margin:34px 0 0;">${escapeHtml(
    text,
  )}<br />${escapeHtml(name)}</p>`;
}

// ── The shell ────────────────────────────────────────────────────────────────

export type DesignFooter = {
  note?: string; // the small intro line above the legal lines
  tagline?: string; // the Cormorant tagline under the logo
  unsubscribeUrl?: string;
  navLinks?: Array<{ label: string; href: string }>;
};

const DEFAULT_NAV: Array<{ label: string; href: string }> = [
  { label: 'what is svh', href: 'https://songdance.co/what-is-svh' },
  { label: 'courses', href: 'https://songdance.co/courses' },
  { label: 'events', href: 'https://songdance.co/events' },
  { label: 'about', href: 'https://songdance.co/about' },
  { label: 'reviews', href: 'https://songdance.co/reviews' },
];

function footerHtml(footer: DesignFooter): string {
  const nav = (footer.navLinks ?? DEFAULT_NAV)
    .map(
      (l) =>
        `<a href="${l.href}" style="color:${DPAL.ember};text-decoration:none;">${escapeHtml(
          l.label,
        )}</a>`,
    )
    .join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;');
  const note = footer.note
    ? `<p style="font-family:${FONT_BODY};font-size:11px;line-height:1.7;color:${DPAL.muted};margin:0 0 6px;">${escapeHtml(
        footer.note,
      )}</p>`
    : '';
  const unsub = footer.unsubscribeUrl
    ? `<p style="font-family:${FONT_BODY};font-size:11px;line-height:1.7;color:${DPAL.muted};margin:0 0 6px;">Not for you? <a href="${footer.unsubscribeUrl}" style="color:${DPAL.muted};text-decoration:underline;">Unsubscribe</a> &mdash; you won't hear from this list again.</p>`
    : '';
  const tagline = footer.tagline ?? 'The sound was always yours.';
  return `<tr><td style="background-color:${DPAL.outer};padding:32px 44px 34px;" class="pad">
    <img src="${LOGO_URL}" width="130" alt="Songdance" style="width:130px;height:auto;margin:0 0 16px;" />
    <p style="font-family:${FONT_LYRIC};font-style:italic;font-size:16px;line-height:1.5;color:${DPAL.muted};margin:0 0 18px;">${escapeHtml(
      tagline,
    )}</p>
    <p style="font-family:${FONT_BODY};font-size:12px;line-height:1.9;color:${DPAL.ember};margin:0 0 16px;">${nav}</p>
    ${note}
    ${unsub}
    <p style="font-family:${FONT_BODY};font-size:11px;line-height:1.7;color:${DPAL.muted};margin:0;">${escapeHtml(
      COMPANY_LINE,
    )}</p>
  </td></tr>`;
}

// Compose the full HTML document. `blocks` is the pre-built content (a string of
// the helpers above, in order). `heroImage` renders edge-to-edge at the top.
export function designShell(opts: {
  preheader: string;
  title: string;
  // The hero renders as a fixed-height landscape band, not at the image's own
  // aspect — so a tall portrait photo no longer makes a giant header.
  // `objectPosition` aims the crop (e.g. 'center 35%' to keep a face); `height`
  // overrides the default band height (px) when a subject wants more room.
  heroImage?: { src: string; alt: string; href?: string; objectPosition?: string; height?: number };
  blocks: string;
  footer?: DesignFooter;
}): string {
  const { preheader, title, heroImage, blocks, footer } = opts;
  const heroImg = heroImage
    ? `<img src="${heroImage.src}" width="600" alt="${escapeHtml(
        heroImage.alt,
      )}" class="hero" style="display:block;width:100%;height:${
        heroImage.height ?? 300
      }px;object-fit:cover;object-position:${
        heroImage.objectPosition ?? 'center'
      };background-color:${DPAL.ink};" />`
    : '';
  const hero = heroImage
    ? `<tr><td style="padding:0;">${
        heroImage.href
          ? `<a href="${heroImage.href}" style="text-decoration:none;display:block;">${heroImg}</a>`
          : heroImg
      }</td></tr>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,500;1,400&family=Cormorant+Garamond:ital@1&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  body { margin:0; padding:0; background-color:${DPAL.outer}; }
  table { border-collapse:collapse; }
  img { display:block; border:0; line-height:100%; outline:none; text-decoration:none; }
  a { color:${DPAL.ember}; text-decoration:none; }
  .preheader { display:none !important; visibility:hidden; opacity:0; max-height:0; overflow:hidden; mso-hide:all; }
  @media only screen and (max-width:600px) {
    .wrapper { width:100% !important; }
    .pad { padding-left:26px !important; padding-right:26px !important; }
    .h1 { font-size:32px !important; line-height:1.15 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${DPAL.outer};-webkit-font-smoothing:antialiased;">
<span class="preheader">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${DPAL.outer};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="wrapper" width="600" cellpadding="0" cellspacing="0" style="width:600px;background-color:${DPAL.card};border-radius:5px;overflow:hidden;">
${hero}
<tr><td class="pad" style="padding:44px 44px 8px;">
${blocks}
</td></tr>
${footerHtml(footer ?? {})}
</table>
</td></tr>
</table>
</body>
</html>`;
}

// Strip a built HTML string to a readable plain-text part. Used by the email
// builders for the text/plain alternative (kept here so the markup→text rules
// live with the markup).
export function designToText(parts: string[]): string {
  return parts.filter((p) => p !== undefined && p !== null).join('\n');
}

export { MAILING_ADDRESS };
